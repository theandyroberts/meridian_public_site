"""Empirical per-camera temporal offset measurement (TC-jam-synced, not genlocked).

Motivation (Andy's ALL-9 viaduct review): a seam line flowing over and down every
right-side arch, "frontmost camera on that side a frame behind, or less". The rig
is frame-quantized by RingClip's TC alignment, but the cameras are NOT genlocked,
so exposure instants can differ by up to +-0.5 frame — and a wrong TC tag would
put a camera a FULL frame off. This module distinguishes the two empirically.

Method
------
For each adjacent ring pair (yaw order, incl. the +-180 wrap) and each sky cam
G/H/J against its nearest ring cams (by equirect overlap area):
  * Warp both cameras into equirect (same geometry.camera_maps LUTs the
    stitchers use, at a reduced canvas), restrict to the pair's valid-overlap
    bounding box. Ring-ring overlaps are additionally restricted to latitudes
    above the near ground (near-field parallax is motion-aligned for side cams
    and would masquerade as a temporal offset).
  * For candidate lags tau: compare cam_i at aligned frame t vs cam_j at
    t + tau, where the fractional frame of cam_j is synthesized by
    motion-compensated interpolation WITHIN cam_j's own stream: DIS optical
    flow between consecutive frames n -> n+1 (source space), then the
    symmetric two-source blend
        I(n+f) = (1-f) * I_n(y - f*flow(y)) + f * I_{n+1}(y + (1-f)*flow(y)).
    (Sign verified empirically: remap(I_n, grid - flow) reconstructs I_{n+1}.)
  * Residual(tau) = masked mean |linear-luma diff| after a per-eval scalar
    gain (ratio of overlap means), normalized by the reference mean so pairs
    are comparable; both patches get a mild fixed Gaussian blur so the
    synthesized side's resampling softness doesn't bias integer taus.
  * Coarse grid -2.0..+2.0 step 0.25, per-frame refine step 0.05 around the
    per-frame coarse minimum, parabolic sub-step vertex.
  * Frames whose overlap has too little gradient energy are EXCLUDED (gate);
    per-pair lag = median of per-frame vertices, spread = robust MAD.
  * Cross-check per pair (interpolation-free): phase-correlate the overlap at
    integer lags k in {-1, 0, +1}; the zero-crossing of the dx(k) line is an
    independent lag estimate, and its slope IS the overlap image motion in
    equirect px per frame of lag (used for the seam-displacement arithmetic).

Global solve: pairwise lags m_ij ~ e_i - e_j (least squares, anchor e_A = 0,
weights from per-pair spread), where e_X means: cam X's aligned frame n shows
the world e_X frames LATER than cam A's frame n. To correct, sample cam X at
index n - e_X. Ring loop closure (sum of directed lags around the 6-cycle)
should be ~0 if the measurements are consistent.

Everything is measurement-only: no stitcher module is touched.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import geometry
from .clip import RingClip
from .ninestitch import _apply_offsets
from .pts import load_pts
from .ringstitch import to_linear

ALL9 = "ABCDEFGHJ"
RING = "ABCDEF"
SKY = "GHJ"

#: latitude band (deg) kept for ring-ring overlaps: cut the near ground
#: (motion-aligned parallax) and the stretched top edge of the ring cams.
RING_LAT_LO = -5.0
RING_LAT_HI = 62.0
MIN_OVERLAP_ROWS = 20
MIN_OVERLAP_PX = 4000

COARSE_HALF = 2.0
COARSE_STEP = 0.25
FINE_STEP = 0.05
FINE_HALF = 0.30
#: mild fixed blur applied to BOTH equirect patches before differencing, so
#: the synthesized side's extra bilinear softness cannot carve valleys at
#: integer taus (where f=0 needs no resampling).
PATCH_BLUR_SIGMA = 0.8
#: texture gate: mean Sobel gradient magnitude of the reference patch divided
#: by its mean luma; below this the residual-vs-tau curve is untrustworthy.
GRAD_GATE_DEFAULT = 0.05
#: motion gate (px/frame at the measurement canvas): with no image motion in
#: the overlap a temporal lag is UNOBSERVABLE (the residual curve is flat and
#: its minimum is noise) — pilot run: stationary end-of-clip frames produced
#: fake 1.3-1.6-frame lags on low-motion pairs. Measured via the phase-probe
#: displacement slope between integer lags.
MOTION_GATE_DEFAULT = 2.5
#: curve-contrast gate: median/min of the coarse residual curve. Flat curves
#: (contrast ~1.0) carry no lag information regardless of texture.
CONTRAST_GATE_DEFAULT = 1.12


# ------------------------------------------------------------------ pair prep


@dataclass
class PairSpec:
    li: str                      # reference cam (fixed at frame t)
    lj: str                      # probed cam (interpolated at t + tau)
    kind: str                    # "ring" | "sky-ring"
    r0: int = 0
    r1: int = 0
    cols: np.ndarray | None = None      # canvas columns of the crop (wrap-safe)
    mask: np.ndarray | None = None      # both-valid inside the crop
    maps_i: tuple | None = None         # cropped (map_x, map_y) for cam i
    maps_j: tuple | None = None
    overlap_px: int = 0
    # accumulated measurements
    frames: list[dict] = field(default_factory=list)

    @property
    def name(self) -> str:
        return f"{self.li}-{self.lj}"


def _crop_pair(maps, li, lj, eq_w, row_lo, row_hi, kind) -> PairSpec | None:
    vi = maps[li][2][row_lo:row_hi]
    vj = maps[lj][2][row_lo:row_hi]
    both = vi & vj
    colcnt = both.sum(axis=0)
    colmask = colcnt >= MIN_OVERLAP_ROWS
    idx = np.where(colmask)[0]
    if idx.size < 8:
        return None
    wraps = bool(colmask[0] and colmask[-1] and not colmask.all())
    if wraps:
        unw = np.where(idx < eq_w // 2, idx + eq_w, idx)
        cols = np.arange(int(unw.min()), int(unw.max()) + 1) % eq_w
    else:
        cols = np.arange(int(idx.min()), int(idx.max()) + 1)
    sub = both[:, cols]
    rowidx = np.where(sub.any(axis=1))[0]
    if rowidx.size < MIN_OVERLAP_ROWS:
        return None
    r0, r1 = row_lo + int(rowidx[0]), row_lo + int(rowidx[-1]) + 1
    mask = (maps[li][2] & maps[lj][2])[r0:r1][:, cols]
    if int(mask.sum()) < MIN_OVERLAP_PX:
        return None
    spec = PairSpec(li=li, lj=lj, kind=kind, r0=r0, r1=r1, cols=cols, mask=mask)
    spec.maps_i = (maps[li][0][r0:r1][:, cols].copy(), maps[li][1][r0:r1][:, cols].copy())
    spec.maps_j = (maps[lj][0][r0:r1][:, cols].copy(), maps[lj][1][r0:r1][:, cols].copy())
    spec.overlap_px = int(mask.sum())
    return spec


def build_pairs(cams: dict, eq_w: int, eq_h: int, src_w: int, src_h: int):
    """Ring adjacent pairs (yaw order) + each sky cam vs its top-2 ring cams."""
    rays = geometry.equirect_rays(eq_w, eq_h)
    maps = {}
    for l, cam in cams.items():
        mx, my, valid = geometry.camera_maps(cam, eq_w, eq_h, src_w, src_h, rays=rays)
        maps[l] = (mx, my, valid)
    del rays

    def norm_yaw(y):
        return (y + 180.0) % 360.0 - 180.0

    order = sorted(RING, key=lambda l: norm_yaw(cams[l].yaw))
    lat_row = lambda lat: int(round((0.5 - lat / 180.0) * eq_h))
    ring_lo, ring_hi = lat_row(RING_LAT_HI), lat_row(RING_LAT_LO)

    pairs: list[PairSpec] = []
    for k in range(6):
        li, lj = order[k], order[(k + 1) % 6]
        spec = _crop_pair(maps, li, lj, eq_w, ring_lo, ring_hi, "ring")
        if spec is None:
            raise ValueError(f"ring pair {li}-{lj}: no usable overlap")
        pairs.append(spec)

    for s in SKY:
        counts = {r: int((maps[s][2] & maps[r][2]).sum()) for r in RING}
        for r in sorted(counts, key=counts.get, reverse=True)[:2]:
            spec = _crop_pair(maps, r, s, eq_w, 0, eq_h // 2 + eq_h // 8, "sky-ring")
            if spec is not None:
                pairs.append(spec)
    return pairs, order


# ------------------------------------------------------- per-sample working set


class SampleSet:
    """Decoded source-space luma + lazy DIS flows for one sample time t."""

    def __init__(self, clip: RingClip, t: int, lo: int, hi: int):
        self.t = t
        self.lo = lo
        self.luma: dict[str, dict[int, np.ndarray]] = {l: {} for l in ALL9}
        self.gray: dict[str, dict[int, np.ndarray]] = {l: {} for l in ALL9}
        for i, frames in clip.read_frames(range(lo, hi)):
            for l in ALL9:
                bgr = frames[l]
                self.gray[l][i] = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
                self.luma[l][i] = to_linear(bgr).mean(axis=2)
        h, w = next(iter(self.luma["A"].values())).shape
        self.grid_x, self.grid_y = np.meshgrid(
            np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32)
        )
        self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self._flows: dict[tuple[str, int], np.ndarray] = {}
        self._synth: dict[tuple[str, float], np.ndarray] = {}

    def flow(self, l: str, n: int) -> np.ndarray:
        key = (l, n)
        if key not in self._flows:
            self._flows[key] = self._dis.calc(self.gray[l][n], self.gray[l][n + 1], None)
        return self._flows[key]

    def synth(self, l: str, ft: float) -> np.ndarray:
        """Source-space linear luma of cam `l` at fractional frame index `ft`."""
        n = int(math.floor(ft + 1e-9))
        f = float(ft) - n  # plain python float: keeps the remap maps float32
        if f < 1e-6:
            return self.luma[l][n]
        key = (l, round(ft, 4))
        if key in self._synth:
            return self._synth[key]
        fl = self.flow(l, n)
        fx, fy = fl[..., 0], fl[..., 1]
        a = cv2.remap(self.luma[l][n], self.grid_x - f * fx, self.grid_y - f * fy,
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        b = cv2.remap(self.luma[l][n + 1], self.grid_x + (1.0 - f) * fx,
                      self.grid_y + (1.0 - f) * fy,
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        out = (1.0 - f) * a + f * b
        self._synth[key] = out
        return out


# ------------------------------------------------------------- measurement core


def _warp_crop(src: np.ndarray, maps: tuple) -> np.ndarray:
    return cv2.remap(src, maps[0], maps[1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def _blur(img: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(img, (0, 0), PATCH_BLUR_SIGMA)


def _residual(ref_b: np.ndarray, ref_mean: float, wj: np.ndarray, mask: np.ndarray) -> float:
    wj_b = _blur(wj)
    mj = float(wj_b[mask].mean())
    if mj <= 1e-8:
        return float("inf")
    gain = ref_mean / mj
    return float(np.abs(ref_b[mask] - gain * wj_b[mask]).mean() / (ref_mean + 1e-8))


def _parabolic_vertex(taus: np.ndarray, vals: np.ndarray) -> float:
    k = int(np.argmin(vals))
    if k == 0 or k == len(vals) - 1:
        return float(taus[k])
    y0, y1, y2 = vals[k - 1], vals[k], vals[k + 1]
    denom = y0 - 2 * y1 + y2
    if denom <= 1e-12:
        return float(taus[k])
    step = taus[k + 1] - taus[k]
    return float(taus[k] + 0.5 * (y0 - y2) / denom * step)


def _grad_energy(patch: np.ndarray, mask: np.ndarray) -> float:
    gx = cv2.Sobel(patch, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(patch, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    m = float(patch[mask].mean())
    return float(mag[mask].mean() / (m + 1e-8))


def _phase_probe(pair: PairSpec, ref: np.ndarray, ss: SampleSet, t: int) -> dict:
    """Interpolation-free integer-lag probe: dx(k) for k in {-1,0,+1}."""
    mask = pair.mask
    fill = float(ref[mask].mean())
    a = np.where(mask, ref, fill).astype(np.float32)
    hann = cv2.createHanningWindow((a.shape[1], a.shape[0]), cv2.CV_32F)
    out = {}
    for k in (-1, 0, 1):
        wj = _warp_crop(ss.luma[pair.lj][t + k], pair.maps_j)
        mj = float(wj[mask].mean())
        gain = fill / mj if mj > 1e-8 else 1.0
        b = np.where(mask, gain * wj, fill).astype(np.float32)
        (dx, dy), resp = cv2.phaseCorrelate(a, b, hann)
        out[k] = {"dx": float(dx), "dy": float(dy), "resp": float(resp)}
    slope_dx = (out[1]["dx"] - out[-1]["dx"]) / 2.0
    slope_dy = (out[1]["dy"] - out[-1]["dy"]) / 2.0
    motion = math.hypot(slope_dx, slope_dy)
    # Project the displacements onto the motion direction; the zero-crossing
    # of that line is the interpolation-free lag estimate.
    root = None
    if motion >= 1.0:
        ux, uy = slope_dx / motion, slope_dy / motion
        proj = {k: out[k]["dx"] * ux + out[k]["dy"] * uy for k in (-1, 0, 1)}
        root = -(proj[-1] + proj[0] + proj[1]) / 3.0 / motion
    return {
        "dx_by_lag": {str(k): round(out[k]["dx"], 3) for k in (-1, 0, 1)},
        "dy_by_lag": {str(k): round(out[k]["dy"], 3) for k in (-1, 0, 1)},
        "resp_by_lag": {str(k): round(out[k]["resp"], 3) for k in (-1, 0, 1)},
        "slope_dx_px_per_frame": slope_dx,
        "slope_dy_px_per_frame": slope_dy,
        "motion_px_per_frame": motion,
        "root_lag_frames": root,
    }


def measure_pair_at(pair: PairSpec, ss: SampleSet, coarse_taus: np.ndarray,
                    grad_gate: float, motion_gate: float, contrast_gate: float) -> dict:
    t = ss.t
    ref = _warp_crop(ss.luma[pair.li][t], pair.maps_i)
    grad = _grad_energy(ref, pair.mask)
    rec: dict = {"t": t, "grad_energy": round(grad, 4)}
    if grad < grad_gate:
        rec["gated"] = "low_texture"
        return rec
    rec["phase_probe"] = _phase_probe(pair, ref, ss, t)
    motion = rec["phase_probe"]["motion_px_per_frame"]
    if motion < motion_gate:
        rec["gated"] = "low_motion"  # lag unobservable without image motion
        return rec
    rec["gated"] = None

    ref_b = _blur(ref)
    ref_mean = float(ref_b[pair.mask].mean())

    coarse = np.array([
        _residual(ref_b, ref_mean, _warp_crop(ss.synth(pair.lj, t + tau), pair.maps_j), pair.mask)
        for tau in coarse_taus
    ])
    kmin = int(np.argmin(coarse))
    tau_c = float(coarse_taus[kmin])
    rec["coarse_curve"] = [round(float(v), 6) for v in coarse]
    rec["coarse_min_tau"] = tau_c
    rec["boundary_hit"] = kmin in (0, len(coarse_taus) - 1)
    med = float(np.median(coarse))
    mn = float(coarse[kmin])
    rec["contrast"] = round(med / mn, 3) if mn > 1e-9 else None
    if rec["contrast"] is not None and rec["contrast"] < contrast_gate:
        rec["gated"] = "flat_curve"
        return rec

    fine_taus = np.round(np.arange(tau_c - FINE_HALF, tau_c + FINE_HALF + 1e-9, FINE_STEP), 4)
    fine = np.array([
        _residual(ref_b, ref_mean, _warp_crop(ss.synth(pair.lj, t + tau), pair.maps_j), pair.mask)
        for tau in fine_taus
    ])
    tau_star = _parabolic_vertex(fine_taus, fine)
    rec["fine_taus"] = [float(x) for x in fine_taus]
    rec["fine_curve"] = [round(float(v), 6) for v in fine]
    rec["tau_star"] = round(float(tau_star), 4)
    return rec


# ------------------------------------------------------------------ aggregation


def aggregate_pair(pair: PairSpec) -> dict:
    used = [r for r in pair.frames if r.get("gated") is None and not r.get("boundary_hit")]
    gate_counts: dict[str, int] = {}
    for r in pair.frames:
        g = r.get("gated")
        if g:
            gate_counts[g] = gate_counts.get(g, 0) + 1
        elif r.get("boundary_hit"):
            gate_counts["boundary_hit"] = gate_counts.get("boundary_hit", 0) + 1
    res: dict = {
        "pair": pair.name,
        "kind": pair.kind,
        "overlap_px": pair.overlap_px,
        "n_frames_measured": len(pair.frames),
        "n_frames_used": len(used),
        "gated": gate_counts,
        "grad_energies": [r["grad_energy"] for r in pair.frames],
    }
    if not used:
        res["lag_frames"] = None
        return res
    taus = np.array([r["tau_star"] for r in used])
    lag = float(np.median(taus))
    mad = float(np.median(np.abs(taus - lag))) * 1.4826
    res["lag_frames"] = round(lag, 4)
    res["per_frame_tau_star"] = [round(float(x), 4) for x in taus]
    res["spread_mad_frames"] = round(mad, 4)
    res["contrast_median"] = round(float(np.median([r["contrast"] for r in used if r.get("contrast")])), 3)
    roots = [r["phase_probe"]["root_lag_frames"] for r in used
             if r["phase_probe"]["root_lag_frames"] is not None]
    roots = [x for x in roots if abs(x) < 3.0]
    motions = [r["phase_probe"]["motion_px_per_frame"] for r in used]
    res["phase_slope_lag_frames"] = round(float(np.median(roots)), 4) if roots else None
    res["motion_px_per_frame_eq"] = round(float(np.median(motions)), 2)
    res["motion_dx_px_per_frame_eq"] = round(float(np.median(
        [r["phase_probe"]["slope_dx_px_per_frame"] for r in used])), 2)
    # confidence weight for the global solve: frames used / robust variance
    sigma = max(mad, 0.02)
    res["weight"] = round(len(used) / (sigma * sigma), 1)
    return res


def solve_global(pair_results: list[dict], anchor: str = "A"):
    """Weighted LS: e_i - e_j = lag_ij, anchor e_A = 0. Cameras with no
    surviving measurement are reported as None (unconstrained)."""
    measured = set()
    for pr in pair_results:
        if pr["lag_frames"] is not None:
            li, lj = pr["pair"].split("-")
            measured.update((li, lj))
    unknowns = [l for l in ALL9 if l != anchor and l in measured]
    col = {l: k for k, l in enumerate(unknowns)}
    rows, rhs = [], []
    for pr in pair_results:
        if pr["lag_frames"] is None:
            continue
        li, lj = pr["pair"].split("-")
        w = math.sqrt(pr["weight"])
        row = np.zeros(len(unknowns))
        if li != anchor:
            row[col[li]] = 1.0
        if lj != anchor:
            row[col[lj]] = -1.0
        rows.append(row * w)
        rhs.append(pr["lag_frames"] * w)
    A = np.asarray(rows)
    b = np.asarray(rhs)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    e: dict[str, float | None] = {l: None for l in ALL9}
    e[anchor] = 0.0
    e.update({l: float(sol[col[l]]) for l in unknowns})
    # per-cam formal std err from the weighted normal equations
    resid = A @ sol - b
    dof = max(len(b) - len(unknowns), 1)
    s2 = float(resid @ resid) / dof
    cov = s2 * np.linalg.pinv(A.T @ A)
    stderr: dict[str, float | None] = {l: None for l in ALL9}
    stderr[anchor] = 0.0
    stderr.update({l: float(math.sqrt(max(cov[col[l], col[l]], 0.0))) for l in unknowns})
    return e, stderr


# ----------------------------------------------------------------------- plots


def plot_pair_png(path: Path, pair_res: dict, frames: list[dict], coarse_taus: np.ndarray):
    """Residual-vs-tau evidence plot rendered with cv2 primitives."""
    W, H = 900, 560
    ml, mr, mt, mb = 70, 20, 50, 60
    img = np.full((H, W, 3), 255, np.uint8)
    used = [r for r in frames if "coarse_curve" in r]
    if not used:
        cv2.putText(img, f"{pair_res['pair']}: all frames gated {pair_res.get('gated')}",
                    (40, H // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 200), 2)
        cv2.imwrite(str(path), img)
        return
    curves = [np.array(r["coarse_curve"]) for r in used]
    allv = np.concatenate(curves)
    vmax = float(np.percentile(allv, 99)) * 1.05
    vmin = 0.0
    x0, x1 = float(coarse_taus[0]), float(coarse_taus[-1])

    def px(tau, v):
        x = ml + (tau - x0) / (x1 - x0) * (W - ml - mr)
        y = mt + (1.0 - (v - vmin) / (vmax - vmin)) * (H - mt - mb)
        return int(round(x)), int(round(max(mt, min(H - mb, y))))

    # axes + grid
    cv2.rectangle(img, (ml, mt), (W - mr, H - mb), (0, 0, 0), 1)
    for tau in np.arange(-2.0, 2.01, 0.5):
        x, _ = px(tau, vmin)
        cv2.line(img, (x, H - mb), (x, mt), (235, 235, 235), 1)
        cv2.line(img, (x, H - mb), (x, H - mb + 5), (0, 0, 0), 1)
        cv2.putText(img, f"{tau:+.1f}", (x - 18, H - mb + 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    xz, _ = px(0.0, vmin)
    cv2.line(img, (xz, H - mb), (xz, mt), (200, 200, 200), 1)
    for gv in np.linspace(vmin, vmax, 5):
        _, y = px(x0, gv)
        cv2.line(img, (ml - 5, y), (ml, y), (0, 0, 0), 1)
        cv2.putText(img, f"{gv:.3f}", (5, y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 1)

    # per-frame coarse curves (faint) + fine curves (colored)
    for r in used:
        pts = [px(t, v) for t, v in zip(coarse_taus, r["coarse_curve"])]
        for p, q in zip(pts[:-1], pts[1:]):
            cv2.line(img, p, q, (215, 215, 215), 1, cv2.LINE_AA)
    mean_coarse = np.mean(curves, axis=0)
    pts = [px(t, v) for t, v in zip(coarse_taus, mean_coarse)]
    for p, q in zip(pts[:-1], pts[1:]):
        cv2.line(img, p, q, (160, 80, 0), 2, cv2.LINE_AA)
    for r in used:
        if "fine_taus" not in r:
            continue
        pts = [px(t, v) for t, v in zip(r["fine_taus"], r["fine_curve"])]
        for p, q in zip(pts[:-1], pts[1:]):
            cv2.line(img, p, q, (60, 140, 60), 1, cv2.LINE_AA)

    lag = pair_res.get("lag_frames")
    if lag is not None:
        x, _ = px(lag, vmin)
        cv2.line(img, (x, H - mb), (x, mt), (0, 0, 220), 2)
        cv2.putText(img, f"lag = {lag:+.3f} f", (min(x + 6, W - 170), mt + 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 220), 2)
    ps = pair_res.get("phase_slope_lag_frames")
    sub = f"phase-slope xcheck {ps:+.3f} f" if ps is not None else "phase-slope xcheck n/a"
    title = (f"{pair_res['pair']} ({pair_res['kind']})  n={pair_res['n_frames_used']} used"
             f"/{pair_res['n_frames_measured']}  MAD={pair_res.get('spread_mad_frames')}")
    cv2.putText(img, title, (ml, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1)
    cv2.putText(img, sub + f"   motion {pair_res.get('motion_dx_px_per_frame_eq')} px/f (eq)",
                (ml, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 100), 1)
    cv2.putText(img, "residual (norm. mean |lin diff|) vs tau (frames): cam_i @ t  vs  cam_j @ t+tau",
                (ml, H - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 100, 100), 1)
    cv2.imwrite(str(path), img)


# ------------------------------------------------------------------------ main


def cmd_temporal(args) -> int:
    t_start = time.perf_counter()
    out_dir = Path(args.out)
    (out_dir / "plots").mkdir(parents=True, exist_ok=True)
    eq_w, eq_h = args.eq

    clip = RingClip(Path(args.drop), letters=ALL9)
    proj = load_pts(args.pts)
    sky_off = {}
    if args.sky_offsets:
        doc = json.loads(Path(args.sky_offsets).read_text())
        sky_off = {l: doc["cams"][l]["offsets_deg"] for l in SKY} if "cams" in doc \
            else {l: doc[l] for l in SKY}
    cams = {l: _apply_offsets(proj.by_letter[l], sky_off.get(l, {})) for l in ALL9}

    pairs, ring_order = build_pairs(cams, eq_w, eq_h, clip.width, clip.height)
    print(f"pairs: {[p.name for p in pairs]}")

    pad = int(math.ceil(COARSE_HALF)) + 1
    lo_t, hi_t = pad, clip.usable_frames - pad - 1
    if args.frames:
        sample_ts = sorted(set(
            min(hi_t, max(lo_t, int(x))) for x in args.frames.split(",")))
    else:
        sample_ts = sorted(set(int(round(x)) for x in np.linspace(lo_t, hi_t, args.samples)))
    print(f"sample frames ({len(sample_ts)}): {sample_ts}")

    coarse_taus = np.round(np.arange(-COARSE_HALF, COARSE_HALF + 1e-9, COARSE_STEP), 4)

    for t in sample_ts:
        t0 = time.perf_counter()
        ss = SampleSet(clip, t, t - pad, t + pad + 1)
        for pair in pairs:
            pair.frames.append(measure_pair_at(pair, ss, coarse_taus, args.grad_gate,
                                               args.motion_gate, args.contrast_gate))
        del ss
        print(f"  t={t}: {time.perf_counter() - t0:.1f}s")

    pair_results = [aggregate_pair(p) for p in pairs]
    solvable = [pr for pr in pair_results if pr["lag_frames"] is not None]
    offsets, stderr = solve_global(solvable)

    # ring loop closure from raw directed pair lags
    by_name = {pr["pair"]: pr for pr in pair_results}
    loop = 0.0
    loop_terms = {}
    loop_ok = True
    for k in range(6):
        li, lj = ring_order[k], ring_order[(k + 1) % 6]
        pr = by_name.get(f"{li}-{lj}")
        if pr is None or pr["lag_frames"] is None:
            loop_ok = False
            continue
        loop += pr["lag_frames"]
        loop_terms[pr["pair"]] = pr["lag_frames"]

    # residuals of each pair against the solved offsets
    for pr in pair_results:
        if pr["lag_frames"] is None or offsets[pr["pair"][0]] is None or offsets[pr["pair"][2]] is None:
            pr["solve_residual_frames"] = None
            continue
        li, lj = pr["pair"].split("-")
        pr["solve_residual_frames"] = round(pr["lag_frames"] - (offsets[li] - offsets[lj]), 4)

    verdict = {}
    for l in ALL9:
        e = offsets[l]
        if e is None:
            verdict[l] = "UNCONSTRAINED (all measurements gated)"
        elif abs(e) >= 0.75:
            verdict[l] = "FULL-FRAME (TC tag error suspected)"
        elif abs(e) >= 0.1:
            verdict[l] = "sub-frame (genlock-free exposure offset)"
        else:
            verdict[l] = "aligned (<0.1 frame)"

    doc = {
        "task": "per-camera temporal offset measurement (viaduct-local9)",
        "drop": str(Path(args.drop).resolve()),
        "pts": str(Path(args.pts).resolve()),
        "sky_offsets_file": str(Path(args.sky_offsets).resolve()) if args.sky_offsets else None,
        "method": {
            "eq_canvas": [eq_w, eq_h],
            "comparison": "cam_i @ t (fixed) vs cam_j @ t+tau (DIS motion-compensated "
                          "interpolation within cam_j's own stream, symmetric two-source blend)",
            "residual": "masked mean |linear-luma diff| after per-eval scalar gain, "
                        "normalized by reference mean; Gaussian blur sigma "
                        f"{PATCH_BLUR_SIGMA} on both patches",
            "coarse_taus": [float(x) for x in coarse_taus],
            "fine_step": FINE_STEP,
            "fine_half": FINE_HALF,
            "parabolic_vertex": True,
            "grad_gate": args.grad_gate,
            "motion_gate_px_per_frame": args.motion_gate,
            "contrast_gate": args.contrast_gate,
            "ring_lat_band_deg": [RING_LAT_LO, RING_LAT_HI],
            "sample_frames": sample_ts,
            "sign_convention": "offset e_X > 0 means cam X's aligned frame n shows the world "
                               "e_X frames LATER than cam A's frame n; correct by sampling "
                               "cam X at n - e_X. Pairwise lag_ij estimates e_i - e_j.",
            "cross_check": "interpolation-free phase-correlation dx at integer lags -1/0/+1; "
                           "zero-crossing of the dx(k) line = lag, slope = overlap motion px/frame",
        },
        "ring_order_by_yaw": ring_order,
        "tc_align_offsets_frames": clip.offsets,
        "pairs": pair_results,
        "per_cam_offsets_frames": {l: (round(offsets[l], 4) if offsets[l] is not None else None)
                                   for l in ALL9},
        "per_cam_stderr_frames": {l: (round(stderr[l], 4) if stderr[l] is not None else None)
                                  for l in ALL9},
        "ring_loop_closure_frames": round(loop, 4) if loop_ok else None,
        "ring_loop_terms": loop_terms,
        "verdict_per_cam": verdict,
        "runtime_s": round(time.perf_counter() - t_start, 1),
    }
    out_json = out_dir / "offsets.json"
    # per-frame curves live in a side file to keep offsets.json readable
    detail = {p.name: p.frames for p in pairs}
    (out_dir / "curves_detail.json").write_text(json.dumps(detail, indent=1))
    out_json.write_text(json.dumps(doc, indent=2))
    print(f"wrote {out_json}")

    for pair, pr in zip(pairs, pair_results):
        png = out_dir / "plots" / f"pair_{pair.name}.png"
        plot_pair_png(png, pr, pair.frames, coarse_taus)
        print(f"wrote {png}")

    print("\nper-cam offsets (frames, anchor A=0):")
    for l in ALL9:
        if offsets[l] is None:
            print(f"  {l}: unconstrained   {verdict[l]}")
        else:
            print(f"  {l}: {offsets[l]:+.3f} +- {stderr[l]:.3f}   {verdict[l]}")
    print(f"ring loop closure: {loop:+.4f} frames" if loop_ok else "ring loop closure: incomplete")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="stitchlab.temporal",
                                 description="empirical per-camera temporal offset measurement")
    ap.add_argument("--drop", required=True)
    ap.add_argument("--pts", required=True)
    ap.add_argument("--sky-offsets", help="sky ypr offsets JSON (round3 polished)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--samples", type=int, default=12)
    ap.add_argument("--frames", help="explicit comma-separated sample frame indices "
                                     "(e.g. picked from a motion profile); overrides --samples")
    ap.add_argument("--eq", type=int, nargs=2, default=[2048, 1024], metavar=("W", "H"))
    ap.add_argument("--grad-gate", type=float, default=GRAD_GATE_DEFAULT,
                    help="min gradient energy of the reference overlap patch")
    ap.add_argument("--motion-gate", type=float, default=MOTION_GATE_DEFAULT,
                    help="min overlap image motion (px/frame at the measurement canvas)")
    ap.add_argument("--contrast-gate", type=float, default=CONTRAST_GATE_DEFAULT,
                    help="min coarse-curve contrast (median/min residual)")
    ap.add_argument("--method", choices=["resample", "activity"], default="resample",
                    help="resample = residual-vs-tau (parallax-prone on near-field "
                         "content); activity = event-timing cross-correlation "
                         "(parallax-immune; authoritative after the viaduct-local9 "
                         "post-mortem)")
    ap.add_argument("--windows", type=int, default=6,
                    help="activity method: number of analysis windows")
    args = ap.parse_args()
    if args.method == "activity":
        return cmd_activity(args)
    return cmd_temporal(args)


# (the __main__ guard lives at the END of this file: definitions below must
#  exist before main() dispatches to them under `python -m stitchlab.temporal`)


# ===================================================================== resampler
#
# TemporalResampler: motion-compensated per-camera fractional resampling to a
# common time base, applied BEFORE any warping/stitching. Wraps a RingClip and
# mirrors its frame-reading API (read_frames / iter_frames / usable_frames /
# width / height / fps ...), so the stitchers consume corrected frames without
# knowing the correction exists.
#
# Convention (matches the measurement doc above): offset e_X > 0 means cam X's
# aligned frame n shows the world e_X frames LATER than cam A's frame n, so the
# corrected stream samples cam X at n - e_X. The integer part is a plain frame
# offset; the fractional part is synthesized by the SAME symmetric DIS
# motion-compensated blend the measurement used (sign convention verified
# there):  I(n+f) = (1-f) * I_n(y - f*flow) + f * I_{n+1}(y + (1-f)*flow),
# flow = DIS(I_n -> I_{n+1}) within the camera's own stream.
#
# Streaming: never holds more than the few source frame-sets the per-camera
# integer shifts span (<= max_shift-spread + 1 sets); one DIS flow per
# fractional camera per output frame, cached only for the current interval.

#: fractional offsets closer than this to an integer are snapped (no resample:
#: interpolation softness is not free, so do not pay it for noise-level lags).
SNAP_FRAC = 0.05

# --- retry2 MC-interpolation upgrade (bidirectional flow + occlusion handling) --
# The retry1 single-flow symmetric blend produced blocky staircase / rectangular
# ghost patches around fast near-field objects (judge: qc_filmstrip_sky2/sky4
# panels 4-6): DIS flow is block-granular and wrong in occlusion halos, and the
# far source — warped by up to ~0.9 * flow — leaked those wrong blocks into the
# blend at 8-22% opacity. Fix: compute BOTH flows (n->n+1 and n+1->n), warp each
# source by ITS OWN flow, gate each candidate by forward-backward flow
# consistency (the standard occlusion / unreliable-flow detector), smooth the
# confidence maps so no hard block edges survive into the weights, and fall back
# to the temporally nearer candidate where both flows are distrusted. Flow
# fields get a small median filter first to kill block-outlier vectors.

#: forward-backward consistency tolerance: err(x) = |F01(x) + F10(x + F01(x))|
#: is accepted while err < OCC_ABS + OCC_REL * |F01(x)| (px, source space).
OCC_ABS = 1.0
OCC_REL = 0.06
#: Gaussian sigma (px) for smoothing the confidence maps: removes the DIS
#: block granularity from the blend weights (this is what turned flow errors
#: into visible RECTANGLES rather than soft smears).
CONF_SIGMA = 5.0
#: median filter aperture for the raw flow fields (3 or 5; CV_32F limit).
FLOW_MEDIAN_K = 5
#: when w0+w1 falls below this, top up the temporally nearer candidate's
#: weight so occluded-in-both regions degrade to single-source MC (no ghost).
W_FLOOR = 0.05


class TemporalResampler:
    """Wrap a RingClip; yield temporally corrected 9-cam BGR frame sets."""

    def __init__(self, clip: RingClip, offsets_frames: dict, snap: float = SNAP_FRAC):
        self.clip = clip
        self.letters = clip.letters
        self.e = {}
        self.base = {}   # integer source shift per cam
        self.frac = {}   # fractional part in [0, 1) per cam (0 => no resample)
        for l in self.letters:
            e = offsets_frames.get(l)
            e = 0.0 if e is None else float(e)
            self.e[l] = e
            d = -e                     # corrected(n) = source(n + d)
            b = math.floor(d)
            f = d - b
            if f < snap:
                f = 0.0
            elif f > 1.0 - snap:
                b += 1
                f = 0.0
            self.base[l], self.frac[l] = int(b), float(f)

        # Output index n maps to source index n + lo + base[l] (+1 when frac>0):
        # choose lo so every cam stays inside [0, clip.usable_frames-1].
        need_hi = {l: self.base[l] + (1 if self.frac[l] > 0 else 0) for l in self.letters}
        self.lo = max(0, max(-self.base[l] for l in self.letters))
        hi = min(clip.usable_frames - 1 - need_hi[l] for l in self.letters) - self.lo
        if hi < 1:
            raise ValueError("temporal offsets leave no usable corrected frames")
        self.usable_frames = hi + 1

        self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self._flow_cache: dict[str, tuple[int, np.ndarray]] = {}
        gx, gy = np.meshgrid(np.arange(clip.width, dtype=np.float32),
                             np.arange(clip.height, dtype=np.float32))
        self._grid_x, self._grid_y = gx, gy

    # --------------------------------------------------- metadata passthrough

    def __getattr__(self, name):
        return getattr(self.clip, name)  # width/height/fps/cams/offsets/...

    def report(self) -> dict:
        return {
            "offsets_frames": {l: round(self.e[l], 4) for l in self.letters},
            "integer_shift": dict(self.base),
            "fractional_part": {l: round(self.frac[l], 4) for l in self.letters},
            "snap_frac": SNAP_FRAC,
            "output_index_source_lo": self.lo,
            "usable_frames_corrected": self.usable_frames,
            "resampled_cams": [l for l in self.letters if self.frac[l] > 0],
            "method": "per-cam bidirectional-DIS motion-compensated fractional "
                      "resample (each source warped by its own flow; "
                      "forward-backward occlusion confidence, smoothed weights, "
                      "nearer-source fallback), integer part as frame offset; "
                      "corrected(n) = source(n - e)",
        }

    # ------------------------------------------------------------- synthesis

    def _median_flow(self, flow: np.ndarray) -> np.ndarray:
        out = np.empty_like(flow)
        out[..., 0] = cv2.medianBlur(flow[..., 0], FLOW_MEDIAN_K)
        out[..., 1] = cv2.medianBlur(flow[..., 1], FLOW_MEDIAN_K)
        return out

    def _fb_confidence(self, fa: np.ndarray, fb: np.ndarray) -> np.ndarray:
        """Forward-backward consistency confidence of flow `fa` (checked
        against the opposite-direction flow `fb`), in fa's source frame.
        1 = consistent, fading to 0 at 2x tolerance; smoothed so DIS block
        granularity cannot reach the blend weights."""
        bx = cv2.remap(fb[..., 0], self._grid_x + fa[..., 0], self._grid_y + fa[..., 1],
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        by = cv2.remap(fb[..., 1], self._grid_x + fa[..., 0], self._grid_y + fa[..., 1],
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        err = np.hypot(fa[..., 0] + bx, fa[..., 1] + by)
        tol = OCC_ABS + OCC_REL * np.hypot(fa[..., 0], fa[..., 1])
        conf = np.clip(2.0 - err / tol, 0.0, 1.0).astype(np.float32)
        return cv2.GaussianBlur(conf, (0, 0), CONF_SIGMA)

    def _interp(self, l: str, i0: int, f: float, f0: np.ndarray, f1: np.ndarray) -> np.ndarray:
        cached = self._flow_cache.get(l)
        if cached is None or cached[0] != i0:
            g0 = cv2.cvtColor(f0, cv2.COLOR_BGR2GRAY)
            g1 = cv2.cvtColor(f1, cv2.COLOR_BGR2GRAY)
            f01 = self._median_flow(self._dis.calc(g0, g1, None))
            f10 = self._median_flow(self._dis.calc(g1, g0, None))
            conf0 = self._fb_confidence(f01, f10)
            conf1 = self._fb_confidence(f10, f01)
            self._flow_cache[l] = (i0, f01, f10, conf0, conf1)
        _, f01, f10, conf0, conf1 = self._flow_cache[l]
        # Each source warped to time f by ITS OWN flow (no cross-frame reuse:
        # the far source no longer inherits the near source's flow errors).
        a = cv2.remap(f0, self._grid_x - f * f01[..., 0], self._grid_y - f * f01[..., 1],
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        b = cv2.remap(f1, self._grid_x - (1.0 - f) * f10[..., 0],
                      self._grid_y - (1.0 - f) * f10[..., 1],
                      cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        # Transport each confidence map with its candidate.
        ca = cv2.remap(conf0, self._grid_x - f * f01[..., 0], self._grid_y - f * f01[..., 1],
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        cb = cv2.remap(conf1, self._grid_x - (1.0 - f) * f10[..., 0],
                       self._grid_y - (1.0 - f) * f10[..., 1],
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        w0 = (1.0 - f) * ca
        w1 = f * cb
        wsum = w0 + w1
        deficit = np.clip(W_FLOOR - wsum, 0.0, None)
        if f < 0.5:                    # occluded-in-both: nearer source only
            w0 = w0 + deficit
        else:
            w1 = w1 + deficit
        wsum = w0 + w1
        out = (w0[..., None] * a.astype(np.float32) + w1[..., None] * b.astype(np.float32)) \
            / wsum[..., None]
        return np.clip(out + 0.5, 0.0, 255.0).astype(np.uint8)

    def _assemble(self, m: int, buf: dict[str, dict[int, np.ndarray]]) -> dict[str, np.ndarray]:
        out = {}
        for l in self.letters:
            i0 = m + self.base[l]
            f = self.frac[l]
            out[l] = buf[l][i0] if f == 0.0 else self._interp(l, i0, f, buf[l][i0], buf[l][i0 + 1])
        return out

    def _stream(self, out_idx: list[int], source_iter):
        """Generic emit loop: consume ascending (src_index, frames) sets,
        buffer the few needed, emit corrected outputs as soon as satisfied."""
        from collections import deque

        pending = deque(out_idx)
        buf: dict[str, dict[int, np.ndarray]] = {l: {} for l in self.letters}

        def satisfied(n):
            m = n + self.lo
            for l in self.letters:
                i0 = m + self.base[l]
                if i0 not in buf[l]:
                    return False
                if self.frac[l] > 0 and (i0 + 1) not in buf[l]:
                    return False
            return True

        for i, frames in source_iter:
            for l in self.letters:
                buf[l][i] = frames[l]
            while pending and satisfied(pending[0]):
                n = pending.popleft()
                yield n, self._assemble(n + self.lo, buf)
                keep_from = (pending[0] + self.lo) if pending else None
                for l in self.letters:
                    if keep_from is None:
                        buf[l].clear()
                    else:
                        lo_l = keep_from + self.base[l]
                        for k in [k for k in buf[l] if k < lo_l]:
                            del buf[l][k]
            if not pending:
                break

    # ------------------------------------------------------------ public API

    def read_frames(self, indices):
        idx = sorted(set(int(i) for i in indices))
        if not idx:
            return
        if idx[0] < 0 or idx[-1] >= self.usable_frames:
            raise IndexError(f"corrected indices {idx[0]}..{idx[-1]} outside 0..{self.usable_frames - 1}")
        union = set()
        for n in idx:
            m = n + self.lo
            for l in self.letters:
                i0 = m + self.base[l]
                union.add(i0)
                if self.frac[l] > 0:
                    union.add(i0 + 1)
        yield from self._stream(idx, self.clip.read_frames(sorted(union)))

    def iter_frames(self, start: int = 0, count: int | None = None):
        if count is None:
            count = self.usable_frames - start
        count = min(count, self.usable_frames - start)
        if count <= 0:
            return
        idx = list(range(start, start + count))
        src_lo = start + self.lo + min(self.base.values())
        src_hi = (start + count - 1) + self.lo + max(
            self.base[l] + (1 if self.frac[l] > 0 else 0) for l in self.letters)
        yield from self._stream(idx, self.clip.iter_frames(src_lo, src_hi - src_lo + 1))


def load_temporal_offsets(path) -> dict:
    """Read per-cam offsets (frames) from a measurement offsets.json (uses
    per_cam_offsets_frames) or a flat {letter: frames} JSON."""
    doc = json.loads(Path(path).read_text())
    raw = doc.get("per_cam_offsets_frames", doc)
    out = {}
    for l, v in raw.items():
        if isinstance(v, (int, float)) or v is None:
            out[str(l)] = None if v is None else float(v)
    return out


# ============================================================ activity method
#
# Post-mortem of the residual/tau method on viaduct-local9: the per-pair lags
# it measures are dominated by near-field PARALLAX converted to fake lag
# (displacement_px / motion_px_per_frame), with a sign that flips between the
# left and right side of the vehicle because the equirect motion direction
# flips. The six ring biases then cancel around the loop, so loop closure ~0
# does NOT certify them. Confirmed empirically: dx-derived and dy-derived lags
# for the same pair disagree in SIGN, which no true temporal offset can do.
#
# The activity method is parallax-immune by construction: for each pair, warp
# the shared overlap into equirect per frame and record the frame-difference
# energy waveform per camera. World events (an arch sweeping through, cars)
# spike both cameras' waveforms at world-time; a temporal offset shifts one
# waveform in TIME. Static parallax shifts content in SPACE but cannot shift
# the timing of events. Normalized cross-correlation of the two waveforms:
# the integer peak position is the full-frame offset (a bad TC tag shows as a
# peak at k=+-1), the parabolic vertex gives the sub-frame part.
# Sign: peak at lag k means cam_i's waveform matches cam_j's k frames later,
# i.e. k = e_j - e_i (e as defined above: correct cam X by sampling n - e_X).

ACT_WINDOWS_DEFAULT = 6
ACT_WINDOW_LEN = 240
ACT_MAX_LAG = 6
#: minimum correlation-curve contrast (peak minus the weaker +-1 neighbour):
#: a flat plateau has no timing information and its vertex is noise.
ACT_SHARP_GATE = 0.01


def _activity_xcorr(a: np.ndarray, b: np.ndarray, max_lag: int = ACT_MAX_LAG):
    a = (a - a.mean()) / (a.std() + 1e-9)
    b = (b - b.mean()) / (b.std() + 1e-9)
    lags = np.arange(-max_lag, max_lag + 1)
    cs = []
    for k in lags:
        if k > 0:
            c = float(np.mean(a[k:] * b[: len(b) - k]))
        elif k == 0:
            c = float(np.mean(a * b))
        else:
            c = float(np.mean(a[: len(a) + k] * b[-k:]))
        cs.append(c)
    cs = np.asarray(cs)
    k = int(np.argmax(cs))
    sharp = 0.0
    sub = 0.0
    if 0 < k < len(lags) - 1:
        y0, y1, y2 = cs[k - 1], cs[k], cs[k + 1]
        den = y0 - 2 * y1 + y2
        if den < -1e-12:
            sub = float(np.clip(0.5 * (y0 - y2) / den, -0.5, 0.5))
        sharp = float(y1 - max(y0, y2))
    return float(lags[k] + sub), int(lags[k]), sharp, cs


def cmd_activity(args) -> int:
    t_start = time.perf_counter()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    eq_w, eq_h = args.eq

    clip = RingClip(Path(args.drop), letters=ALL9)
    proj = load_pts(args.pts)
    sky_off = {}
    if args.sky_offsets:
        doc = json.loads(Path(args.sky_offsets).read_text())
        sky_off = {l: doc["cams"][l]["offsets_deg"] for l in SKY} if "cams" in doc \
            else {l: doc[l] for l in SKY}
    cams = {l: _apply_offsets(proj.by_letter[l], sky_off.get(l, {})) for l in ALL9}
    pairs, ring_order = build_pairs(cams, eq_w, eq_h, clip.width, clip.height)
    print(f"pairs: {[p.name for p in pairs]}")

    n_win = args.windows
    wlen = min(ACT_WINDOW_LEN, clip.usable_frames // n_win)
    starts = np.linspace(0, clip.usable_frames - wlen - 1, n_win).round().astype(int)
    print(f"windows ({wlen} frames): {starts.tolist()}")

    per_pair: dict[str, list[dict]] = {p.name: [] for p in pairs}
    for t0 in starts:
        tw = time.perf_counter()
        acts = {p.name: {p.li: [], p.lj: []} for p in pairs}
        last: dict = {}
        for i, frames in clip.iter_frames(int(t0), wlen):
            gray = {l: cv2.cvtColor(frames[l], cv2.COLOR_BGR2GRAY).astype(np.float32)
                    for l in ALL9}
            for p in pairs:
                for l, maps in ((p.li, p.maps_i), (p.lj, p.maps_j)):
                    w = cv2.remap(gray[l], maps[0], maps[1], cv2.INTER_LINEAR)
                    key = (p.name, l)
                    if key in last:
                        acts[p.name][l].append(float(np.abs(w - last[key])[p.mask].mean()))
                    last[key] = w
        last.clear()
        for p in pairs:
            a = np.asarray(acts[p.name][p.li])
            b = np.asarray(acts[p.name][p.lj])
            lag, k_int, sharp, cs = _activity_xcorr(a, b)
            per_pair[p.name].append({
                "window_start": int(t0), "lag": round(lag, 4), "peak_int": k_int,
                "sharp": round(sharp, 4), "peak": round(float(cs.max()), 4),
                "curve": [round(float(c), 4) for c in cs],
            })
        print(f"  window {t0}: {time.perf_counter() - tw:.1f}s")

    # aggregate: sharpness-weighted; gate flat plateaus
    pair_results = []
    for p in pairs:
        recs = per_pair[p.name]
        used = [r for r in recs if r["sharp"] >= ACT_SHARP_GATE]
        pr = {"pair": p.name, "kind": p.kind, "n_windows": len(recs),
              "n_used": len(used), "windows": recs}
        if used:
            w = np.array([r["sharp"] for r in used])
            v = np.array([r["lag"] for r in used])
            lag = float((w * v).sum() / w.sum())
            pr["lag_frames"] = round(lag, 4)   # activity convention: e_j - e_i
            pr["spread"] = round(float(np.sqrt(((v - lag) ** 2 * w).sum() / w.sum())), 4)
            pr["int_peaks"] = sorted(set(r["peak_int"] for r in used))
            pr["weight"] = round(float(w.sum()) / max(pr["spread"], 0.05) ** 2, 1)
        else:
            pr["lag_frames"] = None
        pair_results.append(pr)

    # global solve in the module's e convention: lag_activity = e_j - e_i
    conv = []
    for pr in pair_results:
        if pr["lag_frames"] is None:
            conv.append({**pr, "lag_frames": None})
        else:
            conv.append({**pr, "lag_frames": -pr["lag_frames"]})  # -> e_i - e_j
    offsets, stderr = solve_global([pr for pr in conv if pr["lag_frames"] is not None])

    by_name = {pr["pair"]: pr for pr in pair_results}
    loop, loop_ok, loop_terms = 0.0, True, {}
    for k in range(6):
        li, lj = ring_order[k], ring_order[(k + 1) % 6]
        pr = by_name.get(f"{li}-{lj}")
        if pr is None or pr["lag_frames"] is None:
            loop_ok = False
            continue
        loop += pr["lag_frames"]
        loop_terms[pr["pair"]] = pr["lag_frames"]

    verdict = {}
    for l in ALL9:
        e = offsets[l]
        if e is None:
            verdict[l] = "UNCONSTRAINED"
        elif abs(e) >= 0.75:
            verdict[l] = "FULL-FRAME (TC tag error)"
        elif abs(e) >= 0.1:
            verdict[l] = "sub-frame (genlock-free exposure offset)"
        else:
            verdict[l] = "aligned (<0.1 frame)"

    doc = {
        "task": "per-camera temporal offsets via activity-waveform cross-correlation",
        "why_this_method": "residual/tau lags were parallax-biased (side-symmetric, "
                           "loop-cancelling); event timing cannot be shifted by parallax",
        "drop": str(Path(args.drop).resolve()),
        "pts": str(Path(args.pts).resolve()),
        "eq_canvas": [eq_w, eq_h],
        "windows": {"n": n_win, "len_frames": int(wlen), "starts": starts.tolist()},
        "sharp_gate": ACT_SHARP_GATE,
        "sign_convention": "per_cam offsets e_X: cam X's aligned frame n shows the world "
                           "e_X frames LATER than cam A's; correct by sampling n - e_X",
        "pairs": pair_results,
        "pair_lag_convention": "pairs[].lag_frames is the ACTIVITY convention e_j - e_i",
        "per_cam_offsets_frames": {l: (round(offsets[l], 4) if offsets[l] is not None else None)
                                   for l in ALL9},
        "per_cam_stderr_frames": {l: (round(stderr[l], 4) if stderr[l] is not None else None)
                                  for l in ALL9},
        "ring_loop_closure_frames": round(loop, 4) if loop_ok else None,
        "ring_loop_terms": loop_terms,
        "verdict_per_cam": verdict,
        "runtime_s": round(time.perf_counter() - t_start, 1),
    }
    out_json = out_dir / "offsets.json"
    out_json.write_text(json.dumps(doc, indent=2))
    print(f"wrote {out_json}")
    print("\nper-cam offsets (frames, anchor A=0):")
    for l in ALL9:
        if offsets[l] is None:
            print(f"  {l}: unconstrained")
        else:
            print(f"  {l}: {offsets[l]:+.3f} +- {stderr[l]:.3f}   {verdict[l]}")
    print(f"ring loop closure: {loop:+.4f}" if loop_ok else "ring loop closure: incomplete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
