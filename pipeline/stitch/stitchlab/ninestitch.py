"""NineStitcher: all-9 (ring A..F + sky G/H/J) compositor with per-clip sky refinement.

Builds ON TOP of the proven M0 foundation without modifying it:
  * The six ring cameras are composed by RingStitcher exactly as in 1.0 —
    same LUTs, same gain lock, same frozen seams. The ring band owns every
    output pixel BELOW a per-column frozen sky seam.
  * The three sky cameras own the region ABOVE that seam. Their .pts angles
    are from a different shoot day (sky pitch drifts ~6 deg between shoots,
    per the capture-system notes), so SkyRefiner solves per-clip (yaw, pitch,
    roll) offsets for each sky camera before any LUT is frozen. This is the
    load-bearing step of the 1.0+3 design.
  * All photometric math is in LINEAR light (gamma 2.4, same to_linear /
    from_linear as ringstitch). Ring gains are reused verbatim; sky gains are
    solved after geometry, in the log domain, anchored to the (already
    gain-locked) ring composite.
  * Seams are FROZEN per clip: sky-sky seam columns are chosen by yaw order
    like the ring. The sky-ring boundary is RING-FIRST (default,
    --composite ring-first): the ring owns EVERY pixel where ring coverage is
    valid, and the sky cameras fill only the region above the ring's
    per-column coverage edge (the scalloped tile-top of the ring cams' union
    validity mask, lightly median-filtered). Blending is a ~16 px vertical
    band straddling that edge — sky fades in just above it, ring fades out
    over the topmost ~8 px of its coverage where warp stretch is worst — plus
    a horizontal feather at the sky-sky seams, all in linear light.
    Rationale (user-reported defect, viaduct clip): the previous policy chose
    a per-column min-cost seam row INSIDE the vertical overlap from
    calibration-frame statistics; on featureless sky the cost is flat, so
    seams sat lower than necessary and sky pixels (with wire/arch parallax vs
    the ring) overwrote structure the ring renders cleanly — blocky steps on
    the bridge arch crown. That min-cost search survives only under
    --composite seam-cost for A/B comparison.

QC methodology (the success criterion):
  On >=4 QC frames disjoint from the calibration frames, every seam family is
  measured identically: mean |linear diff| (gains applied) sampled +-12 px
  around the frozen seam, plus phase-correlation displacement of the mean
  patch in each overlap's interior.
    PASS iff mean(sky-family MAD) <= mean(ring-family MAD)
         and max(sky-family phase disp magnitude) <= max(ring-family ditto),
  where sky family = the three sky-ring bands + the three sky-sky seams and
  ring family = the six 1.0 seams recomputed in the same run.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import geometry
from .clip import RingClip
from .pts import Camera
from .ringstitch import RingStitcher, from_linear, seam_cost_curve, to_linear

SKY = "GHJ"
#: Rows above this latitude are excluded when locating sky-sky seam COLUMNS:
#: near the zenith every sky camera sees every column, so the pairwise overlap
#: degenerates to "all columns" and a column seam is meaningless there.
POLAR_CAP_LAT_DEG = 72.0
QC_STRIP_HALF = 12  # +-px around each frozen seam for the MAD metric
#: +-px patch half-width for phase correlation. Round 3: 64 -> 128 for EVERY
#: seam family identically — on low-texture overcast sky small patches give
#: unreliable correlation peaks (response < 0.1, junk displacements); larger
#: patches admit more cloud texture and stabilize the reading for ring and
#: sky families alike.
QC_PHASE_HALF = 128


# --------------------------------------------------------------------- helpers


def _apply_offsets(cam: Camera, off: dict) -> Camera:
    """Deepcopy a camera and add per-clip (yaw, pitch, roll) offsets (deg)."""
    c = copy.deepcopy(cam)
    c.yaw += float(off.get("yaw", 0.0))
    c.pitch += float(off.get("pitch", 0.0))
    c.roll += float(off.get("roll", 0.0))
    return c


def _col_weight(eq_w: int, left_seam: int, right_seam: int, feather: float) -> np.ndarray:
    """Circular-arc column weight (same construction as RingStitcher._col_weight):
    the camera owns [left_seam, right_seam] with +-feather linear ramps."""
    cols = np.arange(eq_w, dtype=np.float64)
    d_from_l = (cols - left_seam + eq_w / 2) % eq_w - eq_w / 2
    d_to_r = (right_seam - cols + eq_w / 2) % eq_w - eq_w / 2
    ramp_l = np.clip((d_from_l + feather) / (2 * feather), 0.0, 1.0)
    ramp_r = np.clip((d_to_r + feather) / (2 * feather), 0.0, 1.0)
    return (ramp_l * ramp_r).astype(np.float32)


def _lin_luma(bgr: np.ndarray) -> np.ndarray:
    """uint8 BGR -> float32 linear luminance (channel mean, as in ringstitch)."""
    return to_linear(bgr).mean(axis=2)


def _median_filter_circular(values: np.ndarray, ksize: int) -> np.ndarray:
    """Median filter a 1-D per-column signal with circular (wrap) boundary."""
    half = ksize // 2
    stack = np.stack([np.roll(values, s) for s in range(-half, half + 1)])
    return np.median(stack, axis=0)


def _phase_correlate(patch_i: np.ndarray, patch_j: np.ndarray) -> dict:
    """Phase-correlate two mean linear-luma patches (Hann windowed)."""
    pi = np.ascontiguousarray(patch_i, dtype=np.float32)
    pj = np.ascontiguousarray(patch_j, dtype=np.float32)
    hann = cv2.createHanningWindow((pi.shape[1], pi.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(pi, pj, hann)
    return {
        "dx": float(dx),
        "dy": float(dy),
        "mag": float(math.hypot(dx, dy)),
        "response": float(resp),
    }


def _all_valid_rows(valid_block: np.ndarray, min_rows: int = 32, fallback: int = 64) -> np.ndarray:
    """Rows fully valid across a column block, falling back to the most-covered
    rows (same policy as RingStitcher._phase_correlate)."""
    rows = np.where(valid_block.all(axis=1))[0]
    if rows.size < min_rows:
        rows = np.argsort(valid_block.sum(axis=1))[-fallback:]
        rows.sort()
    return rows


# ------------------------------------------------------------------ SkyRefiner


class SkyRefiner:
    """Per-clip sky-camera orientation refinement.

    The .pts sky angles come from a different shoot day, so each sky camera's
    (yaw, pitch, roll) is re-solved against the TRUSTED ring: candidates are
    scored by the mean |linear-luma diff| against the gain-locked ring
    reference (and, in the fine stages, against the other sky cameras) inside
    the candidate's valid-overlap pixels. A per-candidate scalar gain
    (ratio of overlap means) decouples photometry from the geometric search.

    Two-stage search at reduced EQ resolution:
      coarse: pitch +-8 step 2, yaw +-4 step 2, roll +-3 step 1.5, ring-only
      fine:   step 0.5 over +-1.0, then step 0.15 over +-0.3, ring + sky-sky
    """

    COARSE = {
        "pitch": np.arange(-8.0, 8.0 + 1e-9, 2.0),
        "yaw": np.arange(-4.0, 4.0 + 1e-9, 2.0),
        "roll": np.arange(-3.0, 3.0 + 1e-9, 1.5),
    }
    FINE_STEPS = [(0.5, 1.0), (0.15, 0.3)]  # (step, half-range) around best

    def __init__(self, ring: RingStitcher, src_w: int, src_h: int, eq_w: int = 1920, eq_h: int = 960):
        self.ring = ring
        self.src_w, self.src_h = src_w, src_h
        self.eq_w, self.eq_h = eq_w, eq_h
        # Only the upper hemisphere matters for the sky search.
        self.rows = eq_h // 2
        self.rays = geometry.equirect_rays(eq_w, eq_h)[:, : self.rows]  # cached
        self.sky_cams = {l: ring.proj.by_letter[l] for l in SKY}

        # Low-res ring maps (upper-hemisphere crop) for the reference mosaic.
        self._ring_maps = {}
        for cam in ring.proj.ring:
            mx, my, valid = geometry.camera_maps(cam, eq_w, eq_h, src_w, src_h, rays=self.rays)
            self._ring_maps[cam.letter] = (mx, my, valid)

        self._frames_luma: list[dict[str, np.ndarray]] = []  # src-space linear luma
        self._refs: list[np.ndarray] = []  # ring reference mosaic per frame
        self._ref_valid: np.ndarray | None = None

    # ------------------------------------------------------------- reference

    def set_frames(self, frames_list: list[dict[str, np.ndarray]]) -> None:
        """Cache source-space linear luma and build the gain-applied ring
        reference mosaic (valid-pixel mean across ring cams) per frame."""
        self._frames_luma = [
            {l: _lin_luma(frames[l]) for l in list(self.ring.order) + list(SKY)}
            for frames in frames_list
        ]
        num_valid = np.zeros((self.rows, self.eq_w), np.float32)
        for l in self.ring.order:
            num_valid += self._ring_maps[l][2].astype(np.float32)
        self._ref_valid = num_valid > 0
        safe = np.where(num_valid > 0, num_valid, 1.0)
        self._refs = []
        for luma in self._frames_luma:
            acc = np.zeros((self.rows, self.eq_w), np.float32)
            for l in self.ring.order:
                mx, my, valid = self._ring_maps[l]
                warped = cv2.remap(luma[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                acc += self.ring.gains[l] * warped * valid
            self._refs.append(acc / safe)

    # --------------------------------------------------------------- scoring

    def _warp_candidate(self, letter: str, off: dict):
        cam = _apply_offsets(self.sky_cams[letter], off)
        mx, my, valid = geometry.camera_maps(cam, self.eq_w, self.eq_h, self.src_w, self.src_h, rays=self.rays)
        lums = [
            cv2.remap(fl[letter], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            for fl in self._frames_luma
        ]
        return lums, valid

    def score(self, letter: str, off: dict, others: dict | None = None):
        """Mean |linear diff| of a candidate orientation in its overlaps.

        others: {letter: (lums, valid, gain)} of the other sky cams at their
        current best (fine stages only). Returns (score, gain, lums, valid).
        """
        lums, valid = self._warp_candidate(letter, off)
        ov_ring = valid & self._ref_valid
        s_ref = sum(float(ref[ov_ring].sum()) for ref in self._refs)
        s_cand = sum(float(lum[ov_ring].sum()) for lum in lums)
        if s_cand <= 0 or int(ov_ring.sum()) < 500:
            return float("inf"), 1.0, lums, valid
        gain = s_ref / s_cand  # photometric normalization, anchored to the ring

        diff_sum = 0.0
        n = 0
        for ref, lum in zip(self._refs, lums):
            diff_sum += float(np.abs(gain * lum[ov_ring] - ref[ov_ring]).sum())
            n += int(ov_ring.sum())
        if others:
            for o_letter, (o_lums, o_valid, o_gain) in others.items():
                ov = valid & o_valid
                if int(ov.sum()) < 500:
                    continue
                for lum, o_lum in zip(lums, o_lums):
                    diff_sum += float(np.abs(gain * lum[ov] - o_gain * o_lum[ov]).sum())
                    n += int(ov.sum())
        return diff_sum / max(n, 1), gain, lums, valid

    # ---------------------------------------------------------------- search

    def _grid_search(self, letter: str, center: dict, grids: dict, others: dict | None):
        best = (float("inf"), dict(center), 1.0, None, None)
        for dp in grids["pitch"]:
            for dy in grids["yaw"]:
                for dr in grids["roll"]:
                    off = {
                        "yaw": center["yaw"] + float(dy),
                        "pitch": center["pitch"] + float(dp),
                        "roll": center["roll"] + float(dr),
                    }
                    s, g, lums, valid = self.score(letter, off, others)
                    if s < best[0]:
                        best = (s, off, g, lums, valid)
        return best

    def refine(self) -> tuple[dict, dict]:
        """Run the two-stage search for all sky cams. Returns
        (offsets {letter: {yaw,pitch,roll}}, report dict for sky_refine.json)."""
        if not self._refs:
            raise RuntimeError("set_frames() must run before refine()")
        t0 = time.perf_counter()
        report: dict = {"stages": {}, "cams": {}}
        zero = {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}

        state = {}  # letter -> (score, off, gain, lums, valid)
        for letter in SKY:
            s0, g0, _, _ = self.score(letter, zero)
            best = self._grid_search(letter, zero, self.COARSE, others=None)
            state[letter] = best
            report["cams"][letter] = {
                "score_before_ring_only": s0,
                "score_after_coarse_ring_only": best[0],
                "gain_before": g0,
            }

        # Fine stages: coordinate descent, each cam scored against the ring
        # AND the other sky cams at their current best estimates.
        for step, half in self.FINE_STEPS:
            grids = {k: np.arange(-half, half + 1e-9, step) for k in ("pitch", "yaw", "roll")}
            for letter in SKY:
                others = {
                    o: (state[o][3], state[o][4], state[o][2])
                    for o in SKY
                    if o != letter and state[o][3] is not None
                }
                best = self._grid_search(letter, state[letter][1], grids, others)
                state[letter] = best
            report["stages"][f"fine_step_{step}"] = {l: state[l][0] for l in SKY}

        offsets = {}
        for letter in SKY:
            s, off, g, _, _ = state[letter]
            offsets[letter] = {k: round(v, 4) for k, v in off.items()}
            report["cams"][letter].update(
                {
                    "offsets_deg": offsets[letter],
                    "score_after_fine_combined": s,
                    "search_gain": g,
                }
            )
        report["search"] = {
            "eq": [self.eq_w, self.eq_h],
            "coarse_grid": {k: v.tolist() for k, v in self.COARSE.items()},
            "fine_steps": self.FINE_STEPS,
            "n_frames": len(self._refs),
            "elapsed_s": round(time.perf_counter() - t0, 2),
        }
        return offsets, report


# ----------------------------------------------------------------- PhasePolish


class PhasePolish:
    """Phase-correlation polish of the sky orientations (round 3).

    The SkyRefiner's mean-|linear-diff| objective is nearly flat on
    featureless overcast sky (its coarse stage can return a zero update), so
    degree-scale angular misalignment survives it. Phase correlation of the
    QC patches extracts a much sharper alignment signal from the same
    low-texture content, so this stage minimizes exactly the displacements
    the success criterion scores: the (dx, dy) phase displacements of the
    three sky-ring patches (anchored to the gain-locked ring composite) and
    the three sky-sky patches, over the nine sky (yaw, pitch, roll) params.

    Damped Gauss-Newton with a forward-difference numeric Jacobian (sign
    conventions come out of the LUTs themselves). Patch definitions are
    FROZEN from the baseline-calibrated NineStitcher; only the perturbed
    camera's warped luma is recomputed per Jacobian column. Honesty note:
    QC re-measures on frames disjoint from these calibration frames, so a
    polish that merely chased per-frame noise would not transfer.
    """

    STEP_H = 0.3  # deg, forward-difference step
    MAX_STEP = 1.5  # deg, per-parameter per-iteration cap
    #: Tikhonov damping per parameter kind (J entries are ~10 px/deg, so
    #: J^T J diagonals are O(100-1000)). Roll damping must stay moderate:
    #: yaw shifts content by a uniform pixel count at every latitude, so a
    #: high-latitude sky-sky dx that vanishes at the ring can ONLY be closed
    #: by pitch/roll — over-damping roll forces the solver into a bad yaw
    #: trade (round-3 lesson).
    LAM = {"yaw": 25.0, "pitch": 25.0, "roll": 50.0}

    def __init__(self, nine: NineStitcher, cal_frames: list[dict[str, np.ndarray]], n_frames: int = 6):
        self.nine = nine
        ring = nine.ring
        pick = np.linspace(0, len(cal_frames) - 1, min(n_frames, len(cal_frames))).round().astype(int)
        frames_list = [cal_frames[i] for i in sorted(set(pick.tolist()))]
        self.n = len(frames_list)

        # Source-space linear luma per sky cam (remap input) + fixed ring comp.
        self._src_luma = {l: [_lin_luma(f[l]) for f in frames_list] for l in SKY}
        self._ring_comps = [nine._ring_comp_luma(f) for f in frames_list]

        # Frozen patch definitions, borrowed from the QC accumulator so the
        # polish optimizes exactly what the criterion measures.
        qa = QcAccumulator(nine)
        self._sky_sky = [
            {"pair": st["seam"].pair, "rows": st["rows"], "patch": st["patch"]}
            for st in qa._sky_sky
        ]
        self._sky_ring = [
            {"cam": st["cam"], "prows": st["prows"], "patch": st["patch"]}
            for st in qa._sky_ring
        ]

        self._rays = geometry.equirect_rays(nine.eq_w, nine.eq_h)[:, : nine.sky_r1]
        self._luma_cache: dict[tuple, list[np.ndarray]] = {}

    # ------------------------------------------------------------- measuring

    def _sky_lums(self, letter: str, delta: tuple[float, float, float]) -> list[np.ndarray]:
        """Warped sky luma stack for one cam at (base offsets + delta)."""
        key = (letter, round(delta[0], 4), round(delta[1], 4), round(delta[2], 4))
        if key not in self._luma_cache:
            cam = _apply_offsets(
                self.nine.sky_cams[letter],
                {"yaw": delta[0], "pitch": delta[1], "roll": delta[2]},
            )
            nine = self.nine
            mx, my, _ = geometry.camera_maps(
                cam, nine.eq_w, nine.eq_h, nine.ring.src_w, nine.ring.src_h, rays=self._rays
            )
            vig = self.nine._sky_vig[letter]  # smooth field; valid for small deltas
            self._luma_cache[key] = [
                cv2.remap(sl, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT) * vig
                for sl in self._src_luma[letter]
            ]
        return self._luma_cache[key]

    @staticmethod
    def _patch_stats(patch_pairs: list[tuple[np.ndarray, np.ndarray]]) -> dict:
        """The residual is the phase displacement of the MEAN patch — exactly
        the quantity the QC accumulator scores (round-3 lesson: optimizing a
        median-of-per-frame displacement instead converged beautifully on
        itself while the mean-patch QC reading blew up). Per-frame scatter
        (MAD) is computed alongside, for weighting only: repeatable = real
        geometry, scattered = featureless-sky noise."""
        n = len(patch_pairs)
        pi_mean = sum(p for p, _ in patch_pairs) / n
        pj_mean = sum(p for _, p in patch_pairs) / n
        out = _phase_correlate(pi_mean, pj_mean)
        pcs = [_phase_correlate(pi, pj) for pi, pj in patch_pairs]
        dxs = np.array([pc["dx"] for pc in pcs])
        dys = np.array([pc["dy"] for pc in pcs])
        out["mad_dx"] = float(np.median(np.abs(dxs - np.median(dxs))))
        out["mad_dy"] = float(np.median(np.abs(dys - np.median(dys))))
        return out

    def measure(self, p: np.ndarray) -> tuple[np.ndarray, list[dict]]:
        """Residual vector [(dx, dy) x (3 sky-ring + 3 sky-sky)] at param
        vector p (deg deltas, order G/H/J x yaw/pitch/roll)."""
        deltas = {l: tuple(p[3 * k : 3 * k + 3]) for k, l in enumerate(SKY)}
        lums = {l: self._sky_lums(l, deltas[l]) for l in SKY}
        nine = self.nine
        r0, sr1, cap = nine.ring.r0, nine.sky_r1, nine.row_cap
        res, detail = [], []

        for st in self._sky_ring:
            l = st["cam"]
            g = nine.sky_gains[l]
            pairs = [
                (rc[np.ix_(st["prows"], st["patch"])],
                 g * lum[r0:sr1][np.ix_(st["prows"], st["patch"])])
                for rc, lum in zip(self._ring_comps, lums[l])
            ]
            pc = self._patch_stats(pairs)
            res += [pc["dx"], pc["dy"]]
            detail.append({"kind": "sky_ring", "cam": l, **pc})

        for st in self._sky_sky:
            li, lj = st["pair"]
            gi, gj = nine.sky_gains[li], nine.sky_gains[lj]
            pairs = [
                (gi * li_lum[cap:][np.ix_(st["rows"], st["patch"])],
                 gj * lj_lum[cap:][np.ix_(st["rows"], st["patch"])])
                for li_lum, lj_lum in zip(lums[li], lums[lj])
            ]
            pc = self._patch_stats(pairs)
            res += [pc["dx"], pc["dy"]]
            detail.append({"kind": "sky_sky", "pair": f"{li}-{lj}", **pc})

        return np.asarray(res, np.float64), detail

    # ---------------------------------------------------------------- solver

    @classmethod
    def _weights(cls, detail: list[dict], trusted: np.ndarray | None = None) -> np.ndarray:
        """Per-COMPONENT weights: response x temporal consistency.

        A reading earns trust by being REPEATABLE across the sample frames
        (small across-frame MAD), not merely by peak response — the
        repeatable dy of a low-response sky-sky pair is real geometry, while
        a scattered dx on the same patch is noise (round-3 lesson: a hard
        response gate discarded a repeatable 26 px dy and QC kept failing on
        it). `trusted` kept for signature compat; unused."""
        w = []
        for d in detail:
            base = math.sqrt(min(max(d["response"], 0.05), 1.0))
            w.append(base / (1.0 + d.get("mad_dx", 0.0) / 2.0))
            w.append(base / (1.0 + d.get("mad_dy", 0.0) / 2.0))
        w = np.asarray(w, np.float64)
        if w.max() <= 0:
            return np.zeros_like(w)
        return w / w.max()

    @staticmethod
    def _wrms(r: np.ndarray, w: np.ndarray) -> float:
        return float(np.sqrt(((w * r) ** 2).sum() / (w**2).sum()))

    def solve(self, iters: int = 6) -> tuple[dict, dict]:
        """Returns (polished absolute offsets {letter: {yaw,pitch,roll}},
        report dict). Offsets are base (refiner) offsets + polish deltas.

        Levenberg-style damped, response-weighted Gauss-Newton with a
        backtracking line search; the whole step vector is scaled uniformly
        (never clipped per component, which would bend its direction)."""
        t0 = time.perf_counter()
        lam0 = np.array([self.LAM[k] for _ in SKY for k in ("yaw", "pitch", "roll")])
        lam_scale = 1.0
        p = np.zeros(9)
        r, detail = self.measure(p)
        # Weights frozen from the initial measurement so the objective is
        # stationary; they encode response x temporal repeatability.
        w = self._weights(detail)
        report = {
            "residual_before": {"vec": r.round(3).tolist(), "rms": float(np.sqrt((r**2).mean())),
                                "max_mag": _max_patch_mag(r)},
            "patches_before": detail,
            "weights": w.round(3).tolist(),
            "iterations": [],
        }

        for it in range(iters):
            J = np.zeros((r.size, 9))
            for k in range(9):
                pk = p.copy()
                pk[k] += self.STEP_H
                rk, _ = self.measure(pk)
                J[:, k] = (rk - r) / self.STEP_H
            Jw = w[:, None] * J
            rw = w * r
            step = np.linalg.solve(Jw.T @ Jw + lam_scale * np.diag(lam0), -(Jw.T @ rw))
            m = float(np.abs(step).max())
            if m > self.MAX_STEP:
                step *= self.MAX_STEP / m  # uniform scale keeps the direction
            entry = {"step_deg": step.round(4).tolist(), "wrms_before": self._wrms(r, w),
                     "lam_scale": lam_scale, "tried": []}
            accepted = False
            for scale in (1.0, 0.5, 0.25, 0.1):
                r_new, detail_new = self.measure(p + scale * step)
                wrms_new = self._wrms(r_new, w)
                entry["tried"].append({"scale": scale, "wrms": wrms_new})
                if wrms_new < self._wrms(r, w):
                    p = p + scale * step
                    r, detail = r_new, detail_new
                    accepted = True
                    lam_scale = max(lam_scale * 0.5, 0.25)
                    break
            entry["accepted"] = accepted
            report["iterations"].append(entry)
            if not accepted:
                lam_scale *= 4.0
                if lam_scale > 64.0:
                    break

        _, detail1 = self.measure(p)
        report["residual_after"] = {"vec": r.round(3).tolist(), "rms": float(np.sqrt((r**2).mean())),
                                    "max_mag": _max_patch_mag(r)}
        report["patches_after"] = detail1
        report["polish_deltas_deg"] = {
            l: {"yaw": round(float(p[3 * k]), 4), "pitch": round(float(p[3 * k + 1]), 4),
                "roll": round(float(p[3 * k + 2]), 4)}
            for k, l in enumerate(SKY)
        }
        report["elapsed_s"] = round(time.perf_counter() - t0, 2)

        offsets = {}
        for k, l in enumerate(SKY):
            base = self.nine.sky_offsets.get(l, {})
            offsets[l] = {
                "yaw": round(float(base.get("yaw", 0.0)) + float(p[3 * k]), 4),
                "pitch": round(float(base.get("pitch", 0.0)) + float(p[3 * k + 1]), 4),
                "roll": round(float(base.get("roll", 0.0)) + float(p[3 * k + 2]), 4),
            }
        return offsets, report


def _max_patch_mag(res_vec: np.ndarray) -> float:
    v = res_vec.reshape(-1, 2)
    return float(np.hypot(v[:, 0], v[:, 1]).max())


# ---------------------------------------------------------------- NineStitcher


@dataclass
class SkySkySeam:
    pair: tuple[str, str]
    overlap_lo: int  # unwrapped canvas columns
    overlap_hi: int
    wraps: bool
    col: int = -1
    col_unwrapped: int = -1
    lon_deg: float = 0.0
    mean_abs_linear_diff: float = 0.0  # at calibration
    cand_lo: int = 0
    cand_hi: int = 0
    sel_diag: dict | None = None  # phase screening diagnostics (round 3)


class NineStitcher:
    """Full-sphere-top compositor: RingStitcher band below the frozen sky seam,
    refined sky cameras above, all blending in linear light."""

    #: ring-first: half-width of the vertical blend band at the ring coverage
    #: edge (total ~16 px: sky fades in just above the edge, ring fades out
    #: over the topmost ~8 px of its coverage where warp stretch is worst).
    EDGE_FEATHER = 8
    #: ring-first: circular median width for the per-column coverage edge —
    #: light, ONLY to suppress single-column spikes; the result is then
    #: clamped so the seam is never pulled below coverage.
    EDGE_MEDIAN_K = 9

    def __init__(
        self,
        ring: RingStitcher,
        sky_offsets: dict[str, dict],
        feather_v: int = 16,  # vertical feather at the sky-ring seam (seam-cost mode)
        feather_h: int = 24,  # horizontal feather at sky-sky seams
        min_overlap_rows: int = 24,
        composite: str = "ring-first",  # "ring-first" (default) | "seam-cost"
    ):
        if composite not in ("ring-first", "seam-cost"):
            raise ValueError(f"unknown composite mode {composite!r}")
        self.composite = composite
        self.ring = ring
        self.eq_w, self.eq_h = ring.eq_w, ring.eq_h
        self.feather_v, self.feather_h = feather_v, feather_h
        self.sky_offsets = sky_offsets
        self.sky_cams = {l: _apply_offsets(ring.proj.by_letter[l], sky_offsets.get(l, {})) for l in SKY}
        self.row_cap = int(round((0.5 - POLAR_CAP_LAT_DEG / 180.0) * self.eq_h))

        # Sky LUTs over rows [0, ring.r1) — everything above the ring's bottom.
        rays = geometry.equirect_rays(self.eq_w, self.eq_h)[:, : ring.r1]
        maps = {}
        sky_union = np.zeros((ring.r1, self.eq_w), bool)
        for l, cam in self.sky_cams.items():
            mx, my, valid = geometry.camera_maps(cam, self.eq_w, self.eq_h, ring.src_w, ring.src_h, rays=rays)
            maps[l] = (mx, my, valid)
            sky_union |= valid
        del rays

        sky_rows = np.where(sky_union.any(axis=1))[0]
        if sky_rows.size == 0:
            raise ValueError("sky cameras have no equirect coverage")
        self.sky_r1 = int(sky_rows[-1]) + 1  # exclusive bottom of sky coverage
        # Output band: 9-cam union — from the top of sky coverage down to ring.r1.
        self.r0_9 = min(int(sky_rows[0]), ring.r0)
        self.r1_9 = ring.r1
        self.band_h = self.r1_9 - self.r0_9

        self.sky_maps = {
            l: (mx[: self.sky_r1].copy(), my[: self.sky_r1].copy(), v[: self.sky_r1].copy())
            for l, (mx, my, v) in maps.items()
        }
        del maps
        self.sky_union = sky_union[: self.sky_r1]

        # Ring coverage union (band-relative rows), for overlap + alpha logic.
        self.ring_cov = np.zeros((ring.band_h, self.eq_w), bool)
        for l in ring.order:
            self.ring_cov |= ring.maps[l][2]

        # Sky order by yaw and the three sky-sky seams (columns TBD in calibrate).
        def norm_yaw(y):
            return (y + 180.0) % 360.0 - 180.0

        self.sky_order = sorted(SKY, key=lambda l: norm_yaw(self.sky_cams[l].yaw))
        self.sky_seams: list[SkySkySeam] = []
        for k in range(3):
            li, lj = self.sky_order[k], self.sky_order[(k + 1) % 3]
            self.sky_seams.append(self._find_sky_overlap(li, lj, min_overlap_rows))

        self.sky_gains: dict[str, float] = {}
        self.seam_row: np.ndarray | None = None  # per-column frozen sky-ring seam
        self.alpha: np.ndarray | None = None  # (band_h, eq_w) sky ownership
        self._sky_weights: dict[str, np.ndarray] | None = None
        self._sky_weights_vig: dict[str, np.ndarray] | None = None
        self.sky_colw: dict[str, np.ndarray] = {}

        # Round 3: per-cam radial vignette correction, as an equirect-space
        # multiplicative field exp(v2*r^2 + v4*r^4) (r = normalized source
        # radius from the principal point, warped through the cam's LUT).
        # Identity until calibrate() estimates it.
        self.sky_vig_params: dict[str, tuple[float, float]] = {l: (0.0, 0.0) for l in SKY}
        self._sky_r2: dict[str, np.ndarray] = {}
        for l, cam in self.sky_cams.items():
            mx, my, _ = self.sky_maps[l]
            cx, cy = cam.principal(ring.src_w, ring.src_h)
            rad2 = ((mx - cx) ** 2 + (my - cy) ** 2) / ((ring.src_w**2 + ring.src_h**2) / 4.0)
            self._sky_r2[l] = rad2.astype(np.float32)
        self._sky_vig: dict[str, np.ndarray] = {l: np.ones_like(self._sky_r2[l]) for l in SKY}

    # -------------------------------------------------------------- overlaps

    def _find_sky_overlap(self, li: str, lj: str, min_rows: int) -> SkySkySeam:
        """Pairwise sky overlap columns, polar cap excluded (see POLAR_CAP note)."""
        w = self.eq_w
        both = self.sky_maps[li][2][self.row_cap :] & self.sky_maps[lj][2][self.row_cap :]
        colmask = both.sum(axis=0) >= min_rows
        cols = np.where(colmask)[0]
        if cols.size < 8:
            raise ValueError(f"sky pair {li}-{lj}: no usable overlap columns below the polar cap")
        wraps = bool(colmask[0] and colmask[-1] and not colmask.all())
        if wraps:
            cols = np.where(cols < w // 2, cols + w, cols)
        lo, hi = int(cols.min()), int(cols.max()) + 1
        return SkySkySeam(pair=(li, lj), overlap_lo=lo, overlap_hi=hi, wraps=wraps)

    # ------------------------------------------------------- warped-luma pass

    def _warp_sky_luma(self, frames: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
        """Warped linear luma per sky cam, vignette-corrected (identity until
        calibrate() has estimated the radial fields)."""
        out = {}
        for l in SKY:
            mx, my, _ = self.sky_maps[l]
            warped = cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            out[l] = _lin_luma(warped) * self._sky_vig[l]
        return out

    def _ring_comp_luma(self, frames: dict[str, np.ndarray]) -> np.ndarray:
        """Gain-locked linear-luma ring composite (band-relative rows), using
        the RingStitcher's own frozen weights."""
        acc = np.zeros((self.ring.band_h, self.eq_w), np.float32)
        for l in self.ring.order:
            mx, my, _ = self.ring.maps[l]
            warped = cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            acc += _lin_luma(warped) * self.ring._weights[l]
        return acc

    # -------------------------------------------------------------- calibrate

    def calibrate(self, cal_frames: list[dict[str, np.ndarray]]) -> None:
        """Freeze sky gains, sky-sky seam columns, the per-column sky-ring seam
        row, and the blend fields, from the cached calibration frames."""
        if self.ring._weights is None:
            raise RuntimeError("RingStitcher must be calibrated first")

        # One warp pass: sky luma + ring composite luma per calibration frame.
        # _sky_vig is identity here, so these lums are UNcorrected.
        sky_lums = [self._warp_sky_luma(f) for f in cal_frames]
        ring_comps = [self._ring_comp_luma(f) for f in cal_frames]

        self._solve_sky_photometry(sky_lums, ring_comps)
        # Apply the just-estimated vignette correction to the cached lums so
        # everything frozen below (seams, alpha, QC reuse) sees corrected sky.
        for sl in sky_lums:
            for l in SKY:
                sl[l] *= self._sky_vig[l]
        self._freeze_sky_sky_seams(sky_lums)
        self._build_sky_weights()
        if self.composite == "ring-first":
            # Ring-first: the boundary is geometry (the ring's coverage edge),
            # not image statistics — nothing to estimate from frames.
            self._freeze_coverage_edge_seam()
            self._build_alpha(feather=self.EDGE_FEATHER)
        else:
            sky_comps = [self._sky_comp_luma(sl) for sl in sky_lums]
            self._freeze_sky_ring_seam(sky_comps, ring_comps)
            self._build_alpha(feather=self.feather_v)

    def _solve_sky_photometry(self, sky_lums, ring_comps) -> None:
        """Joint log-domain least squares for the three sky gains AND a
        per-cam radial vignette correction exp(v2 r^2 + v4 r^4) (round 3).

        Rationale: with scalar gains alone the sky-sky overlap-disagreement
        curve is U-shaped — vignette falloff at each camera's image periphery
        dominates the overlap EDGES, which forbids placing a seam there even
        when the edge region is the only one free of near-field wire parallax.
        Anchor: the gain-locked ring composite (sky-ring residuals), plus
        sky-sky consistency, sampled from the calibration frames; ridge on
        the vignette coefficients keeps the fit tame.
        `sky_lums` must be UNcorrected (identity _sky_vig)."""
        r0 = self.ring.r0
        idx = {l: k for k, l in enumerate(SKY)}
        # Time-mean linear luma per cam (equirect) to denoise before logs.
        mean_sky = {l: sum(sl[l] for sl in sky_lums) / len(sky_lums) for l in SKY}
        mean_ring = sum(ring_comps) / len(ring_comps)

        rows, rhs, wts = [], [], []
        stride = 6

        def add_rows(mask2d, build_row, lhs_log, weight):
            ys, xs = np.where(mask2d)
            if ys.size == 0:
                return
            sel = slice(0, None, max(1, ys.size // 4000))
            for y, x in zip(ys[sel], xs[sel]):
                row = np.zeros(9)
                val = build_row(row, y, x)
                if val is None:
                    return
                rows.append(row)
                rhs.append(lhs_log(y, x))
                wts.append(weight)

        eps = 1e-5
        # sky-ring anchor terms
        for l in SKY:
            v = self.sky_maps[l][2][r0 : self.sky_r1]
            ov = v & self.ring_cov[: self.sky_r1 - r0]
            s = mean_sky[l][r0 : self.sky_r1]
            r = mean_ring[: self.sky_r1 - r0]
            ok = ov & (s > eps) & (r > eps)
            ok_sub = np.zeros_like(ok)
            ok_sub[::stride, ::stride] = ok[::stride, ::stride]
            r2 = self._sky_r2[l][r0 : self.sky_r1]

            def build(row, y, x, l=l, r2=r2):
                row[3 * idx[l]] = 1.0
                row[3 * idx[l] + 1] = r2[y, x]
                row[3 * idx[l] + 2] = r2[y, x] ** 2
                return True

            add_rows(ok_sub, build, lambda y, x, s=s, r=r: math.log(r[y, x] / s[y, x]), 1.0)

        # sky-sky consistency terms
        for k in range(3):
            li, lj = self.sky_order[k], self.sky_order[(k + 1) % 3]
            ov = self.sky_maps[li][2] & self.sky_maps[lj][2]
            si, sj = mean_sky[li], mean_sky[lj]
            ok = ov & (si > eps) & (sj > eps)
            ok_sub = np.zeros_like(ok)
            ok_sub[::stride, ::stride] = ok[::stride, ::stride]
            r2i, r2j = self._sky_r2[li], self._sky_r2[lj]

            def build(row, y, x, li=li, lj=lj, r2i=r2i, r2j=r2j):
                row[3 * idx[li]] = 1.0
                row[3 * idx[li] + 1] = r2i[y, x]
                row[3 * idx[li] + 2] = r2i[y, x] ** 2
                row[3 * idx[lj]] = -1.0
                row[3 * idx[lj] + 1] = -r2j[y, x]
                row[3 * idx[lj] + 2] = -r2j[y, x] ** 2
                return True

            add_rows(ok_sub, build, lambda y, x, si=si, sj=sj: math.log(sj[y, x] / si[y, x]), 1.0)

        if not rows:
            raise ValueError("no usable overlap statistics for sky photometry")
        A = np.asarray(rows)
        b = np.asarray(rhs)
        # Ridge on the vignette coefficients (relative to the data scale).
        n = len(rows)
        reg = np.zeros((6, 9))
        lam = math.sqrt(n) * 0.1
        for k, l in enumerate(SKY):
            reg[2 * k, 3 * k + 1] = lam
            reg[2 * k + 1, 3 * k + 2] = lam
        sol, *_ = np.linalg.lstsq(np.vstack([A, reg]), np.concatenate([b, np.zeros(6)]), rcond=None)
        self.sky_gains = {l: float(math.exp(sol[3 * idx[l]])) for l in SKY}
        for l in SKY:
            v2, v4 = float(sol[3 * idx[l] + 1]), float(sol[3 * idx[l] + 2])
            self.sky_vig_params[l] = (v2, v4)
            r2 = self._sky_r2[l]
            self._sky_vig[l] = np.exp(v2 * r2 + v4 * r2**2).clip(0.5, 2.0).astype(np.float32)

    def _solve_sky_gains(self, sky_lums, ring_comps) -> None:
        """Log-domain least squares for the three sky gains, anchored to the
        gain-locked ring composite (sky-ring terms) with sky-sky consistency."""
        col = {l: k for k, l in enumerate(SKY)}
        rows, rhs = [], []
        r0 = self.ring.r0
        for sl, rc in zip(sky_lums, ring_comps):
            for l in SKY:
                # sky-ring: valid sky pixels inside the ring band with coverage
                v = self.sky_maps[l][2][r0 : self.sky_r1]
                ov = v & self.ring_cov[: self.sky_r1 - r0]
                m_s = float(sl[l][r0 : self.sky_r1][ov].mean()) if ov.any() else 0.0
                m_r = float(rc[: self.sky_r1 - r0][ov].mean()) if ov.any() else 0.0
                if m_s > 0 and m_r > 0:
                    row = np.zeros(3)
                    row[col[l]] = 1.0
                    rows.append(row)
                    rhs.append(math.log(m_r / m_s))
            for k in range(3):
                li, lj = self.sky_order[k], self.sky_order[(k + 1) % 3]
                ov = self.sky_maps[li][2] & self.sky_maps[lj][2]
                m_i = float(sl[li][ov].mean()) if ov.any() else 0.0
                m_j = float(sl[lj][ov].mean()) if ov.any() else 0.0
                if m_i > 0 and m_j > 0:
                    row = np.zeros(3)
                    row[col[li]] = 1.0
                    row[col[lj]] = -1.0
                    rows.append(row)
                    rhs.append(math.log(m_j / m_i))
        if not rows:
            raise ValueError("no usable overlap statistics for sky gains")
        sol, *_ = np.linalg.lstsq(np.asarray(rows), np.asarray(rhs), rcond=None)
        self.sky_gains = {l: float(math.exp(sol[col[l]])) for l in SKY}

    #: Sky-sky seam candidate screening (round 3): evenly spaced candidate
    #: columns scored by strip MAD + phase displacement + temporal stability.
    SKY_SEAM_CANDIDATES = 30

    def _freeze_sky_sky_seams(self, sky_lums) -> None:
        """Choose one frozen seam column per sky pair.

        Round-3 change: min mean-|linear diff| alone is nearly indifferent on
        featureless overcast sky, so the seam (and with it the QC patch that
        the success criterion scores) could land where the two cameras share
        no texture — there a phase reading locks onto the smooth sky-luminance
        gradient and returns a large, stable, FAKE displacement. Candidates
        (evenly spaced in the interior 60% of the overlap) are therefore
        screened by the QC-style phase correlation itself: prefer columns
        where mutual texture exists (response above floor) and the measured
        displacement is small, with the MAD cost as a secondary term."""
        cap = self.row_cap
        for seam in self.sky_seams:
            li, lj = seam.pair
            gi, gj = self.sky_gains[li], self.sky_gains[lj]
            cols = np.arange(seam.overlap_lo, seam.overlap_hi) % self.eq_w
            vb = (
                self.sky_maps[li][2][cap:, cols]
                & self.sky_maps[lj][2][cap:, cols]
            )
            bi = [np.ascontiguousarray(sl[li][cap:, cols]) for sl in sky_lums]
            bj = [np.ascontiguousarray(sl[lj][cap:, cols]) for sl in sky_lums]
            cost = seam_cost_curve(bi, bj, vb, gi, gj)
            n = seam.overlap_hi - seam.overlap_lo
            c0 = int(round(0.2 * n))
            c1 = max(c0 + 1, int(round(0.8 * n)))
            seam.cand_lo = seam.overlap_lo + c0
            seam.cand_hi = seam.overlap_lo + c1

            best_rel, best_score, best_diag = None, None, None
            for cand in np.linspace(c0, c1 - 1, self.SKY_SEAM_CANDIDATES).round().astype(int):
                cand = int(cand)
                cu = seam.overlap_lo + cand
                patch = np.arange(cu - QC_PHASE_HALF, cu + QC_PHASE_HALF + 1) % self.eq_w
                vp = self.sky_maps[li][2][cap:, patch] & self.sky_maps[lj][2][cap:, patch]
                rows = _all_valid_rows(vp)
                patches = [
                    (gi * sl[li][cap:][np.ix_(rows, patch)], gj * sl[lj][cap:][np.ix_(rows, patch)])
                    for sl in sky_lums
                ]
                pc = _phase_correlate(sum(p for p, _ in patches) / len(patches),
                                      sum(p for _, p in patches) / len(patches))
                # Temporal stability: content sweeps through a column over the
                # clip (wires, clouds), so a mean-patch reading that is small
                # at CALIBRATION times says little about QC times unless every
                # individual frame also reads small. Penalize the worst frame.
                per_frame = [_phase_correlate(p, q) for p, q in patches]
                max_frame_mag = max(f["mag"] for f in per_frame)
                # QC-style strip MAD (+-12 cols) so the score sees what the
                # criterion sees; vignette correction (already applied to
                # sky_lums) is what keeps overlap-edge columns competitive.
                s_lo, s_hi = max(0, cand - QC_STRIP_HALF), min(n, cand + QC_STRIP_HALF + 1)
                strip = cost[s_lo:s_hi]
                strip = strip[np.isfinite(strip)]
                mad_c = float(strip.mean()) if strip.size else 1.0
                # Score = strip MAD + a worst-case PREDICTION of the QC
                # reading: the worst single-frame reading at full weight
                # (round-3 lesson: a "quiet" mean reading with a bad worst
                # frame read 58 px at QC times), plus a graded prior for
                # low-response columns whose readings simply do not transfer
                # across frame sets. An honestly-textured column with a
                # modest stable displacement beats a featureless coin flip.
                resp_pen = 25.0 * max(0.0, 0.3 - pc["response"]) / 0.3
                score = 1000.0 * mad_c + pc["mag"] + max_frame_mag + resp_pen
                if best_score is None or score < best_score:
                    best_rel, best_score = cand, score
                    best_diag = {"phase_mag": round(pc["mag"], 2), "response": round(pc["response"], 3),
                                 "strip_mad": round(mad_c, 5), "max_frame_mag": round(max_frame_mag, 2),
                                 "score": round(score, 2)}
            seam.col_unwrapped = seam.overlap_lo + best_rel
            seam.col = seam.col_unwrapped % self.eq_w
            seam.lon_deg = ((seam.col + 0.5) / self.eq_w) * 360.0 - 180.0
            seam.mean_abs_linear_diff = float(cost[best_rel])
            seam.sel_diag = best_diag

    def _build_sky_weights(self) -> None:
        """Per-sky-cam column arcs with horizontal feather, normalized per
        pixel over valid coverage, gains folded in (mirrors RingStitcher)."""
        eps = 1e-4
        w_raw = {}
        for k, l in enumerate(self.sky_order):
            left = self.sky_seams[(k - 1) % 3].col_unwrapped % self.eq_w
            right = self.sky_seams[k].col_unwrapped % self.eq_w
            colw = _col_weight(self.eq_w, left, right, float(self.feather_h))
            self.sky_colw[l] = colw
            w_raw[l] = (colw[None, :] + eps) * self.sky_maps[l][2].astype(np.float32)
        total = np.zeros((self.sky_r1, self.eq_w), np.float32)
        for arr in w_raw.values():
            total += arr
        safe = np.where(total > 0, total, 1.0)
        self._sky_weights = {l: (arr / safe) * self.sky_gains[l] for l, arr in w_raw.items()}
        # Compose-path weights with the vignette correction folded in (the
        # QC/luma path corrects in _warp_sky_luma instead; keep them separate
        # so _sky_comp_luma, which is fed corrected lums, is not doubly
        # corrected).
        self._sky_weights_vig = {l: w * self._sky_vig[l] for l, w in self._sky_weights.items()}

    def _sky_comp_luma(self, sky_lum: dict[str, np.ndarray]) -> np.ndarray:
        acc = np.zeros((self.sky_r1, self.eq_w), np.float32)
        for l in SKY:
            acc += sky_lum[l] * self._sky_weights[l]
        return acc

    def _freeze_coverage_edge_seam(self) -> None:
        """RING-FIRST boundary: the seam IS the ring's per-column coverage
        edge — the min valid row of the ring cams' union validity mask (the
        scalloped tile-top edge already baked for the LUTs). The ring owns
        every pixel where its coverage is valid; sky fills only what is above.

        A light circular median (EDGE_MEDIAN_K) suppresses single-column
        spikes, then the result is clamped to the raw edge so smoothing can
        NEVER pull the seam below coverage (which would hand sky pixels —
        with wire/arch parallax vs the ring — structure the ring renders
        cleanly: the user-reported blocky-arch defect)."""
        covered = self.ring_cov.any(axis=0)
        edge_rel = np.argmax(self.ring_cov, axis=0)  # first ring-valid row (band-rel)
        edge = (self.ring.r0 + edge_rel).astype(np.float64)
        # Columns with no ring coverage at all: park the edge at the band
        # bottom; _build_alpha's coverage forcing gives them to the sky.
        edge[~covered] = float(self.r1_9 - 1)
        seam = np.minimum(_median_filter_circular(edge, ksize=self.EDGE_MEDIAN_K), edge)
        self.seam_row = np.clip(np.round(seam), 0, self.r1_9 - 1).astype(np.int32)

    def _freeze_sky_ring_seam(self, sky_comps, ring_comps) -> None:
        """LEGACY (--composite seam-cost): per-column min-cost seam row inside
        the sky-ring vertical overlap (cost = |linear diff| of the two
        composites averaged over calibration frames), median-filtered across
        columns and FROZEN. Kept for A/B only — on featureless sky the cost is
        flat and the seam sits lower than necessary (blocky-arch defect)."""
        r0 = self.ring.r0
        n_rows = self.sky_r1 - r0  # global rows r0 .. sky_r1
        both = self.sky_union[r0 : self.sky_r1] & self.ring_cov[:n_rows]
        cost = np.zeros((n_rows, self.eq_w), np.float64)
        for sc, rc in zip(sky_comps, ring_comps):
            cost += np.abs(sc[r0 : self.sky_r1] - rc[:n_rows])
        cost /= len(sky_comps)
        cost[~both] = np.inf

        # Keep the feather inside the overlap when the overlap is tall enough.
        f = self.feather_v
        finite = np.isfinite(cost)
        seam = np.empty(self.eq_w, np.float64)
        ring_top_rel = np.argmax(self.ring_cov, axis=0)  # first ring-valid row (band-rel)
        for c in range(self.eq_w):
            rows = np.where(finite[:, c])[0]
            if rows.size == 0:
                seam[c] = r0 + ring_top_rel[c]  # no overlap: hand over at ring's top edge
                continue
            lo, hi = rows[0], rows[-1]
            if hi - lo > 2 * f + 4:
                lo, hi = lo + f, hi - f
            window = cost[lo : hi + 1, c]
            seam[c] = r0 + lo + int(np.argmin(window))
        seam = _median_filter_circular(seam, ksize=31)
        self.seam_row = np.clip(np.round(seam), 0, self.r1_9 - 1).astype(np.int32)

    def _build_alpha(self, feather: int) -> None:
        """Frozen per-pixel sky ownership over the output band: a +-feather
        vertical linear ramp at the per-column seam row, forced to sky where
        the ring has no coverage and to ring where the sky has none."""
        rr = np.arange(self.r0_9, self.r1_9, dtype=np.float32)[:, None]  # global rows
        f = float(feather)
        ramp = np.clip((self.seam_row[None, :].astype(np.float32) - rr + f) / (2 * f), 0.0, 1.0)

        sky_cov = np.zeros((self.band_h, self.eq_w), bool)
        s0 = self.r0_9
        sky_cov[: self.sky_r1 - s0] = self.sky_union[s0:]
        ring_cov = np.zeros((self.band_h, self.eq_w), bool)
        ring_cov[self.ring.r0 - s0 :] = self.ring_cov
        alpha = np.where(sky_cov, ramp, 0.0)
        alpha[~ring_cov] = np.where(sky_cov[~ring_cov], 1.0, 0.0)
        self.alpha = alpha.astype(np.float32)

    # ---------------------------------------------------------------- compose

    def compose_frame(self, frames: dict[str, np.ndarray]) -> np.ndarray:
        """Blend one aligned 9-cam frame set into the output band (BGR uint8)."""
        if self.alpha is None:
            raise RuntimeError("calibrate() must run before compose_frame()")
        canvas = np.zeros((self.band_h, self.eq_w, 3), np.float32)
        s0 = self.r0_9

        # Sky above the seam.
        a_sky = self.alpha[: self.sky_r1 - s0, :, None]
        acc_sky = np.zeros((self.sky_r1, self.eq_w, 3), np.float32)
        for l in SKY:
            mx, my, _ = self.sky_maps[l]
            warped = cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            acc_sky += to_linear(warped) * self._sky_weights_vig[l][:, :, None]
        canvas[: self.sky_r1 - s0] += a_sky * acc_sky[s0:]

        # Ring below the seam (RingStitcher weights, unchanged).
        acc_ring = np.zeros((self.ring.band_h, self.eq_w, 3), np.float32)
        for l in self.ring.order:
            mx, my, _ = self.ring.maps[l]
            warped = cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            acc_ring += to_linear(warped) * self.ring._weights[l][:, :, None]
        rslice = slice(self.ring.r0 - s0, self.r1_9 - s0)
        canvas[rslice] += (1.0 - self.alpha[rslice, :, None]) * acc_ring
        return from_linear(canvas)

    # ----------------------------------------------------------------- report

    def report(self) -> dict:
        return {
            "band9": {"r0": self.r0_9, "r1": self.r1_9, "height": self.band_h},
            "composite_mode": self.composite,
            "sky_ring_boundary": (
                {"policy": "ring-coverage-edge", "feather_half_px": self.EDGE_FEATHER,
                 "edge_median_k": self.EDGE_MEDIAN_K}
                if self.composite == "ring-first"
                else {"policy": "min-cost-seam", "feather_half_px": self.feather_v}
            ),
            "sky_r1": self.sky_r1,
            "sky_order_by_yaw": self.sky_order,
            "sky_offsets_deg": self.sky_offsets,
            "sky_gains": self.sky_gains,
            "sky_vignette_v2_v4": {l: [round(a, 4), round(b, 4)] for l, (a, b) in self.sky_vig_params.items()},
            "feather_v_px": self.feather_v,
            "feather_h_px": self.feather_h,
            "polar_cap_lat_deg": POLAR_CAP_LAT_DEG,
            "sky_sky_seams": [
                {
                    "pair": f"{s.pair[0]}-{s.pair[1]}",
                    "wraps_180": s.wraps,
                    "overlap_cols": [s.overlap_lo, s.overlap_hi],
                    "candidate_cols": [s.cand_lo, s.cand_hi],
                    "seam_col": s.col,
                    "seam_lon_deg": round(s.lon_deg, 3),
                    "calib_mean_abs_linear_diff": s.mean_abs_linear_diff,
                    "phase_screen": s.sel_diag,
                }
                for s in self.sky_seams
            ],
            "sky_ring_seam_row": {
                "min": int(self.seam_row.min()),
                "median": int(np.median(self.seam_row)),
                "max": int(self.seam_row.max()),
            },
        }


# ------------------------------------------------------------------ QC metrics


class QcAccumulator:
    """Accumulates the seam-family metrics over QC frames with the SAME
    methodology for every family: MAD sampled +-12 px around each frozen seam
    (gains applied, linear light) + phase correlation of the mean overlap patch."""

    def __init__(self, nine: NineStitcher):
        self.nine = nine
        self.ring = nine.ring
        self.n_frames = 0
        w = nine.eq_w

        # ring seams: strips + phase patches (band-relative rows)
        self._ring = []
        for s in self.ring.seams:
            strip = np.arange(s.col_unwrapped - QC_STRIP_HALF, s.col_unwrapped + QC_STRIP_HALF + 1) % w
            patch = np.arange(s.col_unwrapped - QC_PHASE_HALF, s.col_unwrapped + QC_PHASE_HALF + 1) % w
            li, lj = s.pair
            vs = self.ring.maps[li][2][:, strip] & self.ring.maps[lj][2][:, strip]
            vp = self.ring.maps[li][2][:, patch] & self.ring.maps[lj][2][:, patch]
            rows = _all_valid_rows(vp)
            self._ring.append(
                {
                    "seam": s, "strip": strip, "patch": patch, "vs": vs, "rows": rows,
                    "mad_sum": 0.0, "mad_n": 0,
                    "pi": np.zeros((rows.size, patch.size), np.float64),
                    "pj": np.zeros((rows.size, patch.size), np.float64),
                }
            )

        # sky-sky seams (rows below the polar cap, like seam selection)
        self._sky_sky = []
        for s in nine.sky_seams:
            strip = np.arange(s.col_unwrapped - QC_STRIP_HALF, s.col_unwrapped + QC_STRIP_HALF + 1) % w
            patch = np.arange(s.col_unwrapped - QC_PHASE_HALF, s.col_unwrapped + QC_PHASE_HALF + 1) % w
            li, lj = s.pair
            cap = nine.row_cap
            vs = nine.sky_maps[li][2][cap:, strip] & nine.sky_maps[lj][2][cap:, strip]
            vp = nine.sky_maps[li][2][cap:, patch] & nine.sky_maps[lj][2][cap:, patch]
            rows = _all_valid_rows(vp)
            self._sky_sky.append(
                {
                    "seam": s, "strip": strip, "patch": patch, "vs": vs, "rows": rows,
                    "mad_sum": 0.0, "mad_n": 0,
                    "pi": np.zeros((rows.size, patch.size), np.float64),
                    "pj": np.zeros((rows.size, patch.size), np.float64),
                }
            )

        # sky-ring bands: one metric per sky cam over the columns it owns
        self._sky_ring = []
        r0, sr1 = self.ring.r0, nine.sky_r1
        offs = np.arange(-QC_STRIP_HALF, QC_STRIP_HALF + 1)
        for l in SKY:
            owned = np.where(nine.sky_colw[l] > 0.5)[0]
            rows_mat = nine.seam_row[owned][None, :] + offs[:, None]  # global rows
            in_range = (rows_mat >= r0) & (rows_mat < sr1)
            rows_cl = np.clip(rows_mat, r0, sr1 - 1)
            v = (
                in_range
                & nine.sky_maps[l][2][rows_cl, owned[None, :]]
                & nine.ring_cov[rows_cl - r0, owned[None, :]]
            )
            # phase patch: contiguous block of columns centered on the cam yaw
            yaw = (nine.sky_cams[l].yaw + 180.0) % 360.0 - 180.0
            c0 = int(round((yaw / 360.0 + 0.5) * w)) % w
            patch = np.arange(c0 - 2 * QC_PHASE_HALF, c0 + 2 * QC_PHASE_HALF) % w
            vb = nine.sky_maps[l][2][r0:sr1][:, patch] & nine.ring_cov[: sr1 - r0][:, patch]
            prows = _all_valid_rows(vb)  # relative to r0
            self._sky_ring.append(
                {
                    "cam": l, "owned": owned, "rows_mat": rows_cl, "v": v, "patch": patch,
                    "prows": prows, "mad_sum": 0.0, "mad_n": 0,
                    "pi": np.zeros((prows.size, patch.size), np.float64),  # ring
                    "pj": np.zeros((prows.size, patch.size), np.float64),  # sky
                }
            )

    # ------------------------------------------------------------- per frame

    def add_frame(self, ring_lums: dict, sky_lums: dict, ring_comp: np.ndarray) -> None:
        """ring_lums/sky_lums: warped linear luma per cam (band-/sky-relative
        rows); ring_comp: gain-locked ring composite luma (band rows)."""
        nine, ring = self.nine, self.ring
        self.n_frames += 1

        for st in self._ring:
            li, lj = st["seam"].pair
            gi, gj = ring.gains[li], ring.gains[lj]
            bi, bj = ring_lums[li][:, st["strip"]], ring_lums[lj][:, st["strip"]]
            d = np.abs(gi * bi - gj * bj)[st["vs"]]
            st["mad_sum"] += float(d.sum())
            st["mad_n"] += d.size
            st["pi"] += gi * ring_lums[li][np.ix_(st["rows"], st["patch"])]
            st["pj"] += gj * ring_lums[lj][np.ix_(st["rows"], st["patch"])]

        cap = nine.row_cap
        for st in self._sky_sky:
            li, lj = st["seam"].pair
            gi, gj = nine.sky_gains[li], nine.sky_gains[lj]
            bi, bj = sky_lums[li][cap:, st["strip"]], sky_lums[lj][cap:, st["strip"]]
            d = np.abs(gi * bi - gj * bj)[st["vs"]]
            st["mad_sum"] += float(d.sum())
            st["mad_n"] += d.size
            st["pi"] += gi * sky_lums[li][cap:][np.ix_(st["rows"], st["patch"])]
            st["pj"] += gj * sky_lums[lj][cap:][np.ix_(st["rows"], st["patch"])]

        r0 = ring.r0
        for st in self._sky_ring:
            g = nine.sky_gains[st["cam"]]
            sky = g * sky_lums[st["cam"]][st["rows_mat"], st["owned"][None, :]]
            rng = ring_comp[st["rows_mat"] - r0, st["owned"][None, :]]
            d = np.abs(sky - rng)[st["v"]]
            st["mad_sum"] += float(d.sum())
            st["mad_n"] += d.size
            st["pi"] += ring_comp[np.ix_(st["prows"], st["patch"])]
            st["pj"] += g * sky_lums[st["cam"]][r0 : nine.sky_r1][np.ix_(st["prows"], st["patch"])]

    # ---------------------------------------------------------------- results

    def results(self) -> dict:
        def finish(st, label):
            pc = _phase_correlate(st["pi"] / self.n_frames, st["pj"] / self.n_frames)
            return {
                **label,
                "mean_abs_linear_diff": st["mad_sum"] / max(st["mad_n"], 1),
                "phase_corr_displacement_px": pc,
            }

        ring = [
            finish(st, {"pair": f"{st['seam'].pair[0]}-{st['seam'].pair[1]}", "seam_col": st["seam"].col})
            for st in self._ring
        ]
        sky_sky = [
            finish(st, {"pair": f"{st['seam'].pair[0]}-{st['seam'].pair[1]}", "seam_col": st["seam"].col})
            for st in self._sky_sky
        ]
        sky_ring = [
            finish(
                st,
                {
                    "cam": st["cam"],
                    "owned_cols": int(st["owned"].size),
                    "seam_row_median_owned": int(np.median(self.nine.seam_row[st["owned"]])),
                },
            )
            for st in self._sky_ring
        ]

        ring_mads = [m["mean_abs_linear_diff"] for m in ring]
        sky_mads = [m["mean_abs_linear_diff"] for m in sky_ring + sky_sky]
        ring_mags = [m["phase_corr_displacement_px"]["mag"] for m in ring]
        sky_mags = [m["phase_corr_displacement_px"]["mag"] for m in sky_ring + sky_sky]
        pass_mad = float(np.mean(sky_mads)) <= float(np.mean(ring_mads))
        pass_phase = float(np.max(sky_mags)) <= float(np.max(ring_mags))
        return {
            "families": {"ring": ring, "sky_ring": sky_ring, "sky_sky": sky_sky},
            "qc_frames_used": self.n_frames,
            "success_criterion": {
                "mean_ring_mad": float(np.mean(ring_mads)),
                "mean_sky_mad": float(np.mean(sky_mads)),
                "max_ring_phase_disp_mag": float(np.max(ring_mags)),
                "max_sky_phase_disp_mag": float(np.max(sky_mags)),
                "pass_mean_abs_linear_diff": bool(pass_mad),
                "pass_phase_disp": bool(pass_phase),
                "pass": bool(pass_mad and pass_phase),
            },
        }


# ------------------------------------------------------------------ CLI driver


def _spread_indices(usable: int, n: int) -> list[int]:
    return sorted(set(np.linspace(0, usable - 1, n).round().astype(int).tolist()))


def _qc_indices(usable: int, n: int, cal_set: set[int]) -> list[int]:
    """>= n QC frames spread through the clip, disjoint from calibration
    (offset by half a calibration stride, same policy as render.py F8)."""
    idx = [
        min(usable - 1, i + max(1, usable // (2 * max(1, n))))
        for i in _spread_indices(usable, n)
    ]
    idx = sorted(set(idx) - cal_set)
    if len(idx) < max(4, n):  # top up if collisions ate too many
        pool = (i for i in range(usable) if i not in cal_set and i not in set(idx))
        for cand in pool:
            idx.append(cand)
            if len(idx) >= max(4, n):
                break
        idx = sorted(set(idx))
    return idx


def _encoder_argv(clip: RingClip, nine: NineStitcher, out_mov: Path) -> list[str]:
    """ProRes encode of the 9-cam band; identical color pinning to render.py."""
    return [
        "ffmpeg", "-v", "error", "-nostdin", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{nine.eq_w}x{nine.band_h}",
        "-r", f"{clip.fps:g}",
        "-i", "pipe:0",
        "-vf",
        "scale=in_range=full:out_range=limited:out_color_matrix=bt709"
        ":flags=accurate_rnd+full_chroma_int,format=yuv422p10le,"
        "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
        "-c:v", "prores_ks", "-profile:v", "3",
        "-color_range", "tv", "-colorspace", "bt709",
        "-color_primaries", "bt709", "-color_trc", "bt709",
        str(out_mov),
    ]


def _tool_versions() -> dict:
    ff = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0]
    return {"ffmpeg": ff, "cv2": cv2.__version__, "numpy": np.__version__, "python": sys.version.split()[0]}


# ------------------------------------------------- structure-crossing QC

#: +-rows around the sky-ring boundary scanned for structure crossings.
CROSSING_BAND_HALF = 20
#: A column is a crossing candidate when its band gradient score exceeds
#: this percentile of the frame's per-column scores.
CROSSING_PCTL = 95.0
#: Number of worst (frame, column) sites saved as zoom crops.
CROSSING_N_SITES = 6
#: Source-pixel width/height of each crossing crop (saved at 2x -> 400 px).
CROSSING_CROP = 200


def _crossing_scores(band: np.ndarray, nine: NineStitcher) -> np.ndarray:
    """Per-column mean gradient magnitude inside a +-CROSSING_BAND_HALF row
    band around the frozen sky-ring boundary. High score = structure (arch,
    wires, mast) crossing the boundary — the moments a human must see."""
    gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    h = band.shape[0]
    offs = np.arange(-CROSSING_BAND_HALF, CROSSING_BAND_HALF + 1)
    rows = np.clip(nine.seam_row[None, :] - nine.r0_9 + offs[:, None], 0, h - 1)
    cols = np.broadcast_to(np.arange(band.shape[1])[None, :], rows.shape)
    return mag[rows, cols].mean(axis=0)


def _pick_crossing_sites(
    scores_by_frame: dict[int, np.ndarray], eq_w: int,
    n_sites: int = CROSSING_N_SITES, min_sep: int = CROSSING_CROP,
) -> list[dict]:
    """The n_sites worst (frame, column) crossing sites over all QC frames:
    columns above each frame's CROSSING_PCTL, greedily picked by score with
    circular column suppression so crops don't overlap within a frame."""
    cands = []
    for f, sc in scores_by_frame.items():
        thr = float(np.percentile(sc, CROSSING_PCTL))
        for c in np.where(sc >= thr)[0]:
            cands.append((float(sc[c]), f, int(c)))
    cands.sort(reverse=True)

    def circ_dist(a, b):
        d = abs(a - b) % eq_w
        return min(d, eq_w - d)

    picked: list[dict] = []
    for s, f, c in cands:
        if any(p["frame"] == f and circ_dist(c, p["col"]) < min_sep for p in picked):
            continue
        picked.append({"frame": f, "col": c, "score": round(s, 2)})
        if len(picked) >= n_sites:
            break
    return picked


def _save_crossing_crops(
    bands: dict[int, np.ndarray], sites: list[dict], nine: NineStitcher, out_dir: Path
) -> list[str]:
    """400 px wide, 2x-nearest zoom crops centered on each crossing site's
    boundary row (honest pixels: no smoothing of the blockiness under test)."""
    outs = []
    half = CROSSING_CROP // 2
    for rank, site in enumerate(sites, 1):
        band = bands[site["frame"]]
        h, w = band.shape[:2]
        c, r = site["col"], int(nine.seam_row[site["col"]]) - nine.r0_9
        r_lo = max(0, min(h - CROSSING_CROP, r - half))
        cols = np.arange(c - half, c + half) % w
        crop = band[r_lo : r_lo + CROSSING_CROP][:, cols]
        crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        p = out_dir / f"qc_crossing_{rank:02d}_frame_{site['frame']:06d}_col_{c:04d}.png"
        cv2.imwrite(str(p), crop)
        site["path"] = str(p)
        outs.append(str(p))
    return outs


def _save_crops(band: np.ndarray, nine: NineStitcher, out_dir: Path, frame_idx: int) -> list[str]:
    """Zoom crops around every sky seam from one composite band."""
    outs = []
    h, w = band.shape[:2]
    s0 = nine.r0_9

    def crop(name, row_c, col_c, half_r=96, half_c=192):
        r_lo = max(0, min(h - 2 * half_r, row_c - s0 - half_r))
        cols = np.arange(col_c - half_c, col_c + half_c) % w
        img = band[r_lo : r_lo + 2 * half_r][:, cols]
        p = out_dir / f"crop_{name}_frame_{frame_idx:06d}.png"
        cv2.imwrite(str(p), img)
        outs.append(str(p))

    for l in SKY:  # sky-ring seam at each sky cam's yaw
        yaw = (nine.sky_cams[l].yaw + 180.0) % 360.0 - 180.0
        c0 = int(round((yaw / 360.0 + 0.5) * w)) % w
        crop(f"skyring_{l}", int(nine.seam_row[c0]), c0)
    for s in nine.sky_seams:  # sky-sky seams at mid-overlap height
        row_c = (nine.row_cap + nine.sky_r1) // 2
        crop(f"skysky_{s.pair[0]}{s.pair[1]}", row_c, s.col)
    return outs


def cmd_stitch9(args) -> int:
    t_start = time.perf_counter()
    timings: dict[str, float] = {}
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    eq_w, eq_h = args.eq

    t0 = time.perf_counter()
    clip = RingClip(Path(args.drop), letters="ABCDEFGHJ")
    timings["probe_and_align_s"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    ring = RingStitcher(args.pts, eq_w=eq_w, eq_h=eq_h, src_w=clip.width, src_h=clip.height)
    timings["ring_lut_bake_s"] = time.perf_counter() - t0

    # Decode calibration frames ONCE and cache them: RingStitcher gain lock +
    # seam freeze, sky refinement, and nine-cam calibration all reuse them.
    cal_idx = _spread_indices(clip.usable_frames, 6)
    t0 = time.perf_counter()
    cal_frames = [frames for _, frames in clip.read_frames(cal_idx)]
    timings["decode_cal_frames_s"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    ring.calibrate(zip(cal_idx, cal_frames))
    timings["ring_calibrate_s"] = time.perf_counter() - t0

    # ---------------------------------------------------------- sky offsets
    refine_report = None
    if args.offsets:
        doc = json.loads(Path(args.offsets).read_text())
        if "cams" in doc:  # a prior sky_refine.json
            offsets = {l: doc["cams"][l]["offsets_deg"] for l in SKY}
        else:  # flat {letter: {yaw, pitch, roll}}
            offsets = {l: doc[l] for l in SKY}
    elif args.refine:
        t0 = time.perf_counter()
        refiner = SkyRefiner(ring, clip.width, clip.height)
        pick = np.linspace(0, len(cal_frames) - 1, 4).round().astype(int)
        refiner.set_frames([cal_frames[i] for i in pick])
        offsets, refine_report = refiner.refine()
        refine_report["refine_frame_indices"] = [cal_idx[i] for i in pick]
        timings["sky_refine_s"] = time.perf_counter() - t0
        (out_dir / "sky_refine.json").write_text(json.dumps(refine_report, indent=2))
        print(f"wrote {out_dir / 'sky_refine.json'}")
    else:
        offsets = {l: {"yaw": 0.0, "pitch": 0.0, "roll": 0.0} for l in SKY}
        print("WARNING: no --refine/--offsets — using raw .pts sky angles (different shoot day)")

    composite_mode = getattr(args, "composite", "ring-first")
    t0 = time.perf_counter()
    nine = NineStitcher(ring, offsets, composite=composite_mode)
    nine.calibrate(cal_frames)
    timings["nine_calibrate_s"] = time.perf_counter() - t0

    # Round-3 phase polish: the MAD refiner is nearly blind on featureless
    # sky, so polish the sky orientations against the QC phase displacements.
    # OUTER loop: each solve moves the offsets, which moves the recalibrated
    # frozen seams (and with them the QC patch locations), so polish again at
    # the new patches until the update is negligible. Skipped when offsets
    # were supplied verbatim, or with --no-polish.
    polish_report = None
    if not args.offsets and not getattr(args, "no_polish", False):
        t0 = time.perf_counter()
        polish_report = []
        for outer in range(3):
            polish = PhasePolish(nine, cal_frames)
            offsets, rep = polish.solve()
            rep["outer_iteration"] = outer
            polish_report.append(rep)
            nine = NineStitcher(ring, offsets, composite=composite_mode)
            nine.calibrate(cal_frames)
            dmax = max(abs(v) for d in rep["polish_deltas_deg"].values() for v in d.values())
            if dmax < 0.05:
                break
        timings["sky_phase_polish_s"] = time.perf_counter() - t0
        (out_dir / "sky_polish.json").write_text(json.dumps(polish_report, indent=2))
        print(f"wrote {out_dir / 'sky_polish.json'}")
    del cal_frames  # release the cached decode

    metrics = {
        "pipeline": "stitch9 (ring 1.0 + refined sky GHJ)",
        "drop": str(Path(args.drop).resolve()),
        "pts": str(Path(args.pts).resolve()),
        "cams": {
            l: {
                "path": str(c.path), "timecode": c.timecode, "tc_frame": c.tc_frame,
                "offset_frames": c.offset, "nb_frames": c.nb_frames, "fps": c.fps,
                "pix_fmt": c.pix_fmt, "color_range": c.color_range,
                "size_bytes": c.size_bytes, "sha256_first_1mb": c.sha256_first_1mb,
            }
            for l, c in clip.cams.items()
        },
        "usable_frames": clip.usable_frames,
        "fps": clip.fps,
        "src": {"width": clip.width, "height": clip.height},
        "calibration_frame_indices": cal_idx,
        "ring": ring.report(),
        **nine.report(),
        "sky_refine": refine_report,
        "sky_polish": polish_report,
        "tool_versions": _tool_versions(),
        "pts_sha256": hashlib.sha256(open(args.pts, "rb").read()).hexdigest(),
        "stitchlab_git_head": subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=Path(__file__).parent,
        ).stdout.strip(),
        "argv": sys.argv,
    }

    outputs: list[str] = []
    if args.full:
        # Full ProRes render of the 9-cam band (implemented; run only when asked).
        mov_path = out_dir / f"{Path(args.drop).resolve().name}_nineband_prores.mov"
        enc_argv = _encoder_argv(clip, nine, mov_path)
        clip.ffmpeg_calls.append(enc_argv)
        t0 = time.perf_counter()
        n_done = 0
        errf = tempfile.NamedTemporaryFile(prefix="stitch9-enc-", suffix=".stderr", delete=False)
        enc = subprocess.Popen(enc_argv, stdin=subprocess.PIPE, stderr=errf)
        errf.close()
        primary_exc = None
        try:
            for _, frames in clip.iter_frames():
                enc.stdin.write(nine.compose_frame(frames).tobytes())
                n_done += 1
        except BaseException as e:
            primary_exc = e
            raise
        finally:
            try:
                enc.stdin.close()
            except Exception:
                pass
            rc = enc.wait()
            err_txt = ""
            if os.path.exists(errf.name):
                err_txt = open(errf.name, "rb").read().decode(errors="replace")[-2000:]
                os.unlink(errf.name)
            if rc != 0 and primary_exc is None:
                raise RuntimeError(f"prores encode failed (rc={rc}): {err_txt}")
        timings["render_full_s"] = time.perf_counter() - t0
        metrics["full_frames_rendered"] = n_done
        outputs.append(str(mov_path))

    # -------------------------------------------------------- QC pass (always)
    qc_idx = _qc_indices(clip.usable_frames, args.sample, set(cal_idx))

    # Structure-crossing scan: find the frames where structure (the arch
    # crown, wires) rides highest against the sky-ring boundary — those are
    # exactly the frames the old seam policy broke on — and fold the worst K
    # into the QC sample set (evenly-spread frames are kept for coverage,
    # dropping the most redundant spread frames to hold the sample count).
    scan_k = getattr(args, "scan_crossing", 4)
    if scan_k > 0:
        t0 = time.perf_counter()
        scan_idx = [i for i in _spread_indices(clip.usable_frames, 24) if i not in set(cal_idx)]
        scan_scores: dict[int, float] = {}
        for i, frames in clip.read_frames(scan_idx):
            band = nine.compose_frame(frames)
            scan_scores[i] = float(np.percentile(_crossing_scores(band, nine), 99))
        top = [f for f, _ in sorted(scan_scores.items(), key=lambda kv: -kv[1])[:scan_k]]
        merged = sorted(set(qc_idx) | set(top))
        while len(merged) > max(args.sample, 4):
            droppable = [f for f in merged if f not in top]
            if not droppable:
                break
            f = min(droppable, key=lambda x: min(abs(x - o) for o in merged if o != x))
            merged.remove(f)
        qc_idx = merged
        timings["crossing_scan_s"] = time.perf_counter() - t0
        metrics["crossing_scan"] = {
            "frames_scanned": scan_idx,
            "p99_column_score_by_frame": {str(k): round(v, 2) for k, v in sorted(scan_scores.items())},
            "top_frames_added": sorted(top),
        }

    metrics["qc_frame_indices"] = qc_idx
    samples_dir = out_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    qc = QcAccumulator(nine)
    crop_frame = qc_idx[len(qc_idx) // 2]

    t0 = time.perf_counter()
    qc_bands: dict[int, np.ndarray] = {}
    for i, frames in clip.read_frames(qc_idx):
        # One warp per camera per frame: luma feeds the metrics, the composite
        # is rendered from the same frozen weights.
        ring_lums = {}
        for l in ring.order:
            mx, my, _ = ring.maps[l]
            ring_lums[l] = _lin_luma(cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT))
        sky_lums = nine._warp_sky_luma(frames)
        ring_comp = np.zeros((ring.band_h, eq_w), np.float32)
        for l in ring.order:
            ring_comp += ring_lums[l] * ring._weights[l]
        qc.add_frame(ring_lums, sky_lums, ring_comp)

        band = nine.compose_frame(frames)
        qc_bands[i] = band
        png = samples_dir / f"frame_{i:06d}.png"
        cv2.imwrite(str(png), band)
        outputs.append(str(png))
        if i == crop_frame:
            outputs += _save_crops(band, nine, samples_dir, i)

    # Structure-crossing crops: the 6 worst (frame, column) boundary-crossing
    # sites across the QC frames, saved as 2x zoom crops for human review.
    crossing_scores = {i: _crossing_scores(b, nine) for i, b in qc_bands.items()}
    crossing_sites = _pick_crossing_sites(crossing_scores, eq_w)
    outputs += _save_crossing_crops(qc_bands, crossing_sites, nine, samples_dir)
    metrics["qc_crossing"] = {
        "band_half_px": CROSSING_BAND_HALF,
        "percentile": CROSSING_PCTL,
        "sites": crossing_sites,
    }
    del qc_bands
    timings["qc_pass_s"] = time.perf_counter() - t0

    metrics["metrics"] = qc.results()
    timings["total_s"] = time.perf_counter() - t_start
    metrics["timings"] = {k: round(v, 3) for k, v in timings.items()}
    metrics["outputs"] = outputs
    metrics["ffmpeg_subprocess_argv"] = clip.ffmpeg_calls

    metrics_path = out_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2))
    print(f"wrote {metrics_path}")
    for o in outputs:
        print(f"wrote {o}")
    sc = metrics["metrics"]["success_criterion"]
    print(
        f"PASS={sc['pass']} (mad: sky {sc['mean_sky_mad']:.5f} vs ring {sc['mean_ring_mad']:.5f}; "
        f"phase: sky {sc['max_sky_phase_disp_mag']:.2f} vs ring {sc['max_ring_phase_disp_mag']:.2f})"
    )
    return 0 if sc["pass"] else 1
