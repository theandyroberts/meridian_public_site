"""RANK-1 structural-integrity detector — DETECTION/ANALYSIS part.

Human-stitcher architecture, rank 1: for every LARGE structure (concrete
arch silhouettes, masts, buildings — explicitly NOT wires) that crosses a
seam or the sky-ring boundary, measure silhouette continuity across the
handoff. A structure passes only if its silhouette edge is continuous to
<= 1.5 px ("sub-glance") and is neither chopped nor duplicated.

Method (composite-only, no per-source render needed):
  1. Segment sky vs structure. Sky = large smooth (low-gradient after a
     wire-removing grayscale closing) connected components seeded high in
     the frame. Structure = everything else, binary-OPENED with a 9 px
     ellipse so nothing thinner than ~9 px (all wires/cables) survives —
     the size gate that makes structures "protected" and wires not.
  2. Silhouette edges = sky/structure boundary, linked into CHAINS
     (column-wise for shallow edges like arch crests, row-wise for steep
     edges like masts and arch limbs). Chains split wherever continuity
     breaks by > LINK_DY px — so a seam break literally severs the chain.
  3. At every vertical seam column and at the horizontal sky-ring
     boundary band, measure each protected chain that crosses:
       - "jump":    robust poly fit on each side of an exclusion gap,
                    evaluated at the seam -> discontinuity in px;
       - "offset":  chain ends at the seam, a partner chain resumes on
                    the other side displaced -> chop + re-add offset;
       - "chop":    chain ends at the seam with NO partner -> silhouette
                    truncated (top of structure cut off);
       - "flat-top": silhouette runs flat inside the sky-ring band for
                    >= 40 px — the signature of a crest sliced at the
                    source-handoff row (candidate; verify visually).
  Wires cannot enter any of this: they are removed by the opening before
  chains are built. That inverts the old ghost-energy bias where thin
  high-contrast wires dominated and broad concrete edges barely counted.

This module is analysis-only (used for the autopsy of a rendered
composite). The seam-routing/protection half of rank 1 lives elsewhere.

Run:  ./.venv/bin/python -m stitchlab.structure --video X.mov --out DIR
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys
import warnings
from pathlib import Path

import cv2
import numpy as np

warnings.simplefilter("ignore", np.exceptions.RankWarning)

# ---------------------------------------------------------------- constants

ROWS_ANALYZE = 950      # rows 0..N: sky + boundary + arch zone
CAP_LUMA = 8            # black polar-cap threshold (8-bit)
CLOSE_K = 7             # grayscale closing: removes dark wires before grad
GRAD_SIGMA = 1.5
GRAD_SKY_T = 1.6        # sky smoothness bar (8-bit/px, scaled Sobel)
OPEN_K = 9              # binary opening: nothing thinner than ~9 px survives
SKY_SEED_ROWS = (40, 170)
SKY_SEED_MIN = 2000     # px a smooth component needs in the seed rows

LINK_DY = 4             # chain continuity: > this vertical step severs it
LINK_GAP = 2            # columns a chain may skip
CHAIN_MIN = 40          # px: shorter chains are ignored outright

SEAM_GAP = 6            # exclusion half-gap around a vertical seam col
FIT_WIN = 110           # fit window px on each side of the gap
FIT_MIN_PTS = 30
FIT_RESID_MAX = 2.0     # px: noisier silhouettes (trees) are not measured
BAND_HALF = 140         # flow band reach: breaks live anywhere in +-128 (+pad)
PARTNER_DU = 30         # max col gap between chop end and re-added partner
PARTNER_DY = 40         # max offset for an "offset" (chop + re-add) pairing
TAIL_RESID = 1.5        # smooth-tail gate: foliage tails fail this
OFFSET_MIN = 0.75       # offsets below this are chain-linker noise, dropped

# a record is attributable to a seam family only where that family renders:
RING_ROW_MIN = 505      # ring seams exist only below the sky-ring boundary
SKY_ROW_MAX = 615       # sky-sky seams exist only above it
ENDER_ROW_MAX = 820     # below this the scene is busy ground clutter, and
                        # chains also sever at the ROWS_ANALYZE crop edge —
                        # chop/offset records are only minted on the clean
                        # against-sky zone where a human would see them

BOUND_BAND = (517, 614) # sky-ring boundary rows (seam_row min-8 .. max+8)
BOUND_GAP = (510, 620)  # exclusion rows for boundary fits
FLAT_RUN = 40           # px of in-band flat silhouette => flat-top record
FLAT_STD = 2.0

DISP_BAR = 1.5          # the rank-1 bar (px)

# rejected-candidate geometry (clip04 viaduct-local9, 3840x1183 nineband)
SEAMS_CLIP04 = [
    {"id": "ring:E-F", "col": 949,  "kind": "ring"},
    {"id": "ring:F-A", "col": 1576, "kind": "ring"},
    {"id": "ring:A-B", "col": 2248, "kind": "ring"},
    {"id": "ring:B-C", "col": 2826, "kind": "ring"},
    {"id": "ring:C-D", "col": 3528, "kind": "ring"},
    {"id": "ring:D-E", "col": 248,  "kind": "ring"},
    {"id": "sky:J-G",  "col": 1105, "kind": "sky"},
    {"id": "sky:G-H",  "col": 2353, "kind": "sky"},
    {"id": "sky:H-J",  "col": 210,  "kind": "sky"},
]


# ------------------------------------------------------------- segmentation

def segment(gray: np.ndarray) -> dict:
    """Sky / protected-structure masks for one composite frame (8-bit)."""
    g = gray[:ROWS_ANALYZE].astype(np.float32)
    cap = (cv2.GaussianBlur(g, (0, 0), 2) < CAP_LUMA).astype(np.uint8)
    cap = cv2.dilate(cap, np.ones((9, 9), np.uint8))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_K, CLOSE_K))
    gc = cv2.morphologyEx(g, cv2.MORPH_CLOSE, k)     # dark thin wires gone
    gb = cv2.GaussianBlur(gc, (0, 0), GRAD_SIGMA)
    gx = cv2.Sobel(gb, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gb, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.sqrt(gx * gx + gy * gy) * 0.25
    smooth = ((grad < GRAD_SKY_T) & (cap == 0)).astype(np.uint8)
    n, lab = cv2.connectedComponents(smooth, connectivity=4)
    seeds = lab[SKY_SEED_ROWS[0]:SKY_SEED_ROWS[1], :]
    counts = np.bincount(seeds.ravel(), minlength=n)
    sky_labels = [l for l in range(1, n) if counts[l] > SKY_SEED_MIN]
    sky = np.isin(lab, sky_labels)
    struct = ((~sky) & (cap == 0)).astype(np.uint8)
    ko = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (OPEN_K, OPEN_K))
    opened = cv2.morphologyEx(struct, cv2.MORPH_OPEN, ko)  # wires cannot pass
    bnd = cv2.dilate(sky.astype(np.uint8), np.ones((3, 3), np.uint8)) \
        & cv2.dilate(opened, np.ones((3, 3), np.uint8))
    return {"sky": sky, "opened": opened, "grad": grad, "cap": cap, "bnd": bnd}


# ------------------------------------------------------------------- chains

def _run_centers(col: np.ndarray) -> list[float]:
    """Centers of True-runs in a 1-D bool array."""
    idx = np.flatnonzero(col)
    if idx.size == 0:
        return []
    brk = np.flatnonzero(np.diff(idx) > 1)
    runs = np.split(idx, brk + 1)
    return [float(r.mean()) for r in runs]


def build_chains(bmap: np.ndarray, u0: int = 0) -> list[np.ndarray]:
    """Link boundary pixels into silhouette chains along axis 1.

    bmap[v, u] bool. Returns chains as (N,2) arrays of (u, v), u ascending.
    A vertical step > LINK_DY or a gap > LINK_GAP columns severs the chain
    (that severing IS the break signal the seam measurements consume).
    """
    h, w = bmap.shape
    live: list[dict] = []      # {"pts": [(u,v)...], "v": last v, "miss": n}
    done: list[np.ndarray] = []
    for u in range(w):
        vs = _run_centers(bmap[:, u])
        claimed = [False] * len(vs)
        for ch in live:
            best, bd = -1, LINK_DY + 1.0
            for i, v in enumerate(vs):
                if claimed[i]:
                    continue
                d = abs(v - ch["v"])
                if d < bd:
                    bd, best = d, i
            if best >= 0 and bd <= LINK_DY:
                claimed[best] = True
                ch["pts"].append((u + u0, vs[best]))
                ch["v"] = vs[best]
                ch["miss"] = 0
            else:
                ch["miss"] += 1
        nxt = []
        for ch in live:
            if ch["miss"] > LINK_GAP:
                if len(ch["pts"]) >= CHAIN_MIN:
                    done.append(np.array(ch["pts"], np.float32))
            else:
                nxt.append(ch)
        live = nxt
        for i, v in enumerate(vs):
            if not claimed[i]:
                live.append({"pts": [(u + u0, v)], "v": v, "miss": 0})
    for ch in live:
        if len(ch["pts"]) >= CHAIN_MIN:
            done.append(np.array(ch["pts"], np.float32))
    return done


def _robust_eval(pts: np.ndarray, at: float, deg: int = 2):
    """Fit v(u) with one trim pass; return (value_at, resid_rms) or None."""
    if len(pts) < FIT_MIN_PTS:
        return None
    u, v = pts[:, 0], pts[:, 1]
    if np.ptp(u) < 20:
        return None
    d = min(deg, 2 if np.ptp(u) > 40 else 1)
    c = np.polyfit(u, v, d)
    r = v - np.polyval(c, u)
    keep = np.abs(r - np.median(r)) <= max(2.5, 2.5 * np.std(r))
    if keep.sum() >= FIT_MIN_PTS * 0.7:
        c = np.polyfit(u[keep], v[keep], d)
        r = v[keep] - np.polyval(c, u[keep])
    resid = float(np.sqrt(np.mean(r * r)))
    return float(np.polyval(c, at)), resid


def _end_lin(pts: np.ndarray, at: float, tail: int = 40):
    """Linear extrapolation from a chain tail/head to u=at.

    Gated on tail smoothness (TAIL_RESID): a foliage/texture chain end is
    not a measurable silhouette and must not mint chop/offset records."""
    p = pts[-tail:] if abs(pts[-1, 0] - at) <= abs(pts[0, 0] - at) else pts[:tail]
    if len(p) < 12 or np.ptp(p[:, 0]) < 8:
        return None
    c = np.polyfit(p[:, 0], p[:, 1], 1)
    r = p[:, 1] - np.polyval(c, p[:, 0])
    if float(np.sqrt(np.mean(r * r))) > TAIL_RESID:
        return None
    return float(np.polyval(c, at)), float(c[0])


def _end_class(bnd: np.ndarray, sky: np.ndarray, u_end: float, v_end: float,
               direction: int) -> str:
    """Classify a chain end by what lies just beyond it.

    'continues': boundary pixels ahead (edge merely turned steep) — natural;
    'occluded':  structure ahead (edge passed behind something) — natural;
    'break':     open sky ahead — a silhouette cannot physically end into
                 thin air, so the render chopped it (rank-1 evidence)."""
    h, w = bnd.shape
    u0 = int(u_end) + (2 if direction > 0 else -14)
    u1 = int(u_end) + (15 if direction > 0 else -1)
    v0, v1 = int(v_end) - 30, int(v_end) + 35
    u0, u1 = max(0, u0), min(w, u1)
    v0, v1 = max(0, v0), min(h, v1)
    if u0 >= u1 or v0 >= v1:
        return "continues"
    if bnd[v0:v1, u0:u1].any():
        return "continues"
    ahead_sky = sky[max(0, int(v_end) - 8):min(h, int(v_end) + 9), u0:u1]
    if ahead_sky.size and ahead_sky.mean() >= 0.6:
        return "break"
    return "occluded"


# ------------------------------------------------------------- measurements

def _row_ok(seam_kind: str, row: float) -> bool:
    """A break is attributable to a seam family only where it renders."""
    if seam_kind == "ring":
        return row >= RING_ROW_MIN
    if seam_kind == "sky":
        return row <= SKY_ROW_MAX
    return True


def measure_vertical_seam(chains: list[np.ndarray], c: int, seam: dict,
                          frame: int, bnd: np.ndarray = None,
                          sky: np.ndarray = None) -> list[dict]:
    """Jump / offset / chop records for one vertical seam.

    "jump" is measured AT the seam column (blend-share midpoint, where the
    classic misalignment step lives). Chain ENDS are considered anywhere in
    the +-BAND_HALF flow band: the morph can chop/re-add structure at any
    column the correction touches, not just at the seam line."""
    recs = []
    enders = []          # (chain, u_end, y_end, is_tail)
    for ch in chains:
        u = ch[:, 0]
        near = ch[(u >= c - FIT_WIN - SEAM_GAP) & (u <= c + FIT_WIN + SEAM_GAP)]
        L = near[near[:, 0] <= c - SEAM_GAP] if len(near) else near
        R = near[near[:, 0] >= c + SEAM_GAP] if len(near) else near
        if len(L) >= FIT_MIN_PTS and len(R) >= FIT_MIN_PTS:
            fl = _robust_eval(L, c)
            fr = _robust_eval(R, c)
            if fl and fr and fl[1] <= FIT_RESID_MAX and fr[1] <= FIT_RESID_MAX \
                    and _row_ok(seam["kind"], (fl[0] + fr[0]) / 2):
                recs.append({"frame": frame, "seam": seam["id"], "type": "jump",
                             "col": c, "row": int((fl[0] + fr[0]) / 2),
                             "disp_px": round(abs(fl[0] - fr[0]), 2),
                             "resid": [round(fl[1], 2), round(fr[1], 2)],
                             "npts": [int(len(L)), int(len(R))]})
            continue
        if len(ch) < CHAIN_MIN + 10 or bnd is None:
            continue
        for u_end, is_tail in ((u[-1], True), (u[0], False)):
            if abs(u_end - c) <= BAND_HALF:
                r = _end_lin(ch, u_end)
                if r is None or not _row_ok(seam["kind"], r[0]) \
                        or r[0] > ENDER_ROW_MAX:
                    continue
                if _end_class(bnd, sky, u_end, r[0],
                              +1 if is_tail else -1) != "break":
                    continue          # natural end (edge turned or occluded)
                enders.append((ch, float(u_end), r[0], r[1], is_tail))
    tails = [e for e in enders if e[4]]
    heads = [e for e in enders if not e[4]]
    used = set()
    for ch, ue, ye, se, _ in tails:
        best, bd = None, None
        for j, (ch2, us, ys, ss, _) in enumerate(heads):
            if j in used or ch2 is ch:
                continue
            du, dy = us - ue, abs(ys - ye)
            if -6 <= du <= PARTNER_DU and dy <= PARTNER_DY and abs(ss - se) <= 0.6:
                if bd is None or dy < bd:
                    bd, best = dy, j
        if best is not None:
            used.add(best)
            if bd >= OFFSET_MIN:
                recs.append({"frame": frame, "seam": seam["id"], "type": "offset",
                             "col": int(ue), "row": int(ye), "disp_px": round(bd, 2)})
        else:
            recs.append({"frame": frame, "seam": seam["id"], "type": "chop",
                         "col": int(ue), "row": int(ye), "disp_px": None})
    for j, (ch2, us, ys, ss, _) in enumerate(heads):
        if j not in used:
            recs.append({"frame": frame, "seam": seam["id"], "type": "chop",
                         "col": int(us), "row": int(ys), "disp_px": None})
    return recs


def measure_boundary(chains_col: list[np.ndarray], chains_row: list[np.ndarray],
                     frame: int) -> list[dict]:
    """Sky-ring boundary records: shallow crests (column-wise chains split
    by row), steep limbs/masts (row-wise chains split by row), flat-tops."""
    recs = []
    b0, b1 = BOUND_BAND
    g0, g1 = BOUND_GAP
    for ch in chains_col:                      # shallow: v is the row
        v = ch[:, 1]
        inband = (v > g0) & (v < g1)
        if not inband.any():
            continue
        # flat-top: long horizontal run inside the band, with at least one
        # RISING shoulder (a roofline that merely lives at these rows has
        # flat shoulders and is not a truncated crest)
        idx = np.flatnonzero(inband)
        brk = np.flatnonzero(np.diff(idx) > 3)
        for run in np.split(idx, brk + 1):
            if len(run) >= FLAT_RUN and float(np.std(v[run])) <= FLAT_STD:
                sh = []
                for sl in (slice(max(0, run[0] - 30), run[0]),
                           slice(run[-1] + 1, run[-1] + 31)):
                    p = ch[sl]
                    if len(p) >= 10 and np.ptp(p[:, 0]) > 4:
                        sh.append(abs(np.polyfit(p[:, 0], p[:, 1], 1)[0]))
                if sh and max(sh) >= 0.3:
                    recs.append({"frame": frame, "seam": "boundary",
                                 "type": "flat-top", "col": int(ch[run, 0].mean()),
                                 "row": int(v[run].mean()), "disp_px": None,
                                 "run_px": int(len(run))})
        # crest crossing: fit y(x) above vs below the band around each crossing
        cross = np.flatnonzero(np.abs(np.diff((v >= (b0 + b1) / 2).astype(np.int8))))
        for ci in cross:
            xc = float(ch[ci, 0])
            near = ch[np.abs(ch[:, 0] - xc) <= FIT_WIN + 20]
            A = near[near[:, 1] <= g0]
            B = near[near[:, 1] >= g1]
            if len(A) >= 25 and len(B) >= 25:
                fa = _robust_eval(A, xc)
                fb = _robust_eval(B, xc)
                if fa and fb and fa[1] <= FIT_RESID_MAX and fb[1] <= FIT_RESID_MAX:
                    recs.append({"frame": frame, "seam": "boundary", "type": "jump",
                                 "col": int(xc), "row": int((b0 + b1) / 2),
                                 "disp_px": round(abs(fa[0] - fb[0]), 2),
                                 "resid": [round(fa[1], 2), round(fb[1], 2)],
                                 "npts": [int(len(A)), int(len(B))]})
    ymid = (b0 + b1) / 2.0
    enders_a, enders_b = [], []
    for ch in chains_row:                      # steep: pts are (y, x)
        y = ch[:, 0]
        A = ch[(y <= g0) & (y >= g0 - FIT_WIN)]
        B = ch[(y >= g1) & (y <= g1 + FIT_WIN)]
        if len(A) >= FIT_MIN_PTS and len(B) >= FIT_MIN_PTS:
            fa = _robust_eval(A, ymid)
            fb = _robust_eval(B, ymid)
            if fa and fb and fa[1] <= FIT_RESID_MAX and fb[1] <= FIT_RESID_MAX:
                recs.append({"frame": frame, "seam": "boundary", "type": "jump",
                             "col": int((fa[0] + fb[0]) / 2), "row": int(ymid),
                             "disp_px": round(abs(fa[0] - fb[0]), 2),
                             "resid": [round(fa[1], 2), round(fb[1], 2)],
                             "npts": [int(len(A)), int(len(B))]})
            continue
        if len(ch) >= CHAIN_MIN and g0 - 40 <= y[-1] <= g1:
            r = _end_lin(ch, ymid)
            if r is not None:
                enders_a.append(r)             # comes from above, ends in band
        if len(ch) >= CHAIN_MIN and g0 <= y[0] <= g1 + 40:
            r = _end_lin(ch, ymid)
            if r is not None:
                enders_b.append(r)             # starts in band, continues down
    used = set()
    for xa, sa in enders_a:
        best, bd = None, None
        for j, (xb, sb) in enumerate(enders_b):
            if j in used:
                continue
            if abs(xb - xa) <= PARTNER_DY and abs(sb - sa) <= 0.6:
                if bd is None or abs(xb - xa) < bd:
                    bd, best = abs(xb - xa), j
        if best is not None and bd >= OFFSET_MIN:
            used.add(best)
            recs.append({"frame": frame, "seam": "boundary", "type": "offset",
                         "col": int(xa), "row": int(ymid), "disp_px": round(bd, 2)})
    return recs


# ------------------------------------------------------------- frame driver

class StructureDetector:
    def __init__(self, seams: list[dict] | None = None):
        self.seams = seams if seams is not None else SEAMS_CLIP04

    def analyze(self, gray: np.ndarray, frame: int) -> list[dict]:
        seg = segment(gray)
        bnd = seg["bnd"].astype(bool)
        recs: list[dict] = []
        for seam in self.seams:
            c = seam["col"]
            lo = max(0, c - BAND_HALF - 40)
            hi = min(bnd.shape[1], c + BAND_HALF + 40)
            chains = build_chains(bnd[:, lo:hi], u0=lo)
            recs += measure_vertical_seam(chains, c, seam, frame, bnd,
                                          seg["sky"])
        rows_lo = max(0, BOUND_BAND[0] - FIT_WIN - 60)
        rows_hi = min(ROWS_ANALYZE, BOUND_BAND[1] + FIT_WIN + 60)
        band = bnd[rows_lo:rows_hi]
        ch_col = [c + np.array([[0, rows_lo]], np.float32)
                  for c in build_chains(band)]
        ch_row = [c + np.array([[rows_lo, 0]], np.float32)
                  for c in build_chains(band.T)]
        recs += measure_boundary(ch_col, ch_row, frame)
        return _dedupe(recs)


def _dedupe(recs: list[dict]) -> list[dict]:
    """Collapse records of the same physical break measured twice (e.g. a
    site inside two overlapping bands, or ring/sky ambiguity rows)."""
    out = []
    for r in sorted(recs, key=lambda r: (r["disp_px"] is None,
                                         -(r["disp_px"] or 0))):
        dup = any(r["type"] == o["type"] and abs(r["col"] - o["col"]) <= 12
                  and abs(r["row"] - o["row"]) <= 12 for o in out)
        if not dup:
            out.append(r)
    return out


# --------------------------------------------------------------- wire check

def cable_doubling_score(gray: np.ndarray, seam_cols: list[int]) -> dict:
    """Thin-feature (wire/cable) mass inside sky-sky flow bands vs outside.

    A doubled cable materializes extra dark-thin pixels inside the +-128 px
    correction band that its control zone does not have."""
    g = gray[30:520].astype(np.float32)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_K, CLOSE_K))
    thin = (cv2.morphologyEx(g, cv2.MORPH_CLOSE, k) - g) > 4.0
    w = gray.shape[1]
    out = {}
    for c in seam_cols:
        band = np.arange(c - 128, c + 129) % w
        ctrl = np.concatenate([np.arange(c - 320, c - 160), np.arange(c + 160, c + 320)]) % w
        out[c] = {"band_frac": float(thin[:, band].mean()),
                  "ctrl_frac": float(thin[:, ctrl].mean())}
    return out


# ===========================================================================
# STRUCTURE-FIRST (round 1) — the CORRECTION half of the human-stitcher
# architecture. The detection half above is unchanged and stays the judge.
#
#   1. strip_protection_mask(): LARGE-structure mask inside a seam strip.
#      ParallaxCorrector consumes it: flow-morph is FORBIDDEN on protected
#      pixels (conf -> 0 there, so the displacement collapses to the VERIFIED
#      rigid per-row profile — shift/shear only, concrete never bends) and
#      still-disagreeing protected structure is SINGLE-SOURCED (share
#      committed to the sharper camera, with temporal hysteresis on the
#      winner) instead of blended.
#   2. BoundaryGuard: the sky-ring boundary handoff — where ALL worst-10
#      rank-1 breaks of the rejected candidate entered (36-75 px arch/mast
#      slices) and which no prior stage corrected. Per frame it detects
#      protected structure crossing the boundary, RIGID-shifts the blended
#      sky composite locally to register it against the trusted ring
#      (verified: accepted only if the structure-weighted residual drops),
#      and ROUTES the per-column seam below crest-like silhouettes so the
#      silhouette edge is single-sourced from the sky camera (dynamic
#      per-frame seam with temporal hysteresis + EMA so seams do not pop).
#      Correction operates on the POST-BLEND sky accumulator: both sky cams'
#      content moves together, so sky-sky convergence is not re-coupled
#      (NOTE B).
#   3. Frame warm-up: rewind_for_start() on the corrector/guard after a
#      forward pre-pass => frame 0 EMA-blends against warmed state (no
#      under-corrected first frames / doubled cable).
#   4. cmd_round(): lexicographic round runner — rank 1 structural integrity
#      (this module's detector, bar 1.5 px), rank 2 rolling-misalignment
#      stability, rank 3 ghost energy (lowest priority, regressions
#      acceptable) — plus the per-frame glancing-inspection artifacts.
# ===========================================================================

PROT_MIN_AREA = 700     # px: a protected component is LARGE structure
PROT_SKY_MIN_AREA = 1500  # px: smooth comps this big compete for "sky"
PROT_SKY_LUMA_REL = 0.62  # brightness (vs brightest big smooth comp) => sky
PROT_DILATE = 5
PROT_SOFT_SIGMA = 3.0


def strip_protection_mask(lum_i: np.ndarray, lum_j: np.ndarray,
                          valid: np.ndarray) -> np.ndarray:
    """Soft [0,1] LARGE-structure protection mask for one seam strip.

    Same wire-proofing as the detector (grayscale closing kills dark thin
    wires before the gradient, binary opening 9 px kills anything thinner
    than ~9 px). A strip has no global geometry to seed sky from, so smooth
    components are classified sky-vs-concrete by BRIGHTNESS relative to the
    brightest large smooth component (open sky). Misclassifying road/ground
    as protected only costs rank-3 ghost energy — explicitly acceptable."""
    g8 = (np.clip(0.5 * (lum_i + lum_j), 0.0, 1.0) ** (1.0 / 2.4) * 255.0).astype(np.uint8)
    g = g8.astype(np.float32)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_K, CLOSE_K))
    gc = cv2.morphologyEx(g, cv2.MORPH_CLOSE, k)
    gb = cv2.GaussianBlur(gc, (0, 0), GRAD_SIGMA)
    gx = cv2.Sobel(gb, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gb, cv2.CV_32F, 0, 1, ksize=3)
    grad = np.sqrt(gx * gx + gy * gy) * 0.25
    smooth = ((grad < GRAD_SKY_T) & valid).astype(np.uint8)
    n, lab = cv2.connectedComponents(smooth, connectivity=4)
    sky = np.zeros(g.shape, bool)
    if n > 1:
        counts = np.bincount(lab.ravel(), minlength=n).astype(np.float64)
        sums = np.bincount(lab.ravel(), weights=g.ravel(), minlength=n)
        means = sums / np.maximum(counts, 1.0)
        big = counts >= PROT_SKY_MIN_AREA
        big[0] = False
        if big.any():
            ref = float(means[big].max())
            sky_lbl = np.flatnonzero(big & (means >= PROT_SKY_LUMA_REL * ref))
            if sky_lbl.size:
                sky = np.isin(lab, sky_lbl)
    struct = ((~sky) & valid).astype(np.uint8)
    ko = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (OPEN_K, OPEN_K))
    opened = cv2.morphologyEx(struct, cv2.MORPH_OPEN, ko)
    n2, lab2, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    if n2 <= 1:
        return np.zeros(g.shape, np.float32)
    keep = np.flatnonzero(stats[1:, cv2.CC_STAT_AREA] >= PROT_MIN_AREA) + 1
    if keep.size == 0:
        return np.zeros(g.shape, np.float32)
    P = np.isin(lab2, keep).astype(np.uint8)
    P = cv2.dilate(P, np.ones((PROT_DILATE, PROT_DILATE), np.uint8))
    return np.clip(cv2.GaussianBlur(P.astype(np.float32), (0, 0), PROT_SOFT_SIGMA), 0.0, 1.0)


# ------------------------------------------------- stitch-artifact inspector

def stitch_artifact_records(lum_comp: np.ndarray, lum_sky: np.ndarray,
                            lum_ring: np.ndarray, frame: int, rlo: int,
                            sky_ref: float) -> list[dict]:
    """r2-2 blocker 2: mint records for COMPOSITE-ONLY edges in the boundary
    band — edge energy in the blended output that exists in NEITHER single-
    camera render at that location (comb-teeth smear, hard straight-edge
    source-cuts). All inputs are linear luma over the same ART_ROWS crop
    (lum_sky/lum_ring post-guard, from BoundaryGuard.last_srcband).
    disp_px = max(blob height, width/8): teeth clusters score their tooth
    height, long thin cuts score their glance-visible length."""
    def _edges(x):
        g = cv2.GaussianBlur(x, (0, 0), 1.0)
        return cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3),
                             cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    ec = _edges(lum_comp)
    k = np.ones((ART_SRC_DILATE, ART_SRC_DILATE), np.uint8)
    esrc = cv2.dilate(np.maximum(_edges(lum_sky), _edges(lum_ring)), k)
    m = (ec > ART_EDGE_HI * sky_ref) & (esrc < ART_SRC_REL * ec)
    md = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE,
                          np.ones((3, ART_CLUSTER_W), np.uint8))
    n, lab, st, cent = cv2.connectedComponentsWithStats(md, connectivity=8)
    recs = []
    for l in range(1, n):
        x, y, wd, hg, _ = st[l]
        area = int((m & (lab == l)).sum())
        if area < ART_MIN_AREA or wd < ART_MIN_W:
            continue
        recs.append({"frame": frame, "seam": "boundary", "type": "ghost-edge",
                     "col": int(round(cent[l][0])),
                     "row": int(round(cent[l][1])) + rlo,
                     "disp_px": round(float(max(hg, wd / 8.0)), 2),
                     "area_px": area, "extent": [int(wd), int(hg)]})
    return recs


# --------------------------------------------------------- sky-ring boundary

BG_PROBE_ROWS = (3, 16)   # rows below the seam sampled for the crossing probe
BG_DARK_FRAC = 0.62       # probe median < this x open-sky luma => structure.
                          # 0.68 probed WORSE: a tree canopy fused with the
                          # chopped pole into one 150-col run and the rigid
                          # verification could no longer isolate the pole.
                          # 0.62's occasional single-frame dropout on that
                          # pole is bridged by BG_HOLD + BG_RUN_MIN=6 instead.
BG_CORE_PAD = 110         # measurement/verification window: interval +- this.
                          # Probed at 44 (structure-focused): WORSE — with two
                          # poles at different depths in one core, the shift
                          # that fixes the boundary-crossing pole misaligns the
                          # other and acceptance flaps; the full window's
                          # context stabilizes both pc and verification.
BG_RUN_MIN = 6            # crossing run width (px): the wire gate (median over
                          # 13 rows already kills shallow wires; steep wires are
                          # 2-3 px wide). 10 dropped a ~10 px pole every few frames.
# BG_HOLD (12): REMOVED in r2-1 (lever 1). Holding the last verified shift
# after verification drops was exactly the stale-shift mechanism that produced
# the project's worst break (c2494 f657-659, 78.7 px: the structure accelerated
# through a sweep while the hold kept applying a dead value). Policy now:
# unverifiable => single-source/dissolve, verified => apply, nothing else.
BG_GAP_MERGE = 24         # merge crossing runs closer than this
BG_PAD = 110              # correction window pad beyond the crossing interval
BG_EXT = 64               # extra sampling margin for the warp (cropped after)
BG_RAMP = 96              # raised-cosine feather (px) at the window sides
BG_SHIFT_MAX = 45.0       # rigid shift cap (px)
BG_DY_MAX = 18.0
BG_ACCEPT_REL = 0.85      # verified: residual must drop to <= this x zero-shift
BG_GRAD_MIN = 0.03        # structure weight floor for verification (linear luma)
BG_EMA_NEW = 0.5          # temporal EMA weight of the new measurement
BG_STEP_MAX = 3.0         # max shift change per consecutive frame (px)
BG_ROUTE_MARGIN = 18      # handoff this far below a crest silhouette
BG_ROUTE_NEAR = 34        # a silhouette top within [seam-NEAR, seam+2] => route
BG_ROUTE_STEP = 4.0       # max routed-seam move per consecutive frame (px)
BG_ROUTE_RES_MAX = 0.05   # interior residual bar for accepting a route
BG_MIN_SHIFT = 0.4        # shifts below this are not applied

# ---- round 2: SILHOUETTE-STEP CLOSED LOOP (the rank-1 metric gates the guard)
# Round-1 autopsy (session 99d9eefc, probe_local_step): the photometric window
# residual is a MISALIGNED objective — its verified optima (esp. |dy|~15 on
# blurred/diagonal content) moved the silhouette at the handoff row and
# CREATED 12-27 px ledges on intervals that started near-clean (f492 c2222:
# 0.95 -> -12.8 px; f516: +2.0 -> +27.6; f660: -2.8 -> +21.8). Round 2 makes
# the guard optimize what the judge measures: the local silhouette step at
# the handoff (median dark-run centroid, BG_SIL_ROWS rows each side). Every
# candidate — photometric ones included — is scored by post-shift step;
# zero-shift is always in the pool, so the gate can never worsen a clean
# handoff. Photometric residual is demoted to a sanity bound.
BG_SIL_GAP = 4            # rows skipped on each side of the seam row
BG_SIL_ROWS = 18          # rows measured per side (median over rows: robust)
BG_SIL_MIN_ROWS = 6       # fewer measurable rows => step unmeasurable
BG_SIL_PAD = 90           # step-window col pad (> BG_SHIFT_MAX: warps keep
                          # real content under the measurement, not border)
BG_SIL_WIDE_FRAC = 0.8    # dark run wider than this x window => crest-like,
                          # centroid uninformative => photometric path keeps
                          # the round-1 behavior that fixed the f486 crest
BG_SIL_BAR = 2.0          # |step| below this: handoff verified continuous
BG_SIL_GAIN_MIN = 3.0     # a non-zero winner must beat |step0| by this (px)
BG_SIL_PHOTO_SLACK = 1.05 # photometric e allowed up to this x e0 when the
                          # step improves by >= BG_SIL_GAIN_MIN. Round 3: was
                          # 1.30 — that slack admitted a WRONG-PAIR winner at
                          # f0-f6 c3026 (e1=1.22x e0, dx railed at the clamp,
                          # severed the NEIGHBORING pole by 31 px). Legitimate
                          # sil/shear wins in the shear_probe set all IMPROVED
                          # photometric e; near-neutral is all the slack the
                          # rank order needs.
BG_SIL_MAX_PAIR = BG_SHIFT_MAX + 8.0
                          # round 3 identity gate: a sky-side run farther than
                          # this from the ring-side anchor CANNOT be the same
                          # structure under any correctable registration
                          # (shift cap 45 + measurement noise). Pairing across
                          # it is what invented the -66.5 px "step" at f0-f6
                          # and drove the railed 45 px mis-shift. Far runs are
                          # dropped per row; too few honest rows => the sil
                          # path declares UNMEASURABLE and the round-1
                          # photometric gate (which fixed this pole) decides.
BG_SHEAR_MAX = 0.046      # px/row cap for the verified affine term. ROUND r2-1
                          # (lever 2): was 0.25 (~14deg equivalent) — re-bounded
                          # to the stated affine budget rot<=1.5deg (tan=0.026)
                          # + shear<=2% (0.020). Anything needing more is a
                          # SHAPE MISMATCH and goes to lever 1 (single-source),
                          # not to a warp that invents geometry.
BG_SHEAR_MIN = 0.012      # smaller slope mismatches are noise, not applied
BG_SHEAR_STEP = 0.02      # max shear change per consecutive frame (px/row)
BG_SIL_SLOPE_ROWS = 150   # sky-side rows for the Theil-Sen slope (tilt) fit
BG_SIL_SLOPE_MIN = 24     # min trace rows before a slope is trusted

# ---- r2-2 LEVER (r2-1 judge blockers 1+2): the unverifiable fallback stack
# (around-route + per-column feather widening) is REPLACED by a WHOLE-INTERVAL
# SYMMETRIC DISSOLVE — the pro anchor's own concession for fast near-field
# crossers. r2-1 post-mortem, measured:
#   * feather-widening "dissolve" left the silhouette step visible (f126
#     c3324: policy=dissolve, 35.7 px still minted) — a wider vertical ramp
#     around the SEAM ROW cannot cover a structure misaligned over its whole
#     height;
#   * the per-column route/feather freedom minted comb-teeth on the c3439
#     arch (f508-520) that score 0.0 in the scanner;
#   * the around-route's edge taper cut straight through structure wider
#     than its window (f1356 canopy source-cut);
#   * the aligned-shortcut e0 <= 0.02 fired on MOTION-BLURRED sweeps (blur
#     kills the gradients the photometric residual is built from), so the
#     worst breaks (c3324 f127: sil0 -46.25, e0 "clean") were treated as
#     aligned and crest-routed with the 46 px step left raw.
# r2-2 policy: unverifiable => the whole crossing interval cross-fades sky
# against ring at 50/50 over the FULL overlap height (vertical tapers at the
# overlap edges, horizontal taper into neighboring columns, temporal attack/
# release) — a symmetric ghost double, never a hard step. verified => apply.
# Nothing else exists.
BG_SIL_OK_MAX = 4.0       # a verified winner's REMAINING |step| may not exceed
                          # this (pro anchor concedes hard breaks to 4.5 px on
                          # 97/97 frames; r2-1 accepted "improved" winners with
                          # 25+ px left standing — that is not verification)
BG_DIS_PAD = 64           # dissolve columns beyond the crossing interval (r2-2
                          # 48: the dissolve footprint's OWN horizontal edge read
                          # as a rectangular composite boundary on a solid canopy
                          # — f1356. Widened + softer sigma => no visible edge.)
BG_DIS_SIGMA = 15.0       # horizontal taper of the dissolve weight (Gaussian).
                          # r2-2 12 read a rectangular edge on the solid canopy;
                          # pp-2 widened to soften it, but 20 bled onto the
                          # adjacent routed crest — 15 + the routed-crest clamp
                          # keeps both.
BG_DIS_ONSET = 0.7        # weight a NEWLY engaged dissolve jumps to (covering
                          # most of the step immediately reads as a soft ghost;
                          # a rate-limited ramp-in is 3 frames of raw step)
BG_DIS_ATTACK = 0.4       # weight rise per frame after onset
BG_DIS_RELEASE = 0.08     # weight fall per frame (a 1-frame engage decays as a
                          # ~9-frame fade — the c2680 f19 one-frame pole pop
                          # class becomes a brief soft ghost; slower than r2-2's
                          # 0.12 to kill the residual dissolve-edge pop)
BG_DIS_VTAPER = 22        # rows of the 1.0->0.5 / 0.5->0.0 vertical tapers at
                          # the overlap edges of the symmetric dissolve

# ---- pp-2 LEVER: HONEST POST-CORRECTION HARD-BREAK SWEEP.
# r2-2 blocker (judge): rigid structure STILL hard-breaks (c2494 arch limb 27 px,
# c2931 pole 25 px, f1356 canopy 38 px source-cut). The pp-2 probe traced the
# mechanism: the route/dissolve decision trusts the guard's OWN narrow signals
# (18-row sil centroid, photometric e0) — and they under-report. The pole [2941,
# 2953] measured sil0 3.0 (true break 31 px), got marked "aligned" and routed;
# the f1356 canopy crossing at c3535 was never DETECTED as a crossing interval
# (ring probe below the seam is open sky under the canopy), so nothing corrected
# it and the ring-first handoff cut it straight. Neither is a policy the pre-
# correction interval detector can fix. This sweep measures the ACTUAL surviving
# handoff step on the POST-correction composite (sky centroid just above the
# seam vs ring centroid just below, sliding the full width) and, wherever a
# rigid structure still steps > the pro ceiling OR the sky silhouette source-cuts
# against open ring, ADDS those columns to the symmetric dissolve — CONTEXT
# rule 2 applied at honest measurement: no candidate reconciled it within
# 4.5 px => it dissolves, it never hard-cuts. Cleanly-routed crests measure
# ~0 post-shift and are passed through untouched (rule 1 preserved).
BG_HARD_CEIL = 4.5        # pro anchor hard-break ceiling (px). Surviving rigid
                          # steps above this dissolve instead of cutting. The
                          # sweep runs the RANK-1 boundary detector itself on a
                          # provisional (route-only) composite — matching the
                          # judge's operator exactly — rather than a heuristic
                          # centroid step (an early cut tried near/far dark-run
                          # centroids: it missed the chain-based "offset" class
                          # entirely and flooded multi-depth crest windows).
BG_SWEEP_DIS_PAD = 40     # dissolve half-width for a sweep-flagged column
                          # (narrower than the policy BG_DIS_PAD: a routed crest
                          # can sit only ~55 px from a limb break — a wide pad
                          # would bleed the ghost onto the crisp crest)
BG_SWEEP_MAXCOLS = 700    # sanity cap: if a frame flags more columns than this
                          # the measurement is untrusted (open-sky false lock) —
                          # skip the sweep that frame and log it

# ---- r2-2 blocker 2: the silhouette scanner scores comb-teeth smear and
# hard straight-edge source-cuts 0.0 (they erase the clean silhouette the
# chain fits need). The ARTIFACT INSPECTOR mints records for COMPOSITE-ONLY
# EDGES: edge energy present in the blended output but in NEITHER single-
# camera render at that location (dilated tolerance). Legitimate content
# edges exist in a source; symmetric ghost doubles keep each source's edge at
# half contrast AT the source position (also present); only stitching
# inventions — comb teeth, hard handoff cuts — light up.
ART_ROWS = (470, 726)     # global rows scanned (boundary band + margin)
ART_EDGE_HI = 0.25        # x sky_ref: composite edge floor to be an artifact
                          # (calibrated on the captured r2-1 c3439 comb frames:
                          # tooth edges run 0.03-0.10 linear vs sky_ref 0.123)
ART_SRC_REL = 0.5         # source edge must be < this x the composite edge
                          # ("the composite invented at least half of it")
ART_SRC_DILATE = 3        # px tolerance when matching composite vs source edges
ART_CLUSTER_W = 11        # horizontal closing: comb teeth cluster into one blob
ART_MIN_AREA = 30         # px of (undilated) artifact pixels per record
ART_MIN_W = 10            # min blob width (px): isolated speckle is not minted

# ---- r2-1 LEVER 3: ring-tier per-frame seam routing (class (c)). The six ring
# seams were frozen columns; protected structure crossing one got share-space
# commitment at best. Port the structure-aware routing: per-frame min-cost
# vertical seam path inside the overlap, protected structure horizontally
# dilated by the blend feather so the path clears it by a full feather width
# (=> structure single-sourced), temporal hysteresis so the path never pops.
RT_MAX_DEV = 100          # max path deviation from the frozen seam col (px)
RT_PROT_K = 30.0          # cost multiplier on (dilated) protected structure
RT_PROT_FLOOR = 0.002     # absolute cost floor on protected pixels
RT_STEP_PEN = 0.0005      # DP per-row move penalty (prefer straight seams)
RT_BLUR = 2.0             # disagreement blur (px)
RT_ACCEPT_REL = 0.92      # routed path cost must be <= this x frozen-col cost
RT_CROSS_ROWS = 10        # rows of protected crossing at the frozen col to engage
RT_STEP = 2.5             # max path move per consecutive frame (px/row)
RT_EMA_NEW = 0.55         # EMA weight of the new path
RT_ONSET_DEV = 10         # near-frozen -> deeper than this: engage instantly
RT_EDGE_GUARD = 6         # keep the path this far inside the candidate window


def _dark_runs_x(lum: np.ndarray, rows: np.ndarray, cols: np.ndarray,
                 thr: float, ref_x: float | None = None,
                 wide_frac: float = 1.01,
                 max_dist: float | None = None):
    """Per-row centroid of the dark run (largest, or nearest ref_x) inside
    cols. Rows whose run spans > wide_frac x window are dropped (crest-like:
    centroid uninformative). Round 3: with ref_x and max_dist, runs farther
    than max_dist from ref_x are IDENTITY-REJECTED per row (a run that far
    away is a different structure — pairing it invents huge fake steps);
    rows left with no near run are dropped, so the caller's MIN_ROWS bar
    doubles as the honesty bar. Returns (rows[], x[]) float32 arrays."""
    rs, xs = [], []
    wmax = wide_frac * cols.size
    for r in rows:
        if r < 0 or r >= lum.shape[0]:
            continue
        idx = np.flatnonzero(lum[r, cols] < thr)
        if idx.size < 3:
            continue
        brk = np.flatnonzero(np.diff(idx) > 4)
        runs = [rn for rn in np.split(idx, brk + 1) if rn.size >= 3]
        if not runs:
            continue
        if ref_x is not None and max_dist is not None:
            runs = [rn for rn in runs
                    if abs(float(rn.mean()) - ref_x) <= max_dist]
            if not runs:
                continue
        run = (max(runs, key=len) if ref_x is None
               else min(runs, key=lambda rn: abs(float(rn.mean()) - ref_x)))
        if run.size > wmax:
            continue
        rs.append(float(r))
        xs.append(float(run.mean()))
    return np.asarray(rs, np.float32), np.asarray(xs, np.float32)


def _theil_slope(rows: np.ndarray, xs: np.ndarray, lag: int = 6):
    """Median-of-pairwise-slopes (Theil-Sen, fixed lag): robust to the
    outlier rows that broke least-squares medial-line fits on clutter."""
    if rows.size < lag + 6:
        return None
    sl = [(xs[i + lag] - xs[i]) / (rows[i + lag] - rows[i])
          for i in range(rows.size - lag) if rows[i + lag] != rows[i]]
    return float(np.median(sl)) if sl else None


class BoundaryGuard:
    """Rank-1 protection of the sky-ring boundary handoff (see block comment).

    Attached to a calibrated NineStitcher as nine.structure_guard;
    compose_frame calls correct(acc_sky, acc_ring, frame_idx) after both
    accumulators exist and blends with the returned per-frame alpha."""

    def __init__(self, nine, routing: bool = True):
        self.nine = nine
        self.routing = bool(routing)
        s0 = nine.r0_9
        self.sky_cov = np.zeros((nine.band_h, nine.eq_w), bool)
        self.sky_cov[: nine.sky_r1 - s0] = nine.sky_union[s0:]
        self.ring_cov9 = np.zeros((nine.band_h, nine.eq_w), bool)
        self.ring_cov9[nine.ring.r0 - s0:] = nine.ring_cov
        self.tracks: list[dict] = []          # live shift tracks (EMA between
                                              # consecutive VERIFIED frames only)
        self.route_prev: np.ndarray | None = None
        self.route_idx: int | None = None
        self.dis_prev: np.ndarray | None = None  # r2-2: per-col dissolve weight
        self._dis_idx: int | None = None
        # r2-2 symmetric-dissolve geometry: per-column overlap edges (band-
        # relative): first ring-covered row, last sky-covered row.
        self.ov_top = np.where(self.ring_cov9.any(axis=0),
                               np.argmax(self.ring_cov9, axis=0),
                               nine.band_h - 1).astype(np.float32)
        self.ov_bot = np.where(self.sky_cov.any(axis=0),
                               nine.band_h - 1 - np.argmax(self.sky_cov[::-1], axis=0),
                               0).astype(np.float32)
        self.last_srcband: tuple | None = None  # r2-2: post-guard source lumas
                                                # for the artifact inspector
        self.frames: dict[int, dict] = {}     # per-frame diagnostics
        self.stats = {"guard_s": 0.0, "frames": 0, "shifts_applied": 0,
                      "shifts_rejected": 0, "routed_frames": 0,
                      "dissolved": 0, "sweep_frames": 0,
                      "sweep_cols_total": 0, "sweep_overflow_frames": 0}

    def rewind_for_start(self) -> None:
        """Frame warm-up: after a forward pre-pass, rewind indices so the
        real frame 0 EMA-blends against the warmed state (no cold start)."""
        for tr in self.tracks:
            tr["idx"] = -1
        if self.route_idx is not None:
            self.route_idx = -1
        if self._dis_idx is not None:
            self._dis_idx = -1
        self.frames.clear()

    def _apply_shift(self, acc_sky: np.ndarray, c0: int, c1: int,
                     dx: float, dy: float, padl: int = BG_PAD,
                     padr: int = BG_PAD, s: float = 0.0,
                     sm: float | None = None,
                     top: float | None = None) -> None:
        """Rigid whole-window shift of the BLENDED sky accumulator, raised-
        cosine feathered at the window sides (the ramps live in the pads,
        off the protected structure; the structure itself moves rigidly).
        Pads are pre-split at the midpoint between neighboring intervals so
        application windows never overlap.

        Round 2: optional SHEAR s (px/row about row sm) — an affine rotation
        term, shear-not-bend: within the structure's vertical extent the
        transform is strictly affine (straight edges stay straight). Above
        the measured structure top the shear displacement FREEZES at its
        top value (rows above hold only open sky/wires — rank 3 — and an
        unbounded extrapolation would drag zenith content sideways)."""
        W = self.nine.eq_w
        colsm = np.arange(c0 - padl, c1 + padr + 1) % W
        colsx = np.arange(c0 - padl - BG_EXT, c1 + padr + BG_EXT + 1) % W
        sub = np.ascontiguousarray(acc_sky[:, colsx])
        if abs(s) >= 1e-4 and sm is not None:
            rows = np.arange(sub.shape[0], dtype=np.float32)
            rel = rows - float(sm)
            if top is not None:
                rel = np.clip(rel, float(top) - float(sm), None)
            dxr = dx + s * rel
            map_x = np.arange(sub.shape[1], dtype=np.float32)[None, :] + dxr[:, None]
            map_y = np.repeat(rows[:, None] + dy, sub.shape[1], axis=1)
            sh = cv2.remap(sub, map_x, map_y, cv2.INTER_LINEAR,
                           borderMode=cv2.BORDER_REPLICATE)
        else:
            M = np.float32([[1, 0, -dx], [0, 1, -dy]])
            sh = cv2.warpAffine(sub, M, (sub.shape[1], sub.shape[0]),
                                flags=cv2.INTER_LINEAR,
                                borderMode=cv2.BORDER_REPLICATE)
        sh = sh[:, BG_EXT:-BG_EXT]
        core = sub[:, BG_EXT:-BG_EXT]
        wcol = np.ones(core.shape[1], np.float32)
        rl = max(8, min(BG_RAMP, padl - 2))
        rr = max(8, min(BG_RAMP, padr - 2))
        wcol[:rl] = (0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, rl))).astype(np.float32)
        wcol[-rr:] = np.minimum(
            wcol[-rr:], (0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, rr))).astype(np.float32))
        acc_sky[:, colsm] = core + wcol[None, :, None] * (sh - core)
        self.stats["shifts_applied"] += 1

    # ------------------------------------------------------------- internals

    def _crossing_intervals(self, lum_ring: np.ndarray, seam: np.ndarray,
                            sky_ref: float) -> list[tuple[int, int]]:
        nine = self.nine
        W = nine.eq_w
        offs = np.arange(BG_PROBE_ROWS[0], BG_PROBE_ROWS[1])
        rows = np.clip(seam[None, :] + offs[:, None] - nine.ring.r0,
                       0, lum_ring.shape[0] - 1)
        probe = np.median(lum_ring[rows, np.arange(W)[None, :]], axis=0)
        crossing = probe < BG_DARK_FRAC * sky_ref
        idx = np.flatnonzero(crossing)
        if idx.size == 0:
            return []
        brk = np.flatnonzero(np.diff(idx) > BG_GAP_MERGE)
        runs = [(int(r[0]), int(r[-1])) for r in np.split(idx, brk + 1)
                if r[-1] - r[0] + 1 >= BG_RUN_MIN]
        # DISTINCT structures are never fused (one rigid shift cannot serve
        # two depths — probed: a 291-col merged interval left a pole with a
        # 19 px offset). Close neighbors instead get their application pads
        # split at the midpoint of the gap (see correct()).
        return runs

    def _provisional_alpha(self, route_full: np.ndarray,
                           seam: np.ndarray) -> np.ndarray:
        """The route-only alpha (no dissolve) — what the composite handoff
        looks like BEFORE the symmetric dissolve is laid over it. Mirrors the
        render alpha computation in correct() with the dissolve weight = 0."""
        nine = self.nine
        alpha = nine.alpha
        moved = np.abs(route_full - seam) > 0.6
        if not moved.any():
            return alpha
        alpha = alpha.copy()
        cols = np.flatnonzero(moved)
        f0 = float(nine.EDGE_FEATHER)
        rr = np.arange(nine.r0_9, nine.r1_9, dtype=np.float32)[:, None]
        ramp = np.clip((route_full[None, cols] - rr + f0) / (2 * f0), 0.0, 1.0)
        a = np.where(self.sky_cov[:, cols], ramp, 0.0)
        nr = ~self.ring_cov9[:, cols]
        a[nr] = np.where(self.sky_cov[:, cols][nr], 1.0, 0.0)
        alpha[:, cols] = a.astype(np.float32)
        return alpha

    def _hard_break_sweep(self, acc_sky: np.ndarray, acc_ring: np.ndarray,
                          route_full: np.ndarray, seam: np.ndarray,
                          frame_idx: int) -> tuple[np.ndarray, dict]:
        """pp-2: run the RANK-1 boundary detector on a PROVISIONAL (route-only,
        pre-dissolve) composite and return the columns whose rigid structure
        still hard-breaks > BG_HARD_CEIL. This is the honest lever: the guard's
        own per-interval sil metric and the pre-correction crossing detector
        both under-reported the r2-2 breaks (a pole read sil 3 px while the
        chain fit read 31 px; a canopy crossing was never detected at all). By
        measuring with the exact operator the judge uses, every surviving hard
        break — undetected (f1356 canopy), mis-measured (c2931 pole), or plain
        residual (arch limbs) — is caught and folded into the symmetric
        dissolve. A cleanly-routed/aligned crossing reads < ceiling here and is
        NOT flagged, so rule-1 rigid handoffs stay crisp (no crest flooding)."""
        from .ninestitch import from_linear
        nine = self.nine
        W, r0, sky_r1 = nine.eq_w, nine.ring.r0, nine.sky_r1
        rows_hi = min(ROWS_ANALYZE, BOUND_BAND[1] + FIT_WIN + 60)
        alpha = self._provisional_alpha(route_full, seam)
        canvas = np.zeros((rows_hi, W, 3), np.float32)
        sky_hi = min(sky_r1, rows_hi)
        canvas[:sky_hi] += alpha[:sky_hi, :, None] * acc_sky[:sky_hi]
        canvas[r0:rows_hi] += (1.0 - alpha[r0:rows_hi, :, None]) \
            * acc_ring[:rows_hi - r0]
        gray = cv2.cvtColor(from_linear(canvas), cv2.COLOR_BGR2GRAY)
        bnd = segment(gray)["bnd"].astype(bool)
        rows_lo = max(0, BOUND_BAND[0] - FIT_WIN - 60)
        band = bnd[rows_lo:rows_hi]
        ch_col = [c + np.array([[0, rows_lo]], np.float32)
                  for c in build_chains(band)]
        ch_row = [c + np.array([[rows_lo, 0]], np.float32)
                  for c in build_chains(band.T)]
        recs = measure_boundary(ch_col, ch_row, frame_idx)
        mask = np.zeros(W, bool)
        mx = 0.0
        n_rec = 0
        for rr_ in recs:
            d = rr_.get("disp_px")
            if d is not None and d > BG_HARD_CEIL:
                mask[int(rr_["col"]) % W] = True
                mx = max(mx, float(d))
                n_rec += 1
        diag = {"break_records": n_rec, "break_max_px": round(mx, 2)}
        n = int(mask.sum())
        if n > BG_SWEEP_MAXCOLS:      # untrusted measurement (open-sky lock)
            diag["skipped_overflow"] = n
            return np.zeros(W, bool), diag
        diag["break_cols"] = n
        return mask, diag

    def correct(self, acc_sky: np.ndarray, acc_ring: np.ndarray,
                frame_idx: int):
        """Rigid-align + route around protected boundary-crossing structure.
        Mutates acc_sky in place; returns (acc_sky, alpha_for_this_frame)."""
        import time as _time
        t0 = _time.perf_counter()
        nine = self.nine
        seam = nine.seam_row
        r0, sky_r1, W, cap = nine.ring.r0, nine.sky_r1, nine.eq_w, nine.row_cap
        lum_sky = acc_sky.mean(axis=2)
        lum_ring = acc_ring.mean(axis=2)
        sky_ref = max(float(np.percentile(
            lum_sky[cap + 40: cap + 280: 4, ::8], 70)), 1e-3)
        intervals = self._crossing_intervals(lum_ring, seam, sky_ref)

        route_full = seam.astype(np.float32)
        dissolve_ivs: list[tuple[int, int]] = []   # r2-1 lever 1 fallback
        diag = {"sky_ref": round(sky_ref, 4), "intervals": []}

        # application pads split at the midpoint between neighboring intervals
        pads = []
        for k, (c0, c1) in enumerate(intervals):
            padl = BG_PAD if k == 0 else min(BG_PAD, max(8, (c0 - intervals[k - 1][1]) // 2 - 2))
            padr = BG_PAD if k == len(intervals) - 1 else min(
                BG_PAD, max(8, (intervals[k + 1][0] - c1) // 2 - 2))
            pads.append((padl, padr))

        for (c0, c1), (padl, padr) in zip(intervals, pads):
            rec = {"cols": [int(c0), int(c1)], "dx": 0.0, "dy": 0.0,
                   "accepted": False, "routed_cols": 0}
            colsc = np.arange(c0 - BG_CORE_PAD, c1 + BG_CORE_PAD + 1) % W
            rmin = int(seam[colsc].max()) + 6
            # measurement rows confined to the boundary NEIGHBORHOOD: what
            # must align is the content at the handoff; rows far below are
            # deeper scenery at other depths. f642 crest probe: 90 rows ->
            # ratio 0.643 (verified), 150 -> 0.869, full 234 -> 0.913
            # (rejected) — the truss below the crest out-votes it.
            rmax = min(sky_r1 - 8, rmin + 90)
            tr = None
            for t in self.tracks:
                if c0 - BG_PAD <= t["c1"] + BG_PAD and c1 + BG_PAD >= t["c0"] - BG_PAD:
                    tr = t
                    break
            tr_fresh = tr is not None and tr["idx"] == frame_idx - 1

            # ---- round 2: LOCAL SILHOUETTE STEP at the handoff row — the
            # quantity a glance actually sees, and the rank-1 metric itself.
            # Median dark-run centroid over BG_SIL_ROWS rows per side; the
            # sky-side run is picked nearest the ring-side x so multi-
            # structure windows stay locked to the crossing structure.
            # Crest-like intervals (run spans the window) are unmeasurable
            # by design and keep the round-1 photometric path (which fixed
            # the f486 arch crest); poles/limbs/struts measure 18/18 rows.
            cols_s = np.arange(c0 - BG_SIL_PAD, c1 + BG_SIL_PAD + 1) % W
            sil_sm = int(np.median(seam[cols_s]))
            sil_top = None
            sil_step0 = None
            _sil_step = None
            # round 3: ring anchor tied to the CROSSING interval itself (was:
            # largest run anywhere in the +-90 col window — in multi-pole
            # neighborhoods that anchored the loop on the wrong structure)
            ctr_w = float((c1 - c0) / 2 + BG_SIL_PAD)
            rr_r, xx_r = _dark_runs_x(
                lum_ring,
                np.arange(sil_sm + BG_SIL_GAP, sil_sm + BG_SIL_GAP + BG_SIL_ROWS) - r0,
                cols_s, BG_DARK_FRAC * sky_ref, ref_x=ctr_w,
                wide_frac=BG_SIL_WIDE_FRAC,
                max_dist=float(c1 - c0) / 2 + 40.0)
            if rr_r.size >= BG_SIL_MIN_ROWS:
                ring_x = float(np.median(xx_r))
                lo = max(0, sil_sm - BG_SIL_SLOPE_ROWS - 20)
                hi = min(lum_sky.shape[0], sil_sm + 8)
                sub_s = np.ascontiguousarray(lum_sky[lo:hi][:, cols_s])
                colsw = np.arange(cols_s.size)
                step_rows = np.arange(sil_sm - BG_SIL_GAP - BG_SIL_ROWS,
                                      sil_sm - BG_SIL_GAP) - lo
                thr_s = BG_DARK_FRAC * sky_ref

                def _sil_step(ddx, ddy, ss, _sub=sub_s, _rows=step_rows,
                              _cw=colsw, _rx=ring_x, _thr=thr_s,
                              _yc=float(sil_sm - lo)):
                    if ddx or ddy or ss:
                        M = np.float32([[1, -ss, -ddx + ss * _yc], [0, 1, -ddy]])
                        w = cv2.warpAffine(_sub, M, (_sub.shape[1], _sub.shape[0]),
                                           flags=cv2.INTER_LINEAR,
                                           borderMode=cv2.BORDER_REPLICATE)
                    else:
                        w = _sub
                    rs_, xs_ = _dark_runs_x(w, _rows, _cw, _thr, ref_x=_rx,
                                            wide_frac=BG_SIL_WIDE_FRAC,
                                            max_dist=BG_SIL_MAX_PAIR)
                    if rs_.size < BG_SIL_MIN_ROWS:
                        return None
                    return _rx - float(np.median(xs_))

                sil_step0 = _sil_step(0.0, 0.0, 0.0)

            if rmax - rmin >= 60:
                from .ninestitch import _phase_correlate

                a = lum_ring[rmin - r0: rmax - r0][:, colsc]
                b = lum_sky[rmin: rmax][:, colsc]
                ga = _grad_of(a)
                wgt = ga * (ga >= BG_GRAD_MIN)
                # bias toward the CROSSING structure's own columns: the shift
                # must serve the structure at the boundary, not the window's
                # background (a near-field pole's 40+ px parallax loses the
                # unweighted optimum to wires behind it — f108 @2950)
                cpos = np.flatnonzero(
                    (np.arange(c0 - BG_CORE_PAD, c1 + BG_CORE_PAD + 1) >= c0 - 12)
                    & (np.arange(c0 - BG_CORE_PAD, c1 + BG_CORE_PAD + 1) <= c1 + 12))
                wgt[:, cpos] *= 4.0
                ws = float(wgt.sum())
                dx = dy = 0.0
                s_ap = 0.0
                ok = False
                if ws > 1.0:
                    sb = cv2.GaussianBlur(b, (0, 0), 1.0)
                    sa = cv2.GaussianBlur(a, (0, 0), 1.0)
                    _yc_r = float(sil_sm - rmin)

                    def _resid(ddx, ddy, ss=0.0):
                        M = np.float32([[1, -ss, -ddx + ss * _yc_r],
                                        [0, 1, -ddy]])
                        bsh = cv2.warpAffine(sb, M, (sb.shape[1], sb.shape[0]),
                                             flags=cv2.INTER_LINEAR,
                                             borderMode=cv2.BORDER_REPLICATE)
                        return float((np.abs(sa - bsh) * wgt).sum() / ws)

                    # candidates: luma pc, GRADIENT pc (thin poles carry no
                    # FFT energy against the sky gradient; their gradient
                    # image does), the live track's prior, and a DIRECT
                    # residual grid search (motion-blurred near-field poles
                    # defeat both pc variants — f108-126 sweep — but the
                    # verified-residual objective itself still ranks shifts)
                    cands = []
                    pc = _phase_correlate(a, b)
                    if abs(pc["dx"]) <= BG_SHIFT_MAX and abs(pc["dy"]) <= BG_DY_MAX:
                        cands.append((pc["dx"], pc["dy"]))
                    pcg = _phase_correlate(ga, _grad_of(b))
                    if abs(pcg["dx"]) <= BG_SHIFT_MAX and abs(pcg["dy"]) <= BG_DY_MAX:
                        cands.append((pcg["dx"], pcg["dy"]))
                    if tr_fresh:
                        cands.append((tr["dx"], tr["dy"]))
                    gdx = min(0.0, -BG_SHIFT_MAX) + np.arange(0, 2 * BG_SHIFT_MAX + 1, 3.0)
                    ge = [(_resid(d, 0.0), d) for d in gdx]
                    e_gx, gx0 = min(ge)
                    for d in np.arange(gx0 - 2.5, gx0 + 2.6, 1.0):
                        e = _resid(d, 0.0)
                        if e < e_gx:
                            e_gx, gx0 = e, d
                    gdy = np.arange(-BG_DY_MAX, BG_DY_MAX + 1, 2.0)
                    e_gy, gy0 = min((_resid(gx0, d), d) for d in gdy)
                    for d in np.arange(gy0 - 1.5, gy0 + 1.6, 0.5):
                        e = _resid(gx0, d)
                        if e < e_gy:
                            e_gy, gy0 = e, d
                    cands.append((float(np.clip(gx0, -BG_SHIFT_MAX, BG_SHIFT_MAX)),
                                  float(np.clip(gy0, -BG_DY_MAX, BG_DY_MAX))))
                    e0 = _resid(0.0, 0.0)
                    if sil_step0 is not None:
                        # ---- SILHOUETTE-STEP GATE (round 2). Every candidate
                        # is scored by the post-shift handoff step; zero-shift
                        # is always in the pool (never worsen a clean handoff:
                        # round-1's photometric optima turned f492's 0.95 px
                        # into -12.8 px — this gate makes that impossible).
                        # Photometric residual is a sanity bound + tiebreak.
                        sil_cands = []
                        dx1 = float(np.clip(-sil_step0, -BG_SHIFT_MAX, BG_SHIFT_MAX))
                        sil_cands.append((dx1, 0.0, 0.0))
                        m1 = _sil_step(dx1, 0.0, 0.0)
                        if m1 is not None and abs(m1) > 1.0:
                            sil_cands.append((float(np.clip(dx1 - m1, -BG_SHIFT_MAX,
                                                            BG_SHIFT_MAX)), 0.0, 0.0))
                        # shear (rotation) term — Andy's blurred-pole tilt
                        # class: Theil-Sen slope each side; affine only
                        rr_r2, xx_r2 = _dark_runs_x(
                            lum_ring, np.arange(sil_sm + BG_SIL_GAP, sil_sm + 64) - r0,
                            cols_s, thr_s, ref_x=ring_x, wide_frac=BG_SIL_WIDE_FRAC,
                            max_dist=BG_SIL_PAD)
                        rs_t, xs_t = _dark_runs_x(
                            sub_s, np.arange(0, sil_sm - BG_SIL_GAP - lo),
                            colsw, thr_s, ref_x=ring_x, wide_frac=BG_SIL_WIDE_FRAC,
                            max_dist=BG_SIL_PAD)
                        if rs_t.size:
                            sil_top = float(lo + rs_t.min())
                        slope_r = _theil_slope(rr_r2, xx_r2)
                        slope_s = _theil_slope(rs_t, xs_t)
                        if (slope_r is not None and slope_s is not None
                                and rs_t.size >= BG_SIL_SLOPE_MIN):
                            s_star = float(np.clip(slope_s - slope_r,
                                                   -BG_SHEAR_MAX, BG_SHEAR_MAX))
                            if abs(s_star) >= BG_SHEAR_MIN:
                                base = sil_cands[-1][0]
                                m_sh = _sil_step(base, 0.0, s_star)
                                if m_sh is not None:
                                    sil_cands.append((float(np.clip(
                                        base - m_sh, -BG_SHIFT_MAX, BG_SHIFT_MAX)),
                                        0.0, s_star))
                        scored = [(0.0, 0.0, 0.0, e0, sil_step0)]
                        for cdx, cdy in cands:
                            stp = _sil_step(cdx, cdy, 0.0)
                            if stp is not None:
                                scored.append((cdx, cdy, 0.0, _resid(cdx, cdy), stp))
                        for cdx, cdy, cs in sil_cands:
                            stp = _sil_step(cdx, cdy, cs)
                            if stp is not None:
                                scored.append((cdx, cdy, cs,
                                               _resid(cdx, cdy, cs), stp))
                        def _elig(c):
                            return ((c[0] == 0.0 and c[1] == 0.0 and c[2] == 0.0)
                                    or c[3] <= BG_ACCEPT_REL * e0
                                    or (abs(c[4]) + BG_SIL_GAIN_MIN <= abs(sil_step0)
                                        and c[3] <= BG_SIL_PHOTO_SLACK * e0))

                        _key = lambda c: (round(abs(c[4]) * 2) / 2.0, c[3])
                        # r2-1 LEVER 2 (bounded affine): translation-only
                        # candidates compete first; a shear candidate wins ONLY
                        # if it beats the translation winner on BOTH checks —
                        # strictly smaller |silhouette step| AND strictly
                        # smaller photometric residual. (Round-5's shear could
                        # win on min-step alone at up to 0.25 px/row; with the
                        # affine budget now 1.5deg+2% the term is a trim, and
                        # anything it cannot reconcile is a shape mismatch for
                        # lever 1, not for a bigger warp.)
                        elig_t = [c for c in scored if c[2] == 0.0 and _elig(c)]
                        win = min(elig_t, key=_key)
                        elig_s = [c for c in scored if c[2] != 0.0 and _elig(c)
                                  and abs(c[4]) < abs(win[4]) and c[3] < win[3]]
                        if elig_s:
                            win = min(elig_s, key=_key)
                        dx, dy, s_ap = float(win[0]), float(win[1]), float(win[2])
                        # r2-2: "improved" is NOT "verified". A winner may
                        # leave at most BG_SIL_OK_MAX of step standing (the pro
                        # anchor's hard-break ceiling); r2-1 accepted 40->25 px
                        # "improvements" on sweeps and shipped the 25 px step.
                        ok = (abs(win[4]) <= BG_SIL_BAR
                              or (abs(win[4]) + BG_SIL_GAIN_MIN <= abs(sil_step0)
                                  and abs(win[4]) <= BG_SIL_OK_MAX))
                        rec["sil0"] = round(sil_step0, 2)
                        rec["sil_after"] = round(win[4], 2)
                        rec["s"] = round(s_ap, 3)
                        rec["e0"] = round(e0, 5)
                        rec["e1"] = round(win[3], 5)
                    else:
                        # step unmeasurable (crest-like / foliage): round-1
                        # photometric path unchanged
                        best_e, best_d = e0, None
                        for cdx, cdy in cands:
                            e = _resid(cdx, cdy)
                            if e < best_e:
                                best_e, best_d = e, (cdx, cdy)
                        if best_d is not None and best_e <= BG_ACCEPT_REL * e0:
                            dx, dy = float(best_d[0]), float(best_d[1])
                            ok = True
                        rec["e0"] = round(e0, 5)
                        rec["e1"] = round(best_e, 5)
                if not ok:
                    # stale-hold stays ABOLISHED (r2-1). An unverified frame
                    # applies NOTHING — not the last verified value, not a
                    # decayed one. The interval symmetric-dissolves below.
                    self.stats["shifts_rejected"] += 1
                    dx = dy = s_ap = 0.0
                elif tr_fresh and tr.get("ver"):
                    # EMA + rate limit for temporal stability (rank 2) —
                    # only between VERIFIED values; the first verified onset
                    # of a track takes the full candidate (a rate-limited
                    # ramp-in leaves the structure half-corrected for frames)
                    cand = (dx, dy, s_ap)
                    dx = float(np.clip(BG_EMA_NEW * dx + (1 - BG_EMA_NEW) * tr["dx"],
                                       tr["dx"] - BG_STEP_MAX, tr["dx"] + BG_STEP_MAX))
                    dy = float(np.clip(BG_EMA_NEW * dy + (1 - BG_EMA_NEW) * tr["dy"],
                                       tr["dy"] - BG_STEP_MAX, tr["dy"] + BG_STEP_MAX))
                    tr_s = tr.get("s", 0.0)
                    s_ap = float(np.clip(BG_EMA_NEW * s_ap + (1 - BG_EMA_NEW) * tr_s,
                                         tr_s - BG_SHEAR_STEP, tr_s + BG_SHEAR_STEP))
                    # r2-2: verification outranks hysteresis. On a fast sweep
                    # the candidate moves > BG_STEP_MAX px/frame; the EMA-
                    # limited value then lags the structure and re-mints the
                    # step (r2-1 c2494 f645-664 stair-steps). If the smoothed
                    # shift no longer verifies, take the verified candidate.
                    if _sil_step is not None and abs(dx - cand[0]) > 1.0:
                        m_eff = _sil_step(dx, dy, s_ap)
                        if m_eff is None or abs(m_eff) > BG_SIL_OK_MAX:
                            dx, dy, s_ap = cand
                if tr is None:
                    tr = {"c0": c0, "c1": c1, "dx": dx, "dy": dy, "s": s_ap,
                          "sm": sil_sm, "top": sil_top,
                          "idx": frame_idx, "ver": bool(ok),
                          "padl": padl, "padr": padr}
                    self.tracks.append(tr)
                else:
                    # r2-1: "ver" now TRACKS verification (was sticky-True).
                    # After an unverified frame the next verified onset takes
                    # the full candidate again instead of EMA-ing against the
                    # zeros stored during the gap.
                    tr.update({"c0": c0, "c1": c1, "dx": dx, "dy": dy,
                               "s": s_ap, "sm": sil_sm, "top": sil_top,
                               "idx": frame_idx, "padl": padl, "padr": padr,
                               "ver": bool(ok)})
                rec["dx"], rec["dy"] = round(dx, 2), round(dy, 2)
                rec["accepted"] = bool(ok)

                if ok and (abs(dx) + abs(dy) >= BG_MIN_SHIFT
                           or abs(s_ap) >= BG_SHEAR_MIN):
                    self._apply_shift(acc_sky, c0, c1, dx, dy, padl, padr,
                                      s=s_ap, sm=sil_sm, top=sil_top)

            # -------- dynamic seam routing around crest-like silhouettes.
            # ONLY on verified-aligned intervals: routing unaligned content
            # hands a displaced sky rendering the whole silhouette (raw
            # interior residual is blind on dark foliage — f114/f126 probe:
            # routing a misregistered tree region CREATED 30-40 px offsets).
            # r2-2: the e0 <= 0.02 shortcut is only trusted when the
            # silhouette step is UNMEASURABLE. Motion blur destroys the
            # gradients the photometric residual is built from, so a fast
            # sweep measured sil0 = -46 px while e0 read "clean" (c3324 f127)
            # and the interval was crest-routed with the step left standing.
            # A measured step outranks a blind residual.
            sil_meas = rec.get("sil_after")
            aligned = (rec["accepted"]
                       or (sil_meas is not None and abs(sil_meas) <= BG_SIL_BAR)
                       or (sil_meas is None and rec.get("e0", 1.0) <= 0.02))
            if self.routing and aligned:
                colsr = np.arange(c0 - 30, c1 + 31) % W
                ls = acc_sky[:, colsr].mean(axis=2)   # post-shift sky luma
                sm = seam[colsr]
                top = cap + 10
                bot = int(sm.max()) + 46
                if bot > top + 20:
                    dark = (ls[top:bot + 60] < BG_DARK_FRAC * sky_ref).astype(np.uint8)
                    er = cv2.erode(dark[:bot - top], np.ones((16, 1), np.uint8))
                    has = er.any(axis=0)
                    fs = top + np.argmax(er, axis=0).astype(np.int32)
                    near = has & (fs >= sm - BG_ROUTE_NEAR) & (fs <= sm + 2)
                    if near.any():
                        # run length below the top silhouette: handoff must
                        # stay INSIDE thick concrete; where the band is thin
                        # the route drops BELOW it into open sky (a handoff
                        # near the lower silhouette mints wedge slivers)
                        nd = (~dark.astype(bool))
                        rl = np.full(fs.shape, 12, np.int32)
                        cw = np.flatnonzero(near)
                        for c_ in cw:
                            below = nd[fs[c_] - top:, c_]
                            rl[c_] = int(np.argmax(below)) if below.any() else below.size
                        depth = np.where(rl >= 36, BG_ROUTE_MARGIN, rl + 12)
                        route = sm.astype(np.float32)
                        cand = np.maximum(sm + 2, fs + depth).astype(np.float32)
                        route[near] = np.minimum(cand[near], float(sky_r1 - 12))
                        # taper the route back to the frozen seam over 24
                        # cols at the mask edges (a hard route->seam jump is
                        # itself a visible step on the silhouette)
                        t = cv2.GaussianBlur(near.astype(np.float32).reshape(1, -1),
                                             (0, 0), 8.0).ravel()
                        route = sm + np.clip(t / max(t.max(), 1e-6), 0.0, 1.0) * (route - sm)
                        # verify: interior residual (shifted sky vs ring) in the
                        # newly sky-owned rows must be small
                        rr = np.arange(int(sm.min()) + 2, int(route.max()) + 1)
                        if rr.size:
                            aa = lum_ring[np.clip(rr - r0, 0, lum_ring.shape[0] - 1)][:, colsr]
                            bb = ls[rr]
                            own = (rr[:, None] >= sm[None, :] + 2) & (rr[:, None] <= route[None, :])
                            if own.any():
                                res = float((np.abs(aa - bb) * own).sum() / own.sum())
                                rec["route_res"] = round(res, 5)
                                if res <= BG_ROUTE_RES_MAX:
                                    route = _median_1d(route, 9)
                                    route = np.maximum(route, sm.astype(np.float32))
                                    route_full[colsr] = np.maximum(route_full[colsr], route)
                                    rec["routed_cols"] = int(near.sum())
            elif self.routing and not aligned:
                # -------- r2-2: UNVERIFIABLE interval => WHOLE-INTERVAL
                # SYMMETRIC DISSOLVE (the pro anchor's near-field concession).
                # The r2-1 fallbacks are gone: the around-route's edge taper
                # cut straight through structure wider than its window (f1356
                # canopy), and feather-widening left the step visible while
                # the per-column freedom minted comb-teeth (c3439). A 50/50
                # cross-fade over the full overlap height has no hard edge to
                # mint anywhere, by construction.
                dissolve_ivs.append((c0, c1))
                rec["policy"] = "dissolve"
                self.stats["dissolved"] += 1
            diag["intervals"].append(rec)

        # r2-1: the HOLD pass is GONE (lever 1). Tracks that lost their
        # crossing detection simply expire; nothing stale is ever re-applied.
        self.tracks = [t for t in self.tracks if t["idx"] >= frame_idx]

        # routed-seam temporal hysteresis (EMA + rate limit, full width).
        # ONSET EXEMPTION — where the route was at the frozen seam and the
        # new target is deep, take the target immediately: rate-limiting the
        # onset would slide the handoff THROUGH the structure over frames.
        if self.route_prev is not None and self.route_idx == frame_idx - 1:
            prev = self.route_prev
            seam_f = seam.astype(np.float32)
            onset = (np.abs(prev - seam_f) < 8.0) \
                & (np.abs(route_full - seam_f) > 24.0)
            limited = np.clip(0.5 * route_full + 0.5 * prev,
                              prev - BG_ROUTE_STEP, prev + BG_ROUTE_STEP)
            route_full = np.where(onset, route_full, limited)
            route_full = np.maximum(route_full, seam_f)
        self.route_prev = route_full
        self.route_idx = frame_idx

        # ---- pp-2: HONEST POST-CORRECTION HARD-BREAK SWEEP. Everything above
        # decided route/apply/dissolve from the guard's own (under-reporting)
        # signals. Now measure the ACTUAL surviving handoff step on the
        # corrected composite across the full width; any rigid structure still
        # stepping > BG_HARD_CEIL (or source-cutting against open ring) is
        # folded into the symmetric dissolve — catching the undetected (f1356
        # canopy) and mis-measured (c2931 pole) breaks the interval path missed.
        # Cleanly-routed crests measure ~0 here and are left rigid (rule 1).
        sweep_mask, sweep_diag = self._hard_break_sweep(
            acc_sky, acc_ring, route_full, seam, frame_idx)
        # NB: routed columns are NOT excluded — the sweep measured the composite
        # WITH the route applied (provisional alpha), so a cleanly-routed crest
        # already reads < ceiling and is not flagged (stays crisp, rule 1); a
        # column that still breaks despite routing SHOULD dissolve.
        diag["sweep"] = sweep_diag
        n_sweep = int(sweep_mask.sum())
        diag["sweep_cols"] = n_sweep
        if n_sweep:
            self.stats["sweep_frames"] += 1
            self.stats["sweep_cols_total"] += n_sweep
        if sweep_diag.get("skipped_overflow"):
            self.stats["sweep_overflow_frames"] += 1

        # ---- r2-2: whole-interval SYMMETRIC DISSOLVE weight map. Per-column
        # weight w in [0,1]: at w=1 the column blends sky against ring at
        # 50/50 across the FULL overlap height (vertical tapers at the overlap
        # edges), so a misregistered crosser renders as a symmetric ghost
        # double — the pro anchor's concession class — instead of a step.
        # Temporal: onset jump (cover the step now), fast attack, slow release
        # (a 1-frame engage decays as a ~6-frame fade, no pop).
        wtgt = np.zeros(W, np.float32)
        for c0, c1 in dissolve_ivs:
            wtgt[np.arange(c0 - BG_DIS_PAD, c1 + BG_DIS_PAD + 1) % W] = 1.0
        # pp-2: sweep-flagged hard-break columns join the dissolve set (padded
        # by the narrower BG_SWEEP_DIS_PAD so the ghost has soft shoulders but
        # does not reach an adjacent crest). Horizontal max-dilation, wrap-aware.
        if n_sweep:
            k = 2 * BG_SWEEP_DIS_PAD + 1
            sm_w = sweep_mask.astype(np.float32)
            padd = BG_SWEEP_DIS_PAD + 1
            sm_w = np.concatenate([sm_w[-padd:], sm_w, sm_w[:padd]])
            dil = cv2.dilate(sm_w.reshape(1, -1),
                             np.ones((1, k), np.uint8)).ravel()[padd:-padd]
            wtgt = np.maximum(wtgt, dil)
        pad = 96
        ww = np.concatenate([wtgt[-pad:], wtgt, wtgt[:pad]])
        ww = cv2.GaussianBlur(ww.reshape(1, -1), (0, 0), BG_DIS_SIGMA).ravel()
        wtgt = np.clip(ww[pad:-pad].astype(np.float32), 0.0, 1.0)
        if self.dis_prev is not None and self._dis_idx == frame_idx - 1:
            w = np.clip(wtgt, self.dis_prev - BG_DIS_RELEASE,
                        self.dis_prev + BG_DIS_ATTACK)
            onset_d = (self.dis_prev < 0.05) & (wtgt > 0.5)
            w[onset_d] = np.maximum(w[onset_d], BG_DIS_ONSET * wtgt[onset_d])
        else:
            w = wtgt
        self.dis_prev = w
        self._dis_idx = frame_idx
        # pp-2: the dissolve influence mask for THIS frame — the metric uses it
        # to separate ghost/dissolve regions (soft doubles, EXPECTED, not a
        # hard-break FAIL) from rigid-structure hard breaks (FAIL > 4.5 px).
        diag["dissolve_w_cols"] = np.flatnonzero(w > 0.2).astype(np.int32)

        f0 = float(nine.EDGE_FEATHER)
        moved = (np.abs(route_full - seam) > 0.6) | (w > 0.01)
        alpha = self.nine.alpha
        if moved.any():
            cols = np.flatnonzero(moved)
            alpha = alpha.copy()
            rr = np.arange(nine.r0_9, nine.r1_9, dtype=np.float32)[:, None]
            ramp = np.clip((route_full[None, cols] - rr + f0) / (2 * f0), 0.0, 1.0)
            wc = w[cols][None, :]
            if (wc > 0.01).any():
                # symmetric-dissolve profile: 1 above the overlap, 0.5 across
                # it, 0 below the sky coverage; BG_DIS_VTAPER-row ramps at the
                # overlap edges (band-relative rows -> global via r0_9)
                rt = self.ov_top[cols][None, :] + float(nine.r0_9)
                rb = self.ov_bot[cols][None, :] + float(nine.r0_9)
                vt = float(BG_DIS_VTAPER)
                prof = np.clip(1.0 - 0.5 * np.clip((rr - rt) / vt, 0.0, 1.0)
                               - 0.5 * np.clip((rr - (rb - vt)) / vt, 0.0, 1.0),
                               0.0, 1.0)
                ramp = (1.0 - wc) * ramp + wc * prof
            a = np.where(self.sky_cov[:, cols], ramp, 0.0)
            nr = ~self.ring_cov9[:, cols]
            a[nr] = np.where(self.sky_cov[:, cols][nr], 1.0, 0.0)
            alpha[:, cols] = a.astype(np.float32)
            self.stats["routed_frames"] += 1
            diag["routed_cols_total"] = int(moved.sum())
            diag["dissolve_cols"] = int((w > 0.5).sum())

        # r2-2: stash the post-guard source lumas of the boundary band for
        # the composite-only-edge artifact inspector (comb teeth / hard
        # source-cuts score 0.0 in the silhouette scanner — r2-1 blocker 2).
        rlo, rhi = ART_ROWS
        rhi = min(rhi, sky_r1)
        ls_post = acc_sky[rlo:rhi].mean(axis=2)
        rrg = np.clip(np.arange(rlo, rhi) - r0, 0, lum_ring.shape[0] - 1)
        self.last_srcband = (ls_post, lum_ring[rrg], rlo, sky_ref)

        self.frames[frame_idx] = diag
        self.stats["guard_s"] += _time.perf_counter() - t0
        self.stats["frames"] += 1
        return acc_sky, alpha

    def report(self) -> dict:
        n = max(1, self.stats["frames"])
        shifts = [iv for d in self.frames.values() for iv in d["intervals"]]
        acc = [s for s in shifts if s["accepted"]]
        sil = [s for s in shifts if s.get("sil0") is not None]
        return {
            "routing": self.routing,
            "frames": self.stats["frames"],
            "shifts_applied": self.stats["shifts_applied"],
            "shifts_rejected_unverified": self.stats["shifts_rejected"],
            "routed_frames": self.stats["routed_frames"],
            "unverified_policy": {   # r2-2: symmetric dissolve, nothing else
                "dissolved": self.stats["dissolved"],
                "single_sourced": 0,   # around-route removed (f1356 cut class)
                "stale_held": 0,
            },
            "hard_break_sweep": {    # pp-2: honest post-correction dissolve
                "frames_with_sweep_dissolve": self.stats["sweep_frames"],
                "cols_dissolved_total": self.stats["sweep_cols_total"],
                "overflow_frames_skipped": self.stats["sweep_overflow_frames"],
            },
            "sil_gate": {
                "intervals_measurable": len(sil),
                "intervals_unmeasurable": len(shifts) - len(sil),
                "step_abs_before_median": round(float(np.median(
                    [abs(s["sil0"]) for s in sil])), 2) if sil else None,
                "step_abs_after_median": round(float(np.median(
                    [abs(s["sil_after"]) for s in sil])), 2) if sil else None,
                "step_abs_after_p95": round(float(np.percentile(
                    [abs(s["sil_after"]) for s in sil], 95)), 2) if sil else None,
                "sheared": sum(1 for s in sil if abs(s.get("s", 0.0)) >= BG_SHEAR_MIN),
            },
            "shift_abs_px": {
                "median_dx": round(float(np.median([abs(s["dx"]) for s in acc])), 2) if acc else 0.0,
                "max": round(max((abs(s["dx"]) + abs(s["dy"]) for s in acc), default=0.0), 2),
            },
            "guard_s_per_frame": round(self.stats["guard_s"] / n, 4),
        }


class RingSeamRouter:
    """r2-1 LEVER 3: ring-tier per-frame seam routing (residual class (c)).

    The six ring seams were FROZEN columns; protected structure crossing one
    got, at best, share-space commitment from the parallax corrector — the
    F-A @1576 sub-16 px ground-clutter jump class shipped every frame. This
    ports the sky boundary's structure-aware routing to the ring tier: per
    seam and per frame, a min-cost vertical seam PATH is chosen inside the
    calibrated overlap (deviation <= RT_MAX_DEV px), with protected structure
    horizontally dilated by the blend feather in the cost so the path clears
    it by a full feather width — the structure is then single-sourced from
    one camera. Temporal hysteresis (EMA + rate limit + onset exemption)
    keeps the path from popping. The re-weighting runs on the parallax
    corrector's MORPHED strips and preserves the pair's total blend share
    exactly (delta form), so pixels outside the strip and third-camera
    contributions are bit-identical.

    Verification: a routed path is accepted only if its mean cost is
    <= RT_ACCEPT_REL x the frozen column's (the frozen column is always in
    the DP search space, so routing can never be worse than frozen)."""

    def __init__(self, nine, corrector):
        if corrector is None:
            raise ValueError("RingSeamRouter needs the ParallaxCorrector "
                             "(it routes on the MORPHED strips)")
        self.nine = nine
        self.par = corrector
        corrector.keep_ring_morphed = True
        self.specs = [s for s in corrector.specs if s["kind"] == "ring"]
        self.geo: dict[str, dict] = {}
        for spec in self.specs:
            seam = next(s for s in nine.ring.seams
                        if f"ring:{s.pair[0]}-{s.pair[1]}" == spec["key"])
            width = spec["cols"].size
            center = width // 2
            base = seam.col_unwrapped - center
            lo = int(max(RT_EDGE_GUARD, seam.cand_lo - base, center - RT_MAX_DEV))
            hi = int(min(width - 1 - RT_EDGE_GUARD, seam.cand_hi - 1 - base,
                         center + RT_MAX_DEV))
            li, lj = spec["li"], spec["lj"]
            self.geo[spec["key"]] = {
                "center": center, "lo": lo, "hi": max(hi, lo + 8),
                "v_i": np.ascontiguousarray(nine.ring.maps[li][2][:, spec["cols"]]),
                "v_j": np.ascontiguousarray(nine.ring.maps[lj][2][:, spec["cols"]]),
            }
        self.paths: dict[str, dict] = {}
        self.stats = {"route_s": 0.0, "frames": 0}
        self.per_seam = {s["key"]: {"engaged": 0, "accepted": 0, "applied": 0,
                                    "dev_max": 0.0, "dev_mean_sum": 0.0}
                         for s in self.specs}

    def rewind_for_start(self) -> None:
        for st in self.paths.values():
            st["idx"] = -1

    @staticmethod
    def _dp_path(sub: np.ndarray) -> np.ndarray:
        """Min-cost top-to-bottom path (|dcol| <= 1/row). Returns col idx/row."""
        h, w = sub.shape
        dp = sub[0].astype(np.float64).copy()
        back = np.zeros((h, w), np.int8)
        big = 1e18
        for r in range(1, h):
            left = np.concatenate(([big], dp[:-1])) + RT_STEP_PEN
            right = np.concatenate((dp[1:], [big])) + RT_STEP_PEN
            stacked = np.stack((left, dp, right))
            ch = np.argmin(stacked, axis=0)
            back[r] = ch.astype(np.int8) - 1          # -1: from left, 0, +1
            dp = stacked[ch, np.arange(w)] + sub[r]
        path = np.empty(h, np.int32)
        path[-1] = int(np.argmin(dp))
        for r in range(h - 1, 0, -1):
            path[r - 1] = path[r] + back[r, path[r]]
        return path

    def route(self, acc_ring: np.ndarray, frame_idx: int) -> None:
        import time as _time
        t0 = _time.perf_counter()
        F = float(self.nine.ring.feather)
        kern = np.ones((1, int(2 * F) + 3), np.uint8)
        for spec in self.specs:
            key = spec["key"]
            st = self.par._state.get(key)
            morphed = self.par.ring_morphed.get(key)
            if st is None or st["idx"] != frame_idx or morphed is None:
                continue
            a_m, b_m = morphed
            geo = self.geo[key]
            center, lo, hi = geo["center"], geo["lo"], geo["hi"]
            lum_i = spec["gain_i"] * a_m.mean(axis=2)
            lum_j = spec["gain_j"] * b_m.mean(axis=2)
            valid = spec["valid"]
            h, width = lum_i.shape
            D = cv2.GaussianBlur(np.abs(lum_i - lum_j), (0, 0), RT_BLUR)
            prot = st.get("prot")
            if prot is None or not prot.any():
                protd = np.zeros_like(D)
            else:
                protd = cv2.dilate(prot.astype(np.float32), kern)
            cost = D * (1.0 + RT_PROT_K * protd) + RT_PROT_FLOOR * protd \
                + (~valid).astype(np.float32) * 1e3   # no-coverage: never route
            cross = protd[:, center - 2:center + 3].max(axis=1) > 0.5
            target = np.full(h, float(center), np.float32)
            sd = self.per_seam[key]
            if int(cross.sum()) >= RT_CROSS_ROWS:
                sd["engaged"] += 1
                sub = cost[:, lo:hi + 1]
                pidx = self._dp_path(sub)
                # acceptance judged on PAIR-COVERED rows only (rows outside
                # the overlap cost 1e3 on every path and would pin the ratio)
                rows_v = np.flatnonzero(valid[:, center])
                if rows_v.size >= 32:
                    cr = float(cost[rows_v, pidx[rows_v] + lo].mean())
                    cf = float(cost[rows_v, center].mean())
                    if cr <= RT_ACCEPT_REL * cf:
                        target = (pidx + lo).astype(np.float32)
                        sd["accepted"] += 1
            prev_st = self.paths.get(key)
            if prev_st is not None and prev_st["idx"] == frame_idx - 1:
                prev = prev_st["path"]
                onset = (np.abs(prev - center) < 4.0) \
                    & (np.abs(target - center) > RT_ONSET_DEV)
                limited = np.clip(RT_EMA_NEW * target + (1 - RT_EMA_NEW) * prev,
                                  prev - RT_STEP, prev + RT_STEP)
                path = np.where(onset, target, limited).astype(np.float32)
            else:
                path = target
            path = np.clip(path, float(lo), float(hi))
            self.paths[key] = {"idx": frame_idx, "path": path}
            dev = np.abs(path - center)
            if float(dev.max()) <= 0.75:
                continue                       # path == share ramp: delta 0
            sd["applied"] += 1
            sd["dev_max"] = max(sd["dev_max"], float(dev.max()))
            sd["dev_mean_sum"] += float(dev.mean())
            u = np.arange(width, dtype=np.float32)[None, :]
            t = np.clip((path[:, None] - u + F) / (2.0 * F), 0.0, 1.0)
            v_i, v_j = geo["v_i"], geo["v_j"]
            t = np.where(v_i & v_j, t, np.where(v_i, 1.0, 0.0)).astype(np.float32)
            bi, bj = spec["beta_i"], spec["beta_j"]
            s_pair = bi + bj
            t_base = np.where(s_pair > 1e-4, bi / np.maximum(s_pair, 1e-6), 0.0)
            m = ((np.abs(t - t_base) > 0.02) & (s_pair > 0.02)).astype(np.float32)
            m = cv2.GaussianBlur(m, (0, 0), 1.5)
            dsel = st.get("dsel")
            if dsel is None:
                dsel = 0.0
            # RE-MORPH with envelopes centered on the ROUTED path: the frozen-
            # seam morph bends each camera toward the other around the OLD
            # seam column; single-sourcing that strip still renders the old
            # midpoint's displacement (probe_fa2: F-A @1576 step survived
            # ownership commit). With envelopes from the routed t, content at
            # the old seam is the camera's own raw render and the morph
            # midpoint sits at the routed path — exactly the sky boundary's
            # "handoff moves, content follows" semantics.
            raw = self.par.ring_raw.get(key)
            if raw is None:
                continue
            a_r, b_r = raw
            gxy = geo.get("gxy")
            if gxy is None:
                gxy = np.meshgrid(np.arange(width, dtype=np.float32),
                                  np.arange(h, dtype=np.float32))
                geo["gxy"] = gxy
            gx, gy = gxy
            d_ij = st.get("d_ij")
            d_ji = st.get("d_ji")
            if d_ij is None or d_ji is None:
                continue
            a2 = cv2.remap(a_r, gx + (1.0 - t) * d_ji[0], gy + (1.0 - t) * d_ji[1],
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            b2 = cv2.remap(b_r, gx + t * d_ij[0], gy + t * d_ij[1],
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            # replace the pair's old contribution (frozen weights + dsel on
            # the frozen-morph strips) with the routed one, inside m only
            ci_new = (spec["P_i"] * s_pair * t * m).astype(np.float32)
            cj_new = (spec["P_j"] * s_pair * (1.0 - t) * m).astype(np.float32)
            ci_old = (spec["P_i"] * (bi + dsel) * m).astype(np.float32)
            cj_old = (spec["P_j"] * (bj - dsel) * m).astype(np.float32)
            acc_ring[:, spec["cols"]] += (
                ci_new[:, :, None] * a2 + cj_new[:, :, None] * b2
                - ci_old[:, :, None] * a_m - cj_old[:, :, None] * b_m)
        self.stats["route_s"] += _time.perf_counter() - t0
        self.stats["frames"] += 1

    def report(self) -> dict:
        n = max(1, self.stats["frames"])
        out = {"policy": "per-frame min-cost seam path in the calibrated "
                         "overlap; protected structure feather-dilated in the "
                         "cost (single-sourced); EMA+rate-limit hysteresis; "
                         "accepted only if path cost <= "
                         f"{RT_ACCEPT_REL} x frozen-col cost",
               "route_s_per_frame": round(self.stats["route_s"] / n, 4),
               "frames": self.stats["frames"], "per_seam": {}}
        for k, v in self.per_seam.items():
            out["per_seam"][k] = {
                "engaged_frames": v["engaged"],
                "accepted_frames": v["accepted"],
                "applied_frames": v["applied"],
                "dev_max_px": round(v["dev_max"], 1),
                "dev_mean_px": round(v["dev_mean_sum"] / max(1, v["applied"]), 2),
            }
        return out


def _grad_of(img: np.ndarray) -> np.ndarray:
    f = np.ascontiguousarray(img, dtype=np.float32)
    gx = cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.magnitude(gx, gy)


def _median_1d(v: np.ndarray, k: int) -> np.ndarray:
    half = k // 2
    pad = np.pad(v, half, mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(pad, k), axis=1).astype(v.dtype)


# --------------------------------------------------------------------- main

def iter_video_gray(path: str, stride: int = 1, w: int = 3840, h: int = 1183):
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo",
           "-pix_fmt", "gray", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=w * h * 4)
    i = 0
    try:
        while True:
            buf = p.stdout.read(w * h)
            if len(buf) < w * h:
                break
            if i % stride == 0:
                yield i, np.frombuffer(buf, np.uint8).reshape(h, w)
            i += 1
    finally:
        p.stdout.close()
        p.wait()


# ----------------------------------------------------- lexicographic metrics

def rank1_summary(recs_by_frame: dict[int, list[dict]]) -> dict:
    """RANK 1: structural integrity. Measured jump/offset records only (the
    autopsy caveat: chop records include physically-real tips -> visual
    review candidates, counted separately)."""
    hard, chops = [], []
    for f, recs in recs_by_frame.items():
        for r in recs:
            if r["disp_px"] is not None:
                hard.append(r)
            else:
                chops.append(r)
    over = [r for r in hard if r["disp_px"] >= DISP_BAR]
    frames_over = sorted({r["frame"] for r in over})
    disp = np.array([r["disp_px"] for r in over], np.float64)
    return {
        "bar_px": DISP_BAR,
        "frames_scanned": len(recs_by_frame),
        "frames_over_bar": len(frames_over),
        "frames_over_bar_list": frames_over,
        "records_over_bar": len(over),
        "disp_median": round(float(np.median(disp)), 2) if disp.size else 0.0,
        "disp_p90": round(float(np.percentile(disp, 90)), 2) if disp.size else 0.0,
        "disp_max": round(float(disp.max()), 2) if disp.size else 0.0,
        "worst10": [
            {k: r[k] for k in ("frame", "seam", "type", "col", "row", "disp_px")}
            for r in sorted(over, key=lambda r: -r["disp_px"])[:10]
        ],
        "chop_records_review": len(chops),
    }


def hardbreak_summary(recs_by_frame: dict[int, list[dict]],
                      dissolve_cols: dict[int, np.ndarray],
                      w: int = 3840) -> dict:
    """pp-2 / CONTEXT metric addition: a HARD-BREAK detector that separates
    RIGID structure (silhouette step > BG_HARD_CEIL = FAIL) from the ghost/
    dissolve regions (EXPECTED to show soft symmetric doubles — the pro
    anchor's near-field concession — which must NOT be scored as hard breaks).
    A boundary record is a ghost-dissolve (reported, not failed) if its column
    lies in the frame's dissolve influence mask; otherwise it is a rigid hard
    break. Targets: hard_breaks_over_ceiling = 0, max_hard_break_px <= 4.5."""
    # bnd_hard = sky-ring BOUNDARY rigid structure stepping > ceiling on a NON-
    # dissolved column (the pro-parity target). ghost = boundary breaks that fall
    # in a dissolve region (soft symmetric doubles — the pro concession, NOT a
    # FAIL). other = ring-tier / sky-sky seam breaks: SEPARATE families (chronic
    # class-(d) ground-clutter misregistration @ F-A c1576, sky-sky cable
    # parallax @ H-J) that the boundary guard never touches — reported, but not
    # the sky-ring hard-break bar.
    bnd_hard, ghost, other = [], [], []
    for f, recs in recs_by_frame.items():
        dc = dissolve_cols.get(f)
        if dc is not None and len(dc):
            m = np.zeros(w, bool)
            m[np.asarray(dc, np.int64) % w] = True
        else:
            m = None
        for r in recs:
            if r.get("disp_px") is None or r["disp_px"] < BG_HARD_CEIL:
                continue
            if r["seam"] != "boundary":
                other.append(r)
            elif m is not None and bool(m[int(r["col"]) % w]):
                ghost.append(r)
            else:
                bnd_hard.append(r)
    bnd_hard.sort(key=lambda r: -r["disp_px"])
    other.sort(key=lambda r: -r["disp_px"])
    hd = np.array([r["disp_px"] for r in bnd_hard], np.float64)
    gd = np.array([r["disp_px"] for r in ghost], np.float64)
    od = np.array([r["disp_px"] for r in other], np.float64)
    fam = collections.Counter(
        (r["seam"] if r["seam"] == "boundary"
         else "ring" if r["seam"].startswith("ring") else "sky-sky")
        for r in other)
    return {
        "ceiling_px": BG_HARD_CEIL,
        # THE pro-parity bar: sky-ring boundary rigid hard breaks (target 0)
        "boundary_hard_breaks_over_ceiling": len(bnd_hard),
        "boundary_frames_with_hard_break": len({r["frame"] for r in bnd_hard}),
        "boundary_max_hard_break_px": round(float(hd.max()), 2) if hd.size else 0.0,
        "boundary_hard_breaks_over_20px": int((hd > 20).sum()),
        "boundary_hard_by_type": dict(collections.Counter(
            r["type"] for r in bnd_hard)),
        "worst_boundary_hard_breaks": [
            {k: r[k] for k in ("frame", "seam", "type", "col", "row", "disp_px")}
            for r in bnd_hard[:12]
        ],
        # pro concession: boundary breaks converted to soft symmetric dissolves
        "ghost_dissolve_records": len(ghost),
        "ghost_dissolve_max_px": round(float(gd.max()), 2) if gd.size else 0.0,
        # separate families — NOT the sky-ring bar (pre-existing every round)
        "other_family_over_ceiling": len(other),
        "other_family_by_seam": dict(fam),
        "other_family_max_px": round(float(od.max()), 2) if od.size else 0.0,
        "worst_other_family": [
            {k: r[k] for k in ("frame", "seam", "type", "col", "row", "disp_px")}
            for r in other[:6]
        ],
        "note": ("boundary_hard_breaks = sky-ring rigid structure stepping > "
                 "ceiling on a NON-dissolved column (the pro-parity FAIL bar, "
                 "target 0); ghost_dissolve = soft symmetric doubles in the "
                 "dissolve regions (pro concession, not failed); other_family = "
                 "ring-tier + sky-sky seam residuals, a separate scope."),
    }


def rank2_stability(recs_by_frame: dict[int, list[dict]]) -> dict:
    """RANK 2: rolling misalignment — per-seam displacement stability over
    the inspected frame sequence (mean/p95 |delta| between consecutive
    inspected frames + per-seam std of the max measured disp)."""
    frames = sorted(recs_by_frame)
    series: dict[str, np.ndarray] = {}
    seams = sorted({r["seam"] for recs in recs_by_frame.values() for r in recs})
    per_seam = {}
    deltas_all = []
    for s in seams:
        v = np.array([
            max([r["disp_px"] for r in recs_by_frame[f]
                 if r["seam"] == s and r["disp_px"] is not None], default=0.0)
            for f in frames
        ])
        dv = np.abs(np.diff(v))
        deltas_all.append(dv)
        per_seam[s] = {
            "mean_disp": round(float(v.mean()), 3),
            "std_disp": round(float(v.std()), 3),
            "mean_abs_delta": round(float(dv.mean()), 3) if dv.size else 0.0,
            "p95_abs_delta": round(float(np.percentile(dv, 95)), 3) if dv.size else 0.0,
        }
        series[s] = v
    alld = np.concatenate(deltas_all) if deltas_all else np.zeros(1)
    if alld.size == 0:  # <2 comparable frames: no deltas measurable
        alld = np.zeros(1)
    return {
        "per_seam": per_seam,
        "mean_abs_delta_all": round(float(alld.mean()), 3),
        "p95_abs_delta_all": round(float(np.percentile(alld, 95)), 3),
        "max_seam_std": round(max((d["std_disp"] for d in per_seam.values()), default=0.0), 3),
    }


# ------------------------------------------------------- round-1 inspection

def _annot(img: np.ndarray, text: str) -> np.ndarray:
    out = img.copy()
    cv2.rectangle(out, (0, 0), (out.shape[1], 18), (0, 0, 0), -1)
    cv2.putText(out, text, (4, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                (255, 255, 255), 1, cv2.LINE_AA)
    return out


def _crop_wrap(band: np.ndarray, row_c: int, col_c: int, half_r: int,
               half_c: int) -> np.ndarray:
    h, w = band.shape[:2]
    r0 = max(0, min(h - 2 * half_r, row_c - half_r))
    cols = np.arange(col_c - half_c, col_c + half_c) % w
    return band[r0: r0 + 2 * half_r][:, cols]


def cmd_round(argv) -> int:
    """Structure-first round: compose inspection frames through the FULL
    corrected pipeline (protection + boundary guard + warm-up), judge every
    frame with the rank-1 detector, emit lexicographic metrics + glancing-
    inspection artifacts."""
    import time
    ap = argparse.ArgumentParser(prog="structure round")
    ap.add_argument("--drop", required=True)
    ap.add_argument("--pts", required=True)
    ap.add_argument("--offsets", required=True)
    ap.add_argument("--temporal", default="none")
    ap.add_argument("--out", required=True)
    ap.add_argument("--eq", type=int, nargs=2, default=[3840, 1920])
    ap.add_argument("--stride", type=int, default=12)
    ap.add_argument("--warmup", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="debug: first N inspect frames only")
    ap.add_argument("--extra-frames", type=int, nargs="*", default=[])
    ap.add_argument("--force-sites", nargs="*", default=[],
                    help="frame:col[:row] — forced consecutive-window sites "
                         "(r2-1: render the KNOWN worst sites regardless of "
                         "whether this round's records still flag them)")
    ap.add_argument("--qc-frames", type=int, nargs="*",
                    default=[135, 566, 1112, 1416, 1486, 1557])
    ap.add_argument("--baseline-scan", default="reports/clip04-sky/structure/structure_scan.json")
    ap.add_argument("--no-structure-first", dest="sf", action="store_false", default=True)
    ap.add_argument("--no-routing", dest="routing", action="store_false", default=True)
    ap.add_argument("--no-ghost", dest="ghost", action="store_false", default=True)
    args = ap.parse_args(argv)

    from types import SimpleNamespace
    from .parallax import GhostAccumulator, ParallaxCorrector, _build_pipeline
    from .ninestitch import _lin_luma

    out = Path(args.out)
    insp_dir = out / "inspection"
    insp_dir.mkdir(parents=True, exist_ok=True)
    t_start = time.perf_counter()

    # Round-4 durability: every official round before this one died silently
    # (0-byte buffered logs, no metrics). Capture the death point no matter
    # what kills us: faulthandler for hard crashes, watchdog tracebacks if we
    # wedge, per-frame flushed heartbeat + rolling checkpoint.json for SIGKILL.
    import faulthandler
    _fh_log = open(out / "faulthandler.log", "w")
    faulthandler.enable(file=_fh_log)
    faulthandler.dump_traceback_later(600, repeat=True, file=_fh_log)
    print(f"pid {os.getpid()} start {time.strftime('%H:%M:%S')}", flush=True)

    def _rss_mb() -> int:
        # ru_maxrss is bytes on macOS, KiB on Linux
        import resource
        v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(v / (1 << 20)) if sys.platform == "darwin" else int(v / 1024)

    def _checkpoint(stage: str, n_done: int, total: int, last_frame: int,
                    recs_by_frame: dict) -> None:
        (out / "checkpoint.json").write_text(json.dumps({
            "stage": stage, "frames_done": n_done, "frames_total": total,
            "last_frame": last_frame,
            "elapsed_s": round(time.perf_counter() - t_start, 1),
            "wall": time.strftime("%H:%M:%S"),
            "rss_mb": _rss_mb(),
            "rank1_partial": rank1_summary(recs_by_frame) if recs_by_frame else None,
        }, default=float))

    ns = SimpleNamespace(drop=args.drop, pts=args.pts, offsets=args.offsets,
                         temporal=args.temporal, eq=args.eq)
    clip, source, ring, nine, cal_idx, offsets, temporal_report = _build_pipeline(ns)

    corrector = ParallaxCorrector(nine, mode="flow+cdepth",
                                  structure_first=args.sf)
    nine.parallax = corrector
    guard = None
    if args.sf:
        guard = BoundaryGuard(nine, routing=args.routing)
        nine.structure_guard = guard
    router = None
    if args.sf and args.routing:
        router = RingSeamRouter(nine, corrector)   # r2-1 lever 3
        nine.ring_router = router
    print(f"structure-first={'ON' if args.sf else 'OFF'} "
          f"routing={'ON' if (args.sf and args.routing) else 'OFF'} "
          f"ring-routing={'ON' if router is not None else 'OFF'}", flush=True)

    # ---------------------------------------------------- frame warm-up
    t0 = time.perf_counter()
    _checkpoint("warmup", 0, args.warmup, -1, {})
    if args.warmup > 0:
        for i, frames in source.read_frames(range(args.warmup)):
            nine.compose_frame(frames, frame_idx=i)
            # round-5: checkpoint EVERY warmup frame — round 4 died in this
            # window (SIGKILL from the launching session exiting; frozen
            # checkpoint could not attribute the death) — and log RSS so an
            # OOM kill would be visible as growth here.
            _checkpoint("warmup", i + 1, args.warmup, i, {})
            print(f"hb warmup f{i} rss {_rss_mb()}MB", flush=True)
        corrector.rewind_for_start()
        if guard is not None:
            guard.rewind_for_start()
        if router is not None:
            router.rewind_for_start()
    t_warm = time.perf_counter() - t0
    print(f"warm-up pre-pass: {args.warmup} frames in {t_warm:.1f}s", flush=True)

    # ---------------------------------------------------- inspection pass
    usable = source.usable_frames
    inspect = sorted(set(range(0, usable, args.stride))
                     | {1, 2, 3, 4, 5, 6}
                     | set(f for f in args.extra_frames if f < usable))
    if args.limit:
        inspect = inspect[: args.limit]
    det = StructureDetector()
    recs_by_frame: dict[int, list[dict]] = {}
    cable: dict[int, dict] = {}
    sky_cols = [s["col"] for s in det.seams if s["kind"] == "sky"]
    seam_tiles: dict[str, list[np.ndarray]] = {s["id"]: [] for s in det.seams}
    bound_tiles: list[np.ndarray] = []
    flagged_paths: list[tuple[float, str]] = []
    t0 = time.perf_counter()
    t_compose = 0.0
    n_done = 0
    for i, frames in source.read_frames(inspect):
        tc = time.perf_counter()
        band = nine.compose_frame(frames, frame_idx=i)
        t_compose += time.perf_counter() - tc
        gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
        recs = det.analyze(gray, i)
        # r2-2: composite-only-edge artifact inspector (comb teeth / hard
        # source-cuts score 0.0 in the silhouette scanner — minted here so
        # the rank-1 bar cannot under-report the dissolve policy's failures)
        if guard is not None and guard.last_srcband is not None:
            ls_b, lr_b, rlo_b, sref_b = guard.last_srcband
            comp_b = _lin_luma(band[rlo_b - nine.r0_9:
                                    rlo_b - nine.r0_9 + ls_b.shape[0]])
            recs += stitch_artifact_records(comp_b, ls_b, lr_b, i, rlo_b, sref_b)
        recs_by_frame[i] = recs
        if i <= 24:
            cable[i] = cable_doubling_score(gray, sky_cols)
        # artifacts: strip tiles (every 4th inspected frame) + flagged crops
        if (n_done % 4) == 0:
            for s in det.seams:
                row_c = 645 if s["kind"] == "ring" else 300
                tile = _crop_wrap(band, row_c, s["col"], 170, 120)
                tile = cv2.resize(tile, (120, 170))
                seam_tiles[s["id"]].append(_annot(tile, f"f{i}"))
            strip = cv2.resize(band[470:700], (960, 58))
            bound_tiles.append(_annot(strip, f"f{i}"))
        hard = [r for r in recs if r["disp_px"] is not None and r["disp_px"] >= DISP_BAR]
        for r in sorted(hard, key=lambda r: -r["disp_px"])[:3]:
            crop = _crop_wrap(band, r["row"], r["col"], 150, 220)
            crop = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
            name = (f"flag_f{i:06d}_{r['seam'].replace(':', '')}"
                    f"_{r['type']}_{r['disp_px']:.1f}px_c{r['col']:04d}.png")
            cv2.imwrite(str(insp_dir / name),
                        _annot(crop, f"f{i} {r['seam']} {r['type']} {r['disp_px']:.1f}px"))
            flagged_paths.append((r["disp_px"], str(insp_dir / name)))
        n_done += 1
        mx = max([r["disp_px"] for r in hard], default=0.0)
        print(f"hb [{n_done}/{len(inspect)}] f{i}: {len(recs)} records, "
              f"max over-bar {mx:.2f}, {time.perf_counter() - t_start:.0f}s",
              flush=True)
        if n_done % 10 == 0 or n_done == len(inspect):
            _checkpoint("inspect", n_done, len(inspect), i, recs_by_frame)
    t_inspect = time.perf_counter() - t0
    _checkpoint("post-inspect", n_done, len(inspect), inspect[-1] if inspect else -1,
                recs_by_frame)

    # film strips
    for sid, tiles in seam_tiles.items():
        if tiles:
            cv2.imwrite(str(insp_dir / f"strip_{sid.replace(':', '')}.png"),
                        cv2.hconcat(tiles))
    if bound_tiles:
        cv2.imwrite(str(insp_dir / "strip_boundary.png"), cv2.vconcat(bound_tiles))

    # ---------------------------------------------------- lexicographic ranks
    r1 = rank1_summary(recs_by_frame)
    r2 = rank2_stability(recs_by_frame)
    # pp-2: honest hard-break metric — dissolve regions (soft doubles) are
    # separated from rigid-structure hard breaks (FAIL). Dissolve masks come
    # from the guard's per-frame diagnostics.
    dissolve_cols = {f: (guard.frames[f].get("dissolve_w_cols")
                         if guard is not None and f in guard.frames else None)
                     for f in recs_by_frame}
    r1_hard = hardbreak_summary(recs_by_frame, dissolve_cols, w=nine.eq_w)
    # persist the per-frame dissolve influence mask so the ghost/hard-break
    # split is auditable and reproducible offline (was in-memory only in the
    # first pp-2 pass)
    (out / "dissolve_masks.json").write_text(json.dumps(
        {str(f): (dc.tolist() if dc is not None else [])
         for f, dc in dissolve_cols.items()}, separators=(",", ":")))

    base = Path(args.baseline_scan)
    baseline = {}
    if base.exists():
        doc = json.loads(base.read_text())
        bframes = set(int(k) for k in doc["per_frame"]) & set(inspect)
        brecs: dict[int, list[dict]] = {f: [] for f in bframes}
        for r in doc["records"]:
            if r["frame"] in bframes:
                brecs[r["frame"]].append(r)
        ours_same = {f: recs_by_frame[f] for f in bframes}
        baseline = {
            "frames_compared": len(bframes),
            "rejected": {"rank1": rank1_summary(brecs), "rank2": rank2_stability(brecs)},
            "this_round_same_frames": {"rank1": rank1_summary(ours_same),
                                       "rank2": rank2_stability(ours_same)},
        }

    # ---------------------------------------------------- rank 3: ghost energy
    ghost = None
    if args.ghost and args.qc_frames:
        print("stage: ghost pass", flush=True)
        _checkpoint("ghost", n_done, len(inspect), -1, recs_by_frame)
        t0 = time.perf_counter()
        gb, ga = GhostAccumulator(nine), GhostAccumulator(nine)
        for i, frames in source.read_frames(sorted(set(args.qc_frames))):
            ring_lums = {}
            for l in ring.order:
                mx, my, _ = ring.maps[l]
                ring_lums[l] = _lin_luma(cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR,
                                                   borderMode=cv2.BORDER_CONSTANT))
            sky_lums = nine._warp_sky_luma(frames)
            ring_comp = np.zeros((ring.band_h, nine.eq_w), np.float32)
            for l in ring.order:
                ring_comp += ring_lums[l] * ring._weights[l]
            gb.add_frame(i, ring_lums, sky_lums, ring_comp)
            ring_c, sky_c = corrector.correct_lums(ring_lums, sky_lums, i)
            ring_comp_c = np.zeros((ring.band_h, nine.eq_w), np.float32)
            for l in ring.order:
                ring_comp_c += ring_c[l] * ring._weights[l]
            ga.add_frame(i, ring_c, sky_c, ring_comp_c)
        ghost = {"before": gb.results()["per_family"],
                 "after": ga.results()["per_family"],
                 "qc_frames": sorted(set(args.qc_frames)),
                 "ghost_pass_s": round(time.perf_counter() - t0, 1),
                 "note": "rank 3 — LOWEST priority; regressions acceptable if rank 1-2 improve"}

    # ------------------------------------------- consecutive glancing runs
    # (round-1 judge ask: strided strips could not verify routing pop —
    # render TRUE consecutive frame runs at the worst + routed sites)
    consec = None
    if not args.limit:
        print("stage: consecutive runs", flush=True)
        _checkpoint("consecutive", n_done, len(inspect), -1, recs_by_frame)
        t0 = time.perf_counter()
        allr = [r for recs in recs_by_frame.values() for r in recs
                if r.get("disp_px") is not None and r["disp_px"] >= DISP_BAR]
        allr.sort(key=lambda r: -r["disp_px"])
        sites = []
        for fs in args.force_sites:      # r2-1: known worst sites, always
            parts = fs.split(":")
            sites.append({"frame": int(parts[0]), "col": int(parts[1]),
                          "row": int(parts[2]) if len(parts) > 2 else 565,
                          "why": f"forced {fs}"})
        n_forced = len(sites)
        for r in allr:
            if len(sites) >= n_forced + 4:
                break
            if all(abs(r["frame"] - s["frame"]) > 24 or abs(r["col"] - s["col"]) > 300
                   for s in sites):
                sites.append({"frame": int(r["frame"]), "col": int(r["col"]),
                              "why": f"worst {r['seam']} {r['disp_px']:.1f}px"})
        if guard is not None:
            routed_frames = [f for f, dg in sorted(guard.frames.items())
                             if dg.get("routed_cols_total", 0) > 0]
            step = max(1, len(routed_frames) // 2)
            for f in routed_frames[::step][:2]:
                ivs = [iv for iv in guard.frames[f]["intervals"]
                       if iv.get("routed_cols", 0) > 0]
                if not ivs:
                    continue
                iv = max(ivs, key=lambda iv: iv["routed_cols"])
                c = (iv["cols"][0] + iv["cols"][1]) // 2
                if all(abs(f - s["frame"]) > 24 or abs(c - s["col"]) > 300
                       for s in sites):
                    sites.append({"frame": int(f), "col": int(c), "why": "routed"})
        wins = []
        for s in sorted(sites, key=lambda s: s["frame"]):
            w0, w1 = max(0, s["frame"] - 8), min(usable - 1, s["frame"] + 8)
            if wins and w0 <= wins[-1]["w1"] + 1:
                wins[-1]["w1"] = max(wins[-1]["w1"], w1)
                wins[-1]["sites"].append(s)
            else:
                wins.append({"w0": w0, "w1": w1, "sites": [s]})
        consec = {"sites": sites, "windows": [], "note":
                  "sequential composes: EMA/hold/route hysteresis engaged, "
                  "unlike the strided pass; strips are FULL RES, every frame"}
        for wjob in wins:
            tiles = {k: [] for k in range(len(wjob["sites"]))}
            series = {k: [] for k in range(len(wjob["sites"]))}
            for i, frames in source.read_frames(range(wjob["w0"], wjob["w1"] + 1)):
                band = nine.compose_frame(frames, frame_idx=i)
                gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
                recs = det.analyze(gray, i)
                if guard is not None and guard.last_srcband is not None:
                    ls_b, lr_b, rlo_b, sref_b = guard.last_srcband
                    comp_b = _lin_luma(band[rlo_b - nine.r0_9:
                                            rlo_b - nine.r0_9 + ls_b.shape[0]])
                    recs += stitch_artifact_records(comp_b, ls_b, lr_b, i,
                                                    rlo_b, sref_b)
                for k, s in enumerate(wjob["sites"]):
                    near = [r["disp_px"] for r in recs
                            if r.get("disp_px") is not None
                            and abs(r["col"] - s["col"]) <= 220]
                    series[k].append(round(max(near), 2) if near else 0.0)
                    tile = _crop_wrap(band, s.get("row", 565), s["col"], 130, 150)
                    tiles[k].append(_annot(tile, f"f{i}"))
            for k, s in enumerate(wjob["sites"]):
                name = f"strip_consec_c{s['col']:04d}_f{wjob['w0']:06d}-{wjob['w1']:06d}.png"
                cv2.imwrite(str(insp_dir / name), cv2.hconcat(tiles[k]))
                consec["windows"].append({
                    "frames": [wjob["w0"], wjob["w1"]], "col": s["col"],
                    "why": s["why"], "strip": str(insp_dir / name),
                    "max_disp_per_frame": series[k]})
        consec["consec_pass_s"] = round(time.perf_counter() - t0, 1)
        print(f"consecutive runs: {len(wins)} windows, "
              f"{sum(w['w1'] - w['w0'] + 1 for w in wins)} frames, "
              f"{consec['consec_pass_s']}s")

    # ---------------------------------------------------- inspection verdicts
    flagged = sorted(r1["frames_over_bar_list"])
    clean = [f for f in inspect if f not in set(flagged)]
    flagged_paths.sort(reverse=True)
    worst_stills = [p for _, p in flagged_paths[:12]]

    summary = {
        "purpose": "structure-first round r2-2 — sweep-class fix on r2-1: "
                   "(1) unverifiable crossing intervals get a WHOLE-INTERVAL "
                   "symmetric 50/50 dissolve across the full overlap height "
                   "(pro concession class); the r2-1 around-route (taper cut "
                   "through wide structure: f1356) and feather-widening "
                   "(comb-teeth: c3439) fallbacks are removed; (2) verified "
                   "means VERIFIED: a winner may leave at most 4 px standing "
                   "(r2-1 accepted 40->27 px 'improvements'), the e0<=0.02 "
                   "aligned-shortcut no longer outranks a measured silhouette "
                   "step (motion blur made it lie: c3324 f127 sil0 -46 with "
                   "'clean' e0), and verification outranks EMA hysteresis on "
                   "fast sweeps; (3) artifact inspector: composite-only-edge "
                   "records (comb / hard source-cuts scored 0.0 in r2-1) now "
                   "count against the rank-1 bar",
        "argv": sys.argv,
        "structure_first": args.sf,
        "routing": bool(args.sf and args.routing),
        "warmup_frames": args.warmup,
        "temporal": temporal_report,
        "inspected_frames": inspect,
        "rank1": r1,
        "rank1_hardbreak": r1_hard,
        "rank2": r2,
        "rank3_ghost": ghost,
        "baseline_comparison_same_frames": baseline,
        "consecutive": consec,
        "cable_doubling_first_frames": cable,
        "guard": guard.report() if guard is not None else None,
        "ring_router": router.report() if router is not None else None,
        "parallax_cost": corrector.cost(),
        "protection": corrector.protection_report() if hasattr(corrector, "protection_report") else None,
        "inspection": {
            "frames_inspected": len(inspect),
            "frames_clean": len(clean),
            "frames_flagged": len(flagged),
            "flagged_frames": flagged,
            "worst_stills": worst_stills,
            "film_strips": sorted(str(p) for p in insp_dir.glob("strip_*.png")),
        },
        "timings": {
            "warmup_s": round(t_warm, 1),
            "inspect_pass_s": round(t_inspect, 1),
            "compose_s_per_frame": round(t_compose / max(1, len(inspect)), 3),
            "total_s": round(time.perf_counter() - t_start, 1),
        },
    }
    # raw records: next round's apples-to-apples baseline (this round had to
    # bucket against the rejected scan's records; do not lose our own)
    (out / "records.json").write_text(json.dumps(
        {str(f): recs for f, recs in sorted(recs_by_frame.items())}, indent=0))
    # metrics.json is the canonical name (round-1 judge could not find it);
    # <outdir>_summary.json kept as an alias for continuity with round 1
    blob = json.dumps(summary, indent=1, default=float)
    (out / "metrics.json").write_text(blob)
    (out / f"{out.name}_summary.json").write_text(blob)
    print(f"wrote {out / 'metrics.json'} (+ {out.name}_summary.json alias)", flush=True)
    _checkpoint("done", n_done, len(inspect), -1, recs_by_frame)
    faulthandler.cancel_dump_traceback_later()
    print(f"RANK1: {r1['frames_over_bar']}/{r1['frames_scanned']} frames over bar, "
          f"{r1['records_over_bar']} records, max {r1['disp_max']} px")
    print(f"RANK2: mean|d| {r2['mean_abs_delta_all']} p95|d| {r2['p95_abs_delta_all']}")
    if ghost:
        for fam in ghost["after"]:
            print(f"RANK3 ghost {fam}: {ghost['before'][fam]['mean_ghost_energy']:.5f} -> "
                  f"{ghost['after'][fam]['mean_ghost_energy']:.5f}")
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "round":
        return cmd_round(argv[1:])
    return _main_scan(argv)


def _main_scan(argv=None):
    ap = argparse.ArgumentParser(description="rank-1 structure autopsy scan")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True, help="output dir (report JSON)")
    ap.add_argument("--stride", type=int, default=6)
    ap.add_argument("--size", type=int, nargs=2, default=[3840, 1183])
    args = ap.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    det = StructureDetector()
    all_recs, per_frame = [], {}
    sky_cols = [s["col"] for s in det.seams if s["kind"] == "sky"]
    cable = {}
    for i, gray in iter_video_gray(args.video, args.stride, *args.size):
        recs = det.analyze(gray, i)
        all_recs += recs
        disp = [r["disp_px"] for r in recs if r["disp_px"] is not None]
        chops = [r for r in recs if r["disp_px"] is None]
        per_frame[i] = {"max_disp": max(disp) if disp else 0.0,
                        "n_records": len(recs), "n_chop_flat": len(chops)}
        if i <= 30:
            cable[i] = cable_doubling_score(gray, sky_cols)
        if (i // args.stride) % 25 == 0:
            print(f"frame {i}: {len(recs)} records, max_disp "
                  f"{per_frame[i]['max_disp']:.2f}", flush=True)
    report = {
        "video": args.video, "stride": args.stride, "bar_px": DISP_BAR,
        "frames_scanned": len(per_frame),
        "frames_over_bar": sum(1 for v in per_frame.values() if v["max_disp"] >= DISP_BAR),
        "per_frame": per_frame,
        "records": all_recs,
        "cable_doubling_first_frames": cable,
    }
    (out / "structure_scan.json").write_text(json.dumps(report, indent=1))
    print(f"scanned {len(per_frame)} frames; "
          f"{report['frames_over_bar']} over the {DISP_BAR} px bar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
