"""RingStitcher: frozen-geometry, gain-locked, frozen-seam ring compositor.

Design (MVP, per the proven M0 geometry):
  * LUTs are baked ONCE from the PTGui solve via geometry.camera_maps at the
    working proxy resolution; the output is the equirect band of rows where
    union ring coverage exists (r0..r1 of a 3840x1920 canvas).
  * GAIN LOCK (gamma trap): all photometric math happens in LINEAR light,
    x_lin = (x/255)^2.4. Per-camera scalar gains are solved once on a handful
    of frames spread through the clip (least squares over adjacent-pair
    overlap means, anchor A=1.0, averaged over frames) and FROZEN.
  * FROZEN SEAMS: one seam column per adjacent pair (by yaw order; the pair
    that spans +-180 wraps across the canvas edge). Candidates are the
    interior 60% of the overlap; the winner minimizes mean |linear diff| over
    the sample frames. A +-`feather` px linear ramp blends across each seam,
    in linear light, then the result is re-encoded with x^(1/2.4).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from . import geometry
from .pts import load_pts

GAMMA = 2.4
_LIN_LUT = ((np.arange(256, dtype=np.float64) / 255.0) ** GAMMA).astype(np.float32)


def to_linear(img_u8: np.ndarray) -> np.ndarray:
    """uint8 (gamma) -> float32 linear light in [0,1]."""
    return _LIN_LUT[img_u8]


def from_linear(lin: np.ndarray) -> np.ndarray:
    """float32 linear light -> uint8 (gamma)."""
    out = np.power(np.clip(lin, 0.0, 1.0), 1.0 / GAMMA) * 255.0
    return (out + 0.5).astype(np.uint8)


def solve_gains(
    frame_pair_means: list[dict[tuple[str, str], tuple[float, float]]],
    letters: list[str],
    anchor: str = "A",
) -> dict[str, float]:
    """Per-camera scalar gains from adjacent-pair overlap means.

    frame_pair_means: one dict per sample frame mapping (letter_i, letter_j)
    -> (mean linear luminance of cam i in overlap, same for cam j).
    Solved in log domain: for each pair, log g_i - log g_j = log(m_j / m_i),
    with the anchor camera pinned to gain 1.0; least squares per frame,
    gains averaged (log-mean) over frames.
    """
    unknowns = [l for l in letters if l != anchor]
    col = {l: k for k, l in enumerate(unknowns)}
    logs = []
    for pair_means in frame_pair_means:
        rows, rhs = [], []
        for (li, lj), (mi, mj) in pair_means.items():
            if mi <= 0 or mj <= 0:
                continue
            row = np.zeros(len(unknowns))
            if li != anchor:
                row[col[li]] = 1.0
            if lj != anchor:
                row[col[lj]] = -1.0
            rows.append(row)
            rhs.append(math.log(mj / mi))
        if not rows:
            continue
        sol, *_ = np.linalg.lstsq(np.asarray(rows), np.asarray(rhs), rcond=None)
        logs.append(sol)
    if not logs:
        raise ValueError("no usable overlap statistics to solve gains")
    mean_log = np.mean(np.asarray(logs), axis=0)
    gains = {anchor: 1.0}
    gains.update({l: float(math.exp(mean_log[col[l]])) for l in unknowns})
    return gains


def seam_cost_curve(
    blocks_i: list[np.ndarray],
    blocks_j: list[np.ndarray],
    valid_both: np.ndarray,
    gain_i: float,
    gain_j: float,
) -> np.ndarray:
    """Per-column mean |gain_i*lin_i - gain_j*lin_j| over both-valid pixels,
    averaged over sample frames. Columns with no valid pixels get +inf."""
    counts = valid_both.sum(axis=0).astype(np.float64)
    acc = np.zeros(valid_both.shape[1], dtype=np.float64)
    for bi, bj in zip(blocks_i, blocks_j):
        diff = np.abs(gain_i * bi - gain_j * bj)
        acc += np.where(valid_both, diff, 0.0).sum(axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        cost = acc / (counts * len(blocks_i))
    cost[counts < 1] = np.inf
    return cost


@dataclass
class Seam:
    pair: tuple[str, str]
    overlap_lo: int  # unwrapped canvas column (may exceed eq_w for wrap pair)
    overlap_hi: int
    wraps: bool
    col: int = -1  # chosen seam, canvas column (mod eq_w)
    col_unwrapped: int = -1
    lon_deg: float = 0.0
    mean_abs_linear_diff: float = 0.0
    phase_corr_dx: float = 0.0
    phase_corr_dy: float = 0.0
    phase_corr_response: float = 0.0
    cand_lo: int = 0  # candidate window (unwrapped, interior 60%)
    cand_hi: int = 0


class RingStitcher:
    def __init__(
        self,
        pts_path: str,
        eq_w: int = 3840,
        eq_h: int = 1920,
        src_w: int = 2048,
        src_h: int = 1080,
        feather: int = 24,
        min_overlap_rows: int = 32,
    ):
        self.eq_w, self.eq_h = eq_w, eq_h
        self.src_w, self.src_h = src_w, src_h
        self.feather = feather
        self.proj = load_pts(pts_path)
        ring = self.proj.ring
        if len(ring) != 6:
            raise ValueError(f"expected 6 ring cameras, got {len(ring)}")

        # circular order by yaw (normalized to [-180, 180))
        def norm_yaw(y):
            return (y + 180.0) % 360.0 - 180.0

        self.order = [c.letter for c in sorted(ring, key=lambda c: norm_yaw(c.yaw))]

        rays = geometry.equirect_rays(eq_w, eq_h)
        maps_full = {}
        union = np.zeros((eq_h, eq_w), bool)
        for cam in ring:
            mx, my, valid = geometry.camera_maps(cam, eq_w, eq_h, src_w, src_h, rays=rays)
            maps_full[cam.letter] = (mx, my, valid)
            union |= valid
        del rays

        band_rows = np.where(union.any(axis=1))[0]
        self.r0, self.r1 = int(band_rows[0]), int(band_rows[-1]) + 1
        self.band_h = self.r1 - self.r0
        self.maps: dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]] = {
            l: (mx[self.r0 : self.r1].copy(), my[self.r0 : self.r1].copy(), v[self.r0 : self.r1].copy())
            for l, (mx, my, v) in maps_full.items()
        }
        del maps_full

        # adjacent pairs in circular yaw order; last pair wraps +-180
        self.seams: list[Seam] = []
        for k in range(6):
            li, lj = self.order[k], self.order[(k + 1) % 6]
            self.seams.append(self._find_overlap(li, lj, min_overlap_rows))

        self.gains: dict[str, float] = {}
        self._weights: dict[str, np.ndarray] | None = None

    # ------------------------------------------------------------ overlap

    def _find_overlap(self, li: str, lj: str, min_rows: int) -> Seam:
        w = self.eq_w
        both = self.maps[li][2] & self.maps[lj][2]
        colmask = both.sum(axis=0) >= min_rows
        cols = np.where(colmask)[0]
        if cols.size < 8:
            raise ValueError(f"pair {li}-{lj}: no usable overlap columns")
        wraps = bool(colmask[0] and colmask[-1] and not colmask.all())
        if wraps:
            cols = np.where(cols < w // 2, cols + w, cols)
        lo, hi = int(cols.min()), int(cols.max()) + 1
        return Seam(pair=(li, lj), overlap_lo=lo, overlap_hi=hi, wraps=wraps)

    def _block_cols(self, seam: Seam) -> np.ndarray:
        return np.arange(seam.overlap_lo, seam.overlap_hi) % self.eq_w

    # ---------------------------------------------------------- calibrate

    def calibrate(self, frame_iter) -> None:
        """One streaming pass over sample frames: warp, extract overlap blocks,
        then solve gains, freeze seams, measure phase correlation, bake weights.
        frame_iter yields (index, {letter: BGR uint8}).
        """
        blocks: dict[int, tuple[list[np.ndarray], list[np.ndarray]]] = {
            k: ([], []) for k in range(6)
        }
        valid_blocks = {}
        for k, seam in enumerate(self.seams):
            cols = self._block_cols(seam)
            li, lj = seam.pair
            valid_blocks[k] = (self.maps[li][2][:, cols] & self.maps[lj][2][:, cols])

        pair_means: list[dict[tuple[str, str], tuple[float, float]]] = []
        n_frames = 0
        for _, frames in frame_iter:
            n_frames += 1
            lum = {}
            for letter in self.order:
                mx, my, _ = self.maps[letter]
                warped = cv2.remap(frames[letter], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                lum[letter] = to_linear(warped).mean(axis=2)
            means = {}
            for k, seam in enumerate(self.seams):
                cols = self._block_cols(seam)
                li, lj = seam.pair
                bi = np.ascontiguousarray(lum[li][:, cols])
                bj = np.ascontiguousarray(lum[lj][:, cols])
                blocks[k][0].append(bi)
                blocks[k][1].append(bj)
                vb = valid_blocks[k]
                means[(li, lj)] = (float(bi[vb].mean()), float(bj[vb].mean()))
            pair_means.append(means)
        if n_frames == 0:
            raise ValueError("calibrate() received no frames")

        self.gains = solve_gains(pair_means, self.order, anchor="A")
        # Reviewer F4: gains > 1 clip highlights in linear light; normalize so
        # the largest gain is exactly 1.0 (seam cost curves scale uniformly,
        # so seam choice is invariant).
        gmax = max(self.gains.values())
        self.gains = {k: v / gmax for k, v in self.gains.items()}

        for k, seam in enumerate(self.seams):
            li, lj = seam.pair
            gi, gj = self.gains[li], self.gains[lj]
            cost = seam_cost_curve(blocks[k][0], blocks[k][1], valid_blocks[k], gi, gj)
            n = seam.overlap_hi - seam.overlap_lo
            c0 = int(round(0.2 * n))
            c1 = max(c0 + 1, int(round(0.8 * n)))
            seam.cand_lo = seam.overlap_lo + c0
            seam.cand_hi = seam.overlap_lo + c1
            best_rel = c0 + int(np.argmin(cost[c0:c1]))
            seam.col_unwrapped = seam.overlap_lo + best_rel
            seam.col = seam.col_unwrapped % self.eq_w
            seam.lon_deg = ((seam.col + 0.5) / self.eq_w) * 360.0 - 180.0
            seam.mean_abs_linear_diff = float(cost[best_rel])
            self._phase_correlate(seam, k, blocks, valid_blocks[k], best_rel, gi, gj)

        self._build_weights()

    def _phase_correlate(self, seam, k, blocks, valid_both, best_rel, gi, gj, half: int = 64):
        """Far-field residual displacement across the seam via phase correlation
        on the gain-corrected linear luminance patches around the seam column."""
        n = valid_both.shape[1]
        a = max(0, best_rel - half)
        b = min(n, best_rel + half + 1)
        rows = np.where(valid_both[:, a:b].all(axis=1))[0]
        if rows.size < 32:  # fall back to the most-covered rows
            rows = np.argsort(valid_both[:, a:b].sum(axis=1))[-64:]
            rows.sort()
        pi = np.mean([blk[np.ix_(rows, np.arange(a, b))] for blk in blocks[k][0]], axis=0)
        pj = np.mean([blk[np.ix_(rows, np.arange(a, b))] for blk in blocks[k][1]], axis=0)
        pi = np.ascontiguousarray(pi * gi, dtype=np.float32)
        pj = np.ascontiguousarray(pj * gj, dtype=np.float32)
        hann = cv2.createHanningWindow((pi.shape[1], pi.shape[0]), cv2.CV_32F)
        (dx, dy), resp = cv2.phaseCorrelate(pi, pj, hann)
        seam.phase_corr_dx = float(dx)
        seam.phase_corr_dy = float(dy)
        seam.phase_corr_response = float(resp)

    # ------------------------------------------------------------ weights

    def _col_weight(self, left_seam: int, right_seam: int) -> np.ndarray:
        """Column weight for a camera owning the unwrapped arc
        [left_seam, right_seam], with +-feather linear ramps at both ends."""
        w, f = self.eq_w, float(self.feather)
        cols = np.arange(w, dtype=np.float64)
        d_from_l = (cols - left_seam + w / 2) % w - w / 2  # signed circular distance
        d_to_r = (right_seam - cols + w / 2) % w - w / 2
        ramp_l = np.clip((d_from_l + f) / (2 * f), 0.0, 1.0)
        ramp_r = np.clip((d_to_r + f) / (2 * f), 0.0, 1.0)
        return (ramp_l * ramp_r).astype(np.float32)

    def _build_weights(self) -> None:
        eps = 1e-4
        w_raw = {}
        for k, letter in enumerate(self.order):
            # camera order[k] sits between seam k-1 (left) and seam k (right)
            left = self.seams[(k - 1) % 6].col_unwrapped % self.eq_w
            right = self.seams[k].col_unwrapped % self.eq_w
            colw = self._col_weight(left, right)
            valid = self.maps[letter][2]
            w_raw[letter] = (colw[None, :] + eps) * valid.astype(np.float32)
        total = np.zeros((self.band_h, self.eq_w), np.float32)
        for arr in w_raw.values():
            total += arr
        self._weights = {}
        safe = np.where(total > 0, total, 1.0)
        for letter, arr in w_raw.items():
            self._weights[letter] = (arr / safe) * self.gains[letter]

    # ------------------------------------------------------------- compose

    def compose_frame(self, frames: dict[str, np.ndarray]) -> np.ndarray:
        """Blend one aligned frame set into the output band (BGR uint8)."""
        if self._weights is None:
            raise RuntimeError("calibrate() must run before compose_frame()")
        acc = np.zeros((self.band_h, self.eq_w, 3), np.float32)
        for letter in self.order:
            mx, my, _ = self.maps[letter]
            warped = cv2.remap(frames[letter], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            acc += to_linear(warped) * self._weights[letter][:, :, None]
        return from_linear(acc)

    # ------------------------------------------------------------- report

    def report(self) -> dict:
        return {
            "eq": {"width": self.eq_w, "height": self.eq_h},
            "band": {"r0": self.r0, "r1": self.r1, "height": self.band_h},
            "ring_order_by_yaw": self.order,
            "gains": {l: self.gains.get(l) for l in self.order},
            "feather_px": self.feather,
            "gamma": GAMMA,
            "seams": [
                {
                    "pair": f"{s.pair[0]}-{s.pair[1]}",
                    "wraps_180": s.wraps,
                    "overlap_cols": [s.overlap_lo, s.overlap_hi],
                    "candidate_cols": [s.cand_lo, s.cand_hi],
                    "seam_col": s.col,
                    "seam_lon_deg": round(s.lon_deg, 3),
                    "mean_abs_linear_diff": s.mean_abs_linear_diff,
                    "phase_corr_displacement_px": {
                        "dx": s.phase_corr_dx,
                        "dy": s.phase_corr_dy,
                        "response": s.phase_corr_response,
                    },
                }
                for s in self.seams
            ],
        }
