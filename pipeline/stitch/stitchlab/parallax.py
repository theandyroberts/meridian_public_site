"""Parallax-phase tooling: the GHOST-ENERGY metric and its baseline run.

Ghost energy is the number that tracks Andy's double-exposure complaint
directly: the residual |linear diff| between the two sources of every seam,
measured ONLY inside the frozen blend band (pixels a viewer actually sees
mixed), weighted by local structure (Sobel gradient magnitude of the sources).
Flat-sky photometric mismatch has tiny gradient -> tiny weight; a ghosted
wire/arch/tower puts large residual exactly where the gradient is large, so
the metric scores what the eye sees. Reported per seam, symmetric across the
three seam families (ring, sky-sky, sky-ring), same methodology every round.

Per seam we report:
  * ghost_energy          = sum(d*w) / sum(w)   -- mean residual ON structure
  * ghost_energy_density  = sum(d*w) / n_band   -- total ghosting per band px
                            (use this to compare rounds: it falls when either
                            the residual or the amount of ghosted edge falls)
  * mad                   = sum(d) / n_band     -- continuity w/ QcAccumulator
  * p95_abs_diff          -- tail of the band residual
where d = |g_i L_i - g_j L_j| (linear luma, gains applied, same photometric
path as QcAccumulator) and w = max(|grad L_i|, |grad L_j|) per pixel.

The per-frame profiles along each seam axis (rows for the vertical ring /
sky-sky seams, owned columns for the sky-ring band) are kept so that
  * target sites can be scored through a fixed window, and
  * the worst-ghost sites of the run are FOUND by the metric (windowed
    ghost energy, ranked by windowed energy sum), giving each round the same
    artifact set plus the two worst offenders it discovered itself.

This module implements the BEFORE number (no parallax correction). The
flow-morph / constant-depth correctors of later rounds are measured with the
same accumulator so before/after is apples-to-apples.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from .clip import RingClip
from .ninestitch import (
    QC_BLEND_W_MIN,
    SKY,
    NineStitcher,
    _lin_luma,
    _phase_correlate,
    _render_temporal_qc,
    _spread_indices,
    _tool_versions,
)
from .ringstitch import RingStitcher

#: +-px around the frozen seam sampled for ghost energy. Wider than the MAD
#: strip (12): known ghost displacements reach ~50 px (G-H wires), so the
#: doubled edge can sit up to ~25 px off the seam column. The blend-band mask
#: still confines scoring to genuinely mixed pixels.
GHOST_STRIP_HALF = 32
#: Half-extent (px along the seam axis) of a ghost "site" window.
GHOST_SITE_HALF = 48
#: Minimum separation (px along the seam axis) between reported worst sites,
#: and the exclusion radius around the two known target sites.
GHOST_MIN_SEP = 128
_EPS = 1e-9


def _grad_mag(img: np.ndarray) -> np.ndarray:
    """Sobel gradient magnitude (float32 in, float32 out)."""
    f = np.ascontiguousarray(img, dtype=np.float32)
    gx = cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.magnitude(gx, gy)


class GhostAccumulator:
    """Per-seam ghost-energy accumulator over QC frames.

    Mirrors QcAccumulator's frozen-band geometry exactly (same masks, same
    gains, same linear-luma path) so its numbers live in the same photometric
    space as the round's MAD metrics; adds the structure weighting and the
    per-frame axis profiles.
    """

    def __init__(self, nine: NineStitcher):
        self.nine = nine
        self.ring = nine.ring
        w = nine.eq_w
        self.entries: list[dict] = []

        # ring seams: vertical, axis = band row
        for s in self.ring.seams:
            strip = np.arange(s.col_unwrapped - GHOST_STRIP_HALF, s.col_unwrapped + GHOST_STRIP_HALF + 1) % w
            li, lj = s.pair
            mask = (
                (self.ring._weights[li][:, strip] > QC_BLEND_W_MIN)
                & (self.ring._weights[lj][:, strip] > QC_BLEND_W_MIN)
            )
            self.entries.append({
                "family": "ring", "name": f"{li}-{lj}", "seam_col": int(s.col),
                "axis": "row", "row0_global": self.ring.r0,
                "strip": strip, "mask": mask, "li": li, "lj": lj,
                "frames": {},  # frame idx -> stats + profiles
            })

        # sky-sky seams: vertical, axis = row below the polar cap
        cap = nine.row_cap
        for s in nine.sky_seams:
            strip = np.arange(s.col_unwrapped - GHOST_STRIP_HALF, s.col_unwrapped + GHOST_STRIP_HALF + 1) % w
            li, lj = s.pair
            mask = (
                (nine._sky_weights[li][cap:, strip] > QC_BLEND_W_MIN * nine.sky_gains[li])
                & (nine._sky_weights[lj][cap:, strip] > QC_BLEND_W_MIN * nine.sky_gains[lj])
            )
            self.entries.append({
                "family": "sky_sky", "name": f"{li}-{lj}", "seam_col": int(s.col),
                "axis": "row", "row0_global": cap,
                "strip": strip, "mask": mask, "li": li, "lj": lj,
                "frames": {},
            })

        # sky-ring bands: horizontal-ish, axis = owned column
        r0, sr1 = self.ring.r0, nine.sky_r1
        offs = np.arange(-GHOST_STRIP_HALF, GHOST_STRIP_HALF + 1)
        for l in SKY:
            owned = np.where(nine.sky_colw[l] > 0.5)[0]
            rows_mat = nine.seam_row[owned][None, :] + offs[:, None]
            in_range = (rows_mat >= r0) & (rows_mat < sr1)
            rows_cl = np.clip(rows_mat, r0, sr1 - 1)
            a = nine.alpha[rows_cl - nine.r0_9, owned[None, :]]
            mask = (
                in_range
                & nine.sky_maps[l][2][rows_cl, owned[None, :]]
                & nine.ring_cov[rows_cl - r0, owned[None, :]]
                & (a > QC_BLEND_W_MIN) & (a < 1.0 - QC_BLEND_W_MIN)
            )
            self.entries.append({
                "family": "sky_ring", "name": l, "axis": "col",
                "owned": owned, "rows_mat": rows_cl, "mask": mask,
                "frames": {},
            })

    # ------------------------------------------------------------- per frame

    def add_frame(self, idx: int, ring_lums: dict, sky_lums: dict, ring_comp: np.ndarray) -> None:
        nine, ring = self.nine, self.ring
        cap, r0 = nine.row_cap, ring.r0
        for e in self.entries:
            if e["family"] == "ring":
                gi, gj = ring.gains[e["li"]], ring.gains[e["lj"]]
                a = gi * ring_lums[e["li"]][:, e["strip"]]
                b = gj * ring_lums[e["lj"]][:, e["strip"]]
            elif e["family"] == "sky_sky":
                gi, gj = nine.sky_gains[e["li"]], nine.sky_gains[e["lj"]]
                a = gi * sky_lums[e["li"]][cap:, e["strip"]]
                b = gj * sky_lums[e["lj"]][cap:, e["strip"]]
            else:  # sky_ring: ring composite vs gained sky
                g = nine.sky_gains[e["name"]]
                a = ring_comp[e["rows_mat"] - r0, e["owned"][None, :]]
                b = g * sky_lums[e["name"]][e["rows_mat"], e["owned"][None, :]]

            m = e["mask"]
            d = np.abs(a - b)
            wgt = np.maximum(_grad_mag(a), _grad_mag(b))
            dw = (d * wgt * m).astype(np.float64)
            wm = (wgt * m).astype(np.float64)
            n_band = int(m.sum())
            band_d = d[m]
            ax = 1 if e["axis"] == "row" else 0
            e["frames"][idx] = {
                "sum_dw": float(dw.sum()),
                "sum_w": float(wm.sum()),
                "sum_d": float(band_d.sum()),
                "n_band": n_band,
                "p95": float(np.percentile(band_d, 95)) if n_band else 0.0,
                # axis profiles (energy + weight), for windows & site finding
                "e_prof": dw.sum(axis=ax),
                "w_prof": wm.sum(axis=ax),
            }

    # -------------------------------------------------------------- windows

    @staticmethod
    def _windowed(prof: np.ndarray, half: int = GHOST_SITE_HALF) -> np.ndarray:
        k = np.ones(2 * half + 1)
        return np.convolve(prof, k, mode="same")

    def window_stats(self, e: dict, frame: int, pos: int, half: int = GHOST_SITE_HALF) -> dict:
        """Ghost stats through a window centered at `pos` on the seam axis
        (band row for vertical seams, owned-column INDEX for sky-ring)."""
        fr = e["frames"][frame]
        lo, hi = max(0, pos - half), min(fr["e_prof"].size, pos + half + 1)
        e_sum = float(fr["e_prof"][lo:hi].sum())
        w_sum = float(fr["w_prof"][lo:hi].sum())
        return {
            "frame": frame,
            "window_px_along_axis": [int(lo), int(hi)],
            "ghost_energy": e_sum / (w_sum + _EPS),
            "ghost_energy_sum": e_sum,
            "structure_weight_sum": w_sum,
        }

    def site_coords(self, e: dict, pos: int) -> dict:
        """Panorama coordinates (col, band row rel. r0_9) of an axis position."""
        nine = self.nine
        if e["axis"] == "row":
            return {
                "col": int(e["seam_col"]),
                "row_band": int(e["row0_global"] + pos - nine.r0_9),
            }
        col = int(e["owned"][pos])
        return {"col": col, "row_band": int(nine.seam_row[col] - nine.r0_9)}

    def peak_pos(self, e: dict, frame: int) -> int:
        """Axis position with the largest windowed ghost-energy sum."""
        return int(np.argmax(self._windowed(e["frames"][frame]["e_prof"])))

    def worst_sites(self, n: int, exclude: list[dict]) -> list[dict]:
        """Top-n (seam, frame, pos) sites by windowed ghost-energy SUM, with
        min-separation dedupe along each seam and exclusion of the known
        target sites (any frame, same seam, within GHOST_MIN_SEP)."""
        cands = []
        for k, e in enumerate(self.entries):
            for f, fr in e["frames"].items():
                ew = self._windowed(fr["e_prof"])
                order = np.argsort(ew)[::-1][:64]
                kept = []
                for pos in order:
                    if all(abs(int(pos) - p) >= GHOST_MIN_SEP for p in kept):
                        kept.append(int(pos))
                    if len(kept) >= 4:
                        break
                for pos in kept:
                    cands.append((float(ew[pos]), k, f, pos))
        cands.sort(reverse=True)

        def blocked(k, pos):
            for x in exclude + picked:
                if x["entry_k"] == k and abs(x["pos"] - pos) < GHOST_MIN_SEP:
                    return True
            return False

        picked: list[dict] = []
        for score, k, f, pos in cands:
            if blocked(k, pos):
                continue
            e = self.entries[k]
            picked.append({
                "entry_k": k, "family": e["family"], "seam": e["name"],
                "frame": int(f), "pos": int(pos),
                **self.site_coords(e, pos),
                **{kk: vv for kk, vv in self.window_stats(e, f, pos).items() if kk != "frame"},
            })
            if len(picked) >= n:
                break
        return picked

    # -------------------------------------------------------------- results

    def results(self) -> dict:
        fams: dict[str, list] = {"ring": [], "sky_ring": [], "sky_sky": []}
        for e in self.entries:
            frames = e["frames"]
            n = max(len(frames), 1)
            sum_dw = sum(f["sum_dw"] for f in frames.values())
            sum_w = sum(f["sum_w"] for f in frames.values())
            sum_d = sum(f["sum_d"] for f in frames.values())
            n_band = sum(f["n_band"] for f in frames.values())
            worst_f = max(frames, key=lambda i: frames[i]["sum_dw"] / (frames[i]["sum_w"] + _EPS)) if frames else None
            rec = {
                "family": e["family"],
                "seam": e["name"],
                "ghost_energy": sum_dw / (sum_w + _EPS),
                "ghost_energy_density": sum_dw / max(n_band, 1),
                "mad": sum_d / max(n_band, 1),
                # Metrics-rework: band MAD normalized by the band's own local
                # edge sharpness (mean structure weight) — scores alignment,
                # not ring-first's intrinsic tile-top softness (probe_mad_decomp).
                "mad_per_unit_structure": sum_d / (sum_w + _EPS),
                "p95_abs_diff_mean": float(np.mean([f["p95"] for f in frames.values()])) if frames else 0.0,
                "blend_band_px_per_frame": n_band // n,
                "worst_frame": None if worst_f is None else {
                    "frame": int(worst_f),
                    "ghost_energy": frames[worst_f]["sum_dw"] / (frames[worst_f]["sum_w"] + _EPS),
                },
            }
            if e["family"] == "sky_ring":
                rec["cam"] = e["name"]
            else:
                rec["seam_col"] = e["seam_col"]
            fams[e["family"]].append(rec)

        def fam_stats(rows):
            return {
                "n_seams": len(rows),
                "mean_ghost_energy": float(np.mean([r["ghost_energy"] for r in rows])),
                "max_ghost_energy": float(np.max([r["ghost_energy"] for r in rows])),
                "mean_ghost_energy_density": float(np.mean([r["ghost_energy_density"] for r in rows])),
            }

        return {
            "families": fams,
            "per_family": {k: fam_stats(v) for k, v in fams.items()},
            "params": {
                "strip_half_px": GHOST_STRIP_HALF,
                "site_window_half_px": GHOST_SITE_HALF,
                "min_site_separation_px": GHOST_MIN_SEP,
                "blend_band_weight_min": QC_BLEND_W_MIN,
                "structure_weight": "max Sobel |grad| of the two gain-applied linear-luma sources",
                "definition": "ghost_energy = sum(|diff|*w)/sum(w); density = sum(|diff|*w)/n_band_px",
            },
        }


# ------------------------------------------------------------------ pipeline


def _build_pipeline(args):
    """stitch9's exact setup path, offsets passed verbatim, no refine/polish:
    the ghost baseline must measure the SAME frozen geometry as retry5-verify."""
    clip = RingClip(Path(args.drop), letters="ABCDEFGHJ")
    tpath = getattr(args, "temporal", None)
    source, temporal_report = clip, None
    if tpath and str(tpath).lower() != "none":
        from .temporal import TemporalResampler, load_temporal_offsets

        source = TemporalResampler(clip, load_temporal_offsets(tpath))
        temporal_report = {"offsets_file": str(Path(tpath).resolve()), **source.report()}
        print(f"temporal correction ON ({tpath})")
    else:
        print("temporal correction OFF")

    eq_w, eq_h = args.eq
    ring = RingStitcher(args.pts, eq_w=eq_w, eq_h=eq_h, src_w=clip.width, src_h=clip.height)
    cal_idx = _spread_indices(source.usable_frames, 6)
    cal_frames = [frames for _, frames in source.read_frames(cal_idx)]
    ring.calibrate(zip(cal_idx, cal_frames))

    doc = json.loads(Path(args.offsets).read_text())
    if "cams" in doc:
        offsets = {l: doc["cams"][l]["offsets_deg"] for l in SKY}
    else:
        offsets = {l: doc[l] for l in SKY}
    nine = NineStitcher(ring, offsets)
    nine.calibrate(cal_frames)
    del cal_frames
    return clip, source, ring, nine, cal_idx, offsets, temporal_report


def cmd_ghost_baseline(args) -> int:
    t_start = time.perf_counter()
    out_dir = Path(args.out)
    samples_dir = out_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    clip, source, ring, nine, cal_idx, offsets, temporal_report = _build_pipeline(args)

    # QC frames: reuse the verified baseline run's exact QC set (comparability
    # with its MAD/phase numbers) plus the explicitly-requested target frames.
    qc_idx = list(args.frames or [])
    if args.qc_from:
        qc_idx += json.loads(Path(args.qc_from).read_text())["qc_frame_indices"]
    qc_idx = sorted(set(int(i) for i in qc_idx))
    if not qc_idx:
        raise SystemExit("no QC frames: pass --qc-from and/or --frames")

    ghost = GhostAccumulator(nine)
    t0 = time.perf_counter()
    for i, frames in source.read_frames(qc_idx):
        ring_lums = {}
        for l in ring.order:
            mx, my, _ = ring.maps[l]
            ring_lums[l] = _lin_luma(cv2.remap(frames[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT))
        sky_lums = nine._warp_sky_luma(frames)
        ring_comp = np.zeros((ring.band_h, nine.eq_w), np.float32)
        for l in ring.order:
            ring_comp += ring_lums[l] * ring._weights[l]
        ghost.add_frame(i, ring_lums, sky_lums, ring_comp)
        print(f"ghost pass frame {i}")
    t_ghost = time.perf_counter() - t0

    res = ghost.results()

    # ------------------------------------------------------- target sites
    by_key = {(e["family"], e["name"]): (k, e) for k, e in enumerate(ghost.entries)}
    targets = []
    for spec in json.loads(args.targets):
        k, e = by_key[(spec["family"], spec["seam"])]
        f = int(spec["frame"])
        pos = ghost.peak_pos(e, f)  # metric-found peak at the target frame
        targets.append({
            "label": spec["label"], "entry_k": k, "family": e["family"], "seam": e["name"],
            "frame": f, "pos": pos, **ghost.site_coords(e, pos),
            **{kk: vv for kk, vv in ghost.window_stats(e, f, pos).items() if kk != "frame"},
        })

    worst = ghost.worst_sites(2, exclude=targets)
    res["target_sites"] = [{k: v for k, v in t.items() if k not in ("entry_k", "pos")} for t in targets]
    res["worst_ghost_sites"] = [{k: v for k, v in s.items() if k not in ("entry_k", "pos")} for s in worst]

    # ------------------------------------------------- film strips + videos
    outputs = []
    if args.filmstrips:
        sites = []
        for t in targets:
            sites.append({
                "kind": f"target_{t['family']}",
                "frame": t["frame"], "col": t["col"], "row_band": t["row_band"],
                "label": t["label"],
            })
        for r, s in enumerate(worst, 1):
            sites.append({
                "kind": f"worstghost_{s['family']}",
                "frame": s["frame"], "col": s["col"], "row_band": s["row_band"],
                "label": f"ghost{r}_{s['family']}_{s['seam'].replace('-', '')}_f{s['frame']:06d}_c{s['col']:04d}",
            })
        t0 = time.perf_counter()
        outputs += _render_temporal_qc(source, nine, sites, samples_dir, clip.fps)
        res["qc_sites"] = [{k: v for k, v in s.items() if k != "strip_frames"} for s in sites]
        print(f"film strips rendered in {time.perf_counter() - t0:.0f}s")

    doc = {
        "purpose": "parallax-phase GHOST-ENERGY baseline (before any correction)",
        "drop": str(Path(args.drop).resolve()),
        "pts": str(Path(args.pts).resolve()),
        "offsets": str(Path(args.offsets).resolve()),
        "temporal": temporal_report,
        "calibration_frame_indices": cal_idx,
        "qc_frame_indices": qc_idx,
        "sky_offsets_deg": offsets,
        "baseline_run": args.qc_from,
        "stitchlab_git_head": subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=Path(__file__).parent,
        ).stdout.strip(),
        "pts_sha256": hashlib.sha256(open(args.pts, "rb").read()).hexdigest(),
        "tool_versions": _tool_versions(),
        "argv": sys.argv,
        "ghost": res,
        "outputs": outputs,
        "timings": {"ghost_pass_s": round(t_ghost, 3), "total_s": round(time.perf_counter() - t_start, 3)},
    }
    path = out_dir / "baseline.json"
    path.write_text(json.dumps(doc, indent=2, default=float))
    print(f"wrote {path}")
    for fam, st in res["per_family"].items():
        print(f"{fam}: mean GE {st['mean_ghost_energy']:.5f}  max GE {st['max_ghost_energy']:.5f}")
    for t in res["target_sites"]:
        print(f"TARGET {t['label']}: ghost_energy {t['ghost_energy']:.5f} (sum {t['ghost_energy_sum']:.1f})")
    for s in res["worst_ghost_sites"]:
        print(f"WORST {s['family']} {s['seam']} f{s['frame']} c{s['col']}: "
              f"ghost_energy {s['ghost_energy']:.5f} (sum {s['ghost_energy_sum']:.1f})")
    return 0


# ------------------------------------------------------------ flow-morph phase
#
# Surround360-style parallax correction, confined to the frozen blend bands.
# Per vertical seam (6 ring + 3 sky-sky) and per frame:
#   * bidirectional DIS flow between the two cameras' warped strips (gains —
#     and vignette, for sky — applied in LINEAR light; the 8-bit DIS input is
#     gamma-encoded afterwards purely for dynamic range, a monotone map that
#     does not change where the flow locks on),
#   * forward-backward consistency gating (+ validity + magnitude cap),
#   * each camera is warped toward the OTHER by (1 - its own blend share):
#     unwarped where it fully owns the output, fully aligned to the partner
#     where its weight is zero, half-way (the classic midpoint morph) at the
#     seam column. Because the compose weight of a camera is exactly zero
#     where its warp is large, every pixel OUTSIDE a blend band is bit-pristine
#     and the warped/unwarped transition at the band edge is invisible.
#   * flow+cdepth mode (ROUND 3, reworked): the round-2 fallback was one
#     constant (dx, dy) per SKY seam and zero on ring seams. Round-3 probes
#     showed (a) the B-C residual lived exactly in ring regions falling back
#     to zero, and (b) fb-consistency CANNOT flag DIS's thin-structure
#     blindness — zero flow on a wire against flat sky is fb-consistent, so
#     confidently-wrong flow bent the G-H crossarm into an arc (rubber-sheet),
#     melted its tip and breathed frame to frame. Both replaced by:
#       - a PER-ROW RIGID displacement profile per seam (structure-weighted
#         median of confident flow per row window; phase-correlation-FIRST on
#         sky seams, where confident flow is proven untrustworthy; interpolated
#         across structureless rows, smoothed) as the low-confidence fallback
#         on ALL seams, and
#       - a PHOTOMETRIC RESIDUAL GATE on sky seams: flow is demoted wherever
#         warping by the rigid profile aligns the sources clearly better than
#         warping by the flow — the verification fb-consistency cannot do.
#   * temporal stability: flow fields, gates and fallback profiles are
#     EMA-blended when consecutive frames are composed (video QC / full
#     renders); the state resets on any frame-index gap, so sparse QC
#     sampling stays i.i.d.
#
# The sky-ring boundary band is deliberately NOT corrected in this round:
# Andy's note 1 (sky-ring boundary continuity) is currently cleared, the band
# is only ~16 px tall (too thin for trustworthy flow), and ring-first
# compositing must stay. Deviation recorded in the ledger.

#: context half-width (cols) of the strip DIS sees; the morph itself acts
#: only inside the +-feather blend band. Wide enough that a 50-60 px ghost
#: displacement (G-H wires) is still interior at the coarsest DIS level.
FLOW_CTX_HALF = 128
#: fb-consistency gate: |f_ab(x) + f_ba(x + f_ab(x))| < ABS + REL * |f_ab|.
FB_ABS_PX = 1.5
FB_REL = 0.10
#: hard cap on usable flow magnitude (px); beyond it the gate closes.
FLOW_MAX_PX = 80.0
#: Gaussian sigma (px) for smoothing the binary gate into a soft confidence.
CONF_SIGMA = 5.0
#: EMA weight of the NEW frame's fields when frames are consecutive.
EMA_NEW = 0.6
#: absolute Sobel-gradient floor (gained linear luma) for a pixel to count as
#: structure in the rigid-profile estimator: a real edge (wire vs sky reads
#: >~0.5), not sensor noise on flat sky (<~0.01).
CDEPTH_GRAD_MIN = 0.08

# ROUND 3 — structure-rigid fallback + residual-verified flow (probe evidence
# in the ledger). Per-row rigid displacement profile: rows aggregated per
# sampled window (+-half), sample step, i-side structure mass floor per
# window, verification acceptance ratio (best candidate must leave <= this
# fraction of the zero-shift residual), interpolation/decay row limits, and
# smoothing sigma (rows).
PROF_ROW_HALF = 24
PROF_STEP = 16
PROF_MIN_MASS = 60.0
PROF_ACCEPT_REL = 0.80
PROF_GAP_INTERP_MAX = 64
PROF_DECAY_ROWS = 32
PROF_SMOOTH_SIGMA = 10.0
#: photometric residual gate: flow is demoted where warping by the flow leaves
#: MARGIN_REL x (+ MARGIN_ABS) more |residual| than warping by the rigid
#: profile. RES_BLUR pre-smooths the lumas (robustness to resampling noise);
#: RES_SIGMA feathers the demotion mask.
RES_MARGIN_REL = 1.5
RES_MARGIN_ABS = 0.01
RES_BLUR = 1.5
RES_SIGMA = 5.0

# ROUND 4 — SharpSelect: disagreement-gated sharpness-weighted blend shares.
# Round 3 diagnosed the last G-H artifact (crossarm bowed into an arc with a
# melted smear, frames ~1413-1415) to the end: at those frames the crossarm
# sits at H's coverage/FOV edge where H's equirect rendering of the straight
# arm is intrinsically CURVED, stretched and soft, while G renders it straight
# and sharp. No displacement field can reconcile two different SHAPES — it is
# a blend-of-disagreeing-sources artifact, invisible to the ghost-energy
# metric (GE scores source alignment, not the blend). The fix (probe-validated
# in round 3: probe_sharpw_GH_f001414.png) is to stop averaging where the
# MORPHED sources still disagree on structure and hand the blend share to the
# sharper source there. Implementation notes:
#   * operates on BLEND SHARES beta (compose weight with the photometric
#     factor P divided out: ring w = beta*gain, sky w = beta*gain*vig), so the
#     reallocation is a convex combination of two photometrically-corrected
#     estimates of the same scene luminance — exposure/vignette stay exact.
#   * the shift is delta = q * (tot*t_i/(t_i+t_j) - beta_i) with
#     t = beta*(s+eps)^gamma: zero wherever either share is zero, so pixels
#     outside blend bands stay bit-pristine with no extra masking, and the
#     total pair share is preserved even at band edges / triple overlaps.
#   * s = Gaussian-blurred |grad| of the morphed GAINED sources. The blur
#     radius must exceed the residual shape disagreement (~10-20 px at the
#     G-H arc) so the NEIGHBORHOOD's sharper source wins: per-pixel sharpness
#     would let each copy of a residual double image boost itself.
#   * q ramps on the morphed-source disagreement |A'-B'| (gained linear
#     luma): flat-sky photometric mismatch (<~0.01) and aligned structure
#     never engage; only still-disagreeing structure is reallocated.
#   * delta is EMA-blended over consecutive frames like every other field.
SHARP_SIGMA = 6.0    # blur (px) of the sharpness fields (probe 1: 6/10/16 — 6 strongest)
SEL_D_LO = 0.008     # disagreement ramp lo (gained linear luma; probe 2 rescale)
SEL_D_HI = 0.030     # disagreement ramp hi -> full reallocation
SEL_D_SIGMA = 4.0    # blur (px) of the disagreement field before the ramp
SEL_GAMMA = 2.0      # sharpness exponent (t = beta*(s+eps)^gamma)
SEL_EPS = 0.008      # sharpness floor: keeps flat-sky ratios neutral (probe 2 rescale)

# (Round 5 also probed a sharpness-biased MORPH TARGET here — rejected, see
# the negative-result comment in _solve and probe_sharpsel5/6_GH.png.)


def _weighted_median(vals: np.ndarray, wts: np.ndarray) -> float:
    order = np.argsort(vals)
    cw = np.cumsum(wts[order])
    if cw[-1] <= 0:
        return 0.0
    return float(vals[order][np.searchsorted(cw, 0.5 * cw[-1])])


class ParallaxCorrector:
    """Per-seam flow-morph (+ constant-depth fallback) inside blend bands.

    Attach to a calibrated NineStitcher (nine.parallax = corrector); the
    compose path stashes warped strips and applies weighted deltas, the QC
    path gets morphed copies of the per-cam luma planes. Flow is solved once
    per (seam, frame) and cached, so the QC-luma and compose-BGR paths of the
    same frame reuse identical fields.
    """

    def __init__(self, nine: NineStitcher, mode: str = "flow+cdepth", sharpsel: bool = True):
        if mode not in ("flow", "flow+cdepth"):
            raise ValueError(f"unknown parallax mode {mode!r}")
        self.nine = nine
        self.mode = mode
        #: ROUND 4 lever (see the SharpSelect constants above). Constructor
        #: flag rather than a new CLI mode: it is part of the round-4
        #: flow+cdepth behavior; probes A/B it by instantiating directly.
        self.sharpsel = bool(sharpsel)
        # ROUND 2 lever — flow preset tuning, picked by a 4-variant sweep at
        # BOTH target sites (ghost-energy reduction through the fixed window):
        #   finest=1 vr=5  (MEDIUM):  A-B 81.4%  G-H 79.0%   0.81 s/f
        #   finest=0 vr=5          :  A-B 83.7%  G-H 77.6%   1.64 s/f
        #   finest=0 vr=10         :  A-B 83.8%  G-H 78.9%   2.09 s/f
        #   finest=1 vr=10 (SHIPPED): A-B 81.1%  G-H 80.8%   0.98 s/f
        # Full-res finest scale (finest=0) is NOT worth 2-2.6x cost: zooms at
        # both sites are visually indistinguishable, and it trades the harder
        # G-H wire site down. More variational refinement alone is the best
        # single setting on G-H and neutral on A-B at +20% cost. The remaining
        # post-morph softness at G-H is NOT flow error (probe: morphed G/H
        # strips align to noise level) — G's source is inherently soft there;
        # candidate next lever is sharpness-weighted blending, not more flow.
        # ROUND 3 lever — structure-rigid low-confidence handling (see the
        # ledger's probe table): the round-2 fallback (global const on sky,
        # ZERO on ring) and fb-only confidence caused both judge blockers.
        # Replaced by _verified_profile (+ _residual_demote on sky); the DIS
        # preset itself is unchanged from round 2.
        self._dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self._dis.setVariationalRefinementIterations(10)  # MEDIUM default: 5
        self._state: dict[str, dict] = {}
        self._stash: dict[tuple[str, str], np.ndarray] = {}
        self.stats = {"flow_solve_s": 0.0, "apply_s": 0.0, "frames_solved": 0,
                      "seam_solves": 0, "profile_windows_accepted": 0}
        self._last_solved_idx: int | None = None

        w = nine.eq_w
        self.specs: list[dict] = []
        for s in nine.ring.seams:
            li, lj = s.pair  # li owns the LEFT of the seam (yaw order)
            F = float(nine.ring.feather)
            cols = np.arange(s.col_unwrapped - FLOW_CTX_HALF, s.col_unwrapped + FLOW_CTX_HALF + 1) % w
            u = np.arange(-FLOW_CTX_HALF, FLOW_CTX_HALF + 1, dtype=np.float32)
            self.specs.append({
                "key": f"ring:{li}-{lj}", "kind": "ring", "li": li, "lj": lj,
                "cols": cols, "feather": F,
                "share_i": np.clip((F - u) / (2.0 * F), 0.0, 1.0),
                "valid": (nine.ring.maps[li][2][:, cols] & nine.ring.maps[lj][2][:, cols]),
                "gain_i": nine.ring.gains[li], "gain_j": nine.ring.gains[lj],
                "w_i": np.ascontiguousarray(nine.ring._weights[li][:, cols]),
                "w_j": np.ascontiguousarray(nine.ring._weights[lj][:, cols]),
                # ROUND 3: ring seams get the rigid-profile fallback too — the
                # B-C blocker's residual lived exactly in ring regions falling
                # back to zero (probe: B-C f135 42.8% -> 80.3% with a profile).
                "cdepth": (mode == "flow+cdepth"),
                # ROUND 4 (SharpSelect): photometric factor P (w = beta*P) and
                # the blend shares beta. Ring P is the scalar gain.
                "P_i": float(nine.ring.gains[li]),
                "P_j": float(nine.ring.gains[lj]),
                "beta_i": np.ascontiguousarray(nine.ring._weights[li][:, cols] / nine.ring.gains[li]),
                "beta_j": np.ascontiguousarray(nine.ring._weights[lj][:, cols] / nine.ring.gains[lj]),
            })
        for s in nine.sky_seams:
            li, lj = s.pair
            F = float(nine.feather_h)
            cols = np.arange(s.col_unwrapped - FLOW_CTX_HALF, s.col_unwrapped + FLOW_CTX_HALF + 1) % w
            u = np.arange(-FLOW_CTX_HALF, FLOW_CTX_HALF + 1, dtype=np.float32)
            self.specs.append({
                "key": f"sky:{li}-{lj}", "kind": "sky", "li": li, "lj": lj,
                "cols": cols, "feather": F,
                "share_i": np.clip((F - u) / (2.0 * F), 0.0, 1.0),
                "valid": (nine.sky_maps[li][2][:, cols] & nine.sky_maps[lj][2][:, cols]),
                "gain_i": nine.sky_gains[li], "gain_j": nine.sky_gains[lj],
                "vig_i": np.ascontiguousarray(nine._sky_vig[li][:, cols]),
                "vig_j": np.ascontiguousarray(nine._sky_vig[lj][:, cols]),
                "w_i": np.ascontiguousarray(nine._sky_weights_vig[li][:, cols]),
                "w_j": np.ascontiguousarray(nine._sky_weights_vig[lj][:, cols]),
                "cdepth": (mode == "flow+cdepth"),
                # ROUND 4 (SharpSelect): sky P = gain * vig (2D, _sky_vig is
                # clipped to [0.5, 2.0] so the divide is safe); beta is then
                # exactly the normalized blend share (arr/safe in
                # _build_sky_weights), summing to 1 where the pair covers.
                "P_i": np.ascontiguousarray(nine.sky_gains[li] * nine._sky_vig[li][:, cols]),
                "P_j": np.ascontiguousarray(nine.sky_gains[lj] * nine._sky_vig[lj][:, cols]),
                "beta_i": np.ascontiguousarray(
                    nine._sky_weights_vig[li][:, cols] / (nine.sky_gains[li] * nine._sky_vig[li][:, cols])),
                "beta_j": np.ascontiguousarray(
                    nine._sky_weights_vig[lj][:, cols] / (nine.sky_gains[lj] * nine._sky_vig[lj][:, cols])),
            })

    # ------------------------------------------------------------- flow solve

    @staticmethod
    def _encode8(lum: np.ndarray) -> np.ndarray:
        return (np.clip(lum, 0.0, 1.0) ** (1.0 / 2.4) * 255.0).astype(np.uint8)

    def _conf(self, f_fwd: np.ndarray, f_bwd: np.ndarray, valid: np.ndarray) -> np.ndarray:
        h, wd = f_fwd.shape[:2]
        gx, gy = np.meshgrid(np.arange(wd, dtype=np.float32), np.arange(h, dtype=np.float32))
        bx = cv2.remap(f_bwd[..., 0], gx + f_fwd[..., 0], gy + f_fwd[..., 1],
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        by = cv2.remap(f_bwd[..., 1], gx + f_fwd[..., 0], gy + f_fwd[..., 1],
                       cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        err = np.hypot(f_fwd[..., 0] + bx, f_fwd[..., 1] + by)
        mag = np.hypot(f_fwd[..., 0], f_fwd[..., 1])
        ok = (err < FB_ABS_PX + FB_REL * mag) & (mag < FLOW_MAX_PX) & valid
        conf = cv2.GaussianBlur(ok.astype(np.float32), (0, 0), CONF_SIGMA)
        return np.clip(conf, 0.0, 1.0)

    @staticmethod
    def _structure(lum_i: np.ndarray, lum_j: np.ndarray, valid: np.ndarray):
        """(grad, structured-mask): gradient-selected REAL structure only
        (absolute floor CDEPTH_GRAD_MIN, i.e. an actual edge, plus the strip's
        own p97) — sensor noise on flat sky must not count as structure."""
        grad = np.maximum(_grad_mag(lum_i), _grad_mag(lum_j))
        if not valid.any():
            return grad, np.zeros_like(valid)
        thr = max(CDEPTH_GRAD_MIN, 0.5 * float(np.percentile(grad[valid], 97.0)))
        return grad, valid & (grad >= thr)

    def _verified_profile(self, flow: np.ndarray, conf: np.ndarray, lum_i: np.ndarray,
                          lum_j: np.ndarray, valid: np.ndarray) -> np.ndarray:
        """Per-row rigid displacement profile (h, 2) for one seam direction.

        ROUND 3 (replaces the round-2 global constant / zero fallback): each
        sampled row window gets one VERIFIED (dx, dy). Candidates per window —
        luma phase-corr, GRADIENT phase-corr (thin wires carry almost no FFT
        energy against the sky/vignette gradient; their own gradient image
        does), the strip's strongest-structure-window phase-corr (the round-2
        global estimator, reliable on the G-H tower), the previous accepted
        window's value, and the structure-weighted median of the CONFIDENT
        flow. A candidate is accepted only if warping the window by it leaves
        <= PROF_ACCEPT_REL x the zero-shift photometric residual (weight =
        i-side structure ONLY: weighting by both sides penalizes every true
        candidate at the vacated ghost position — probe #5's biased oracle).
        No acceptance -> no fallback displacement: flat-sky junk cannot enter
        (the S-probe's unverified pc profile cost J-G -358% ghost energy).
        Rows between accepted windows are interpolated (gap <=
        PROF_GAP_INTERP_MAX) or decay to zero; the profile is smoothed — the
        fallback can shift and shear, but never bend structure."""
        h, w = lum_i.shape
        grad, structured = self._structure(lum_i, lum_j, valid)
        if not structured.any():
            return np.zeros((h, 2), np.float32)
        gi = _grad_mag(lum_i)
        gj = _grad_mag(lum_j)
        thr = max(CDEPTH_GRAD_MIN, 0.5 * float(np.percentile(grad[valid], 97.0)))
        wfull = (gi * (valid & (gi >= thr))).astype(np.float32)
        si = cv2.GaussianBlur(lum_i, (0, 0), RES_BLUR)
        sj = cv2.GaussianBlur(lum_j, (0, 0), RES_BLUR)
        wc = grad * (structured & (conf > 0.6))
        ys, xs = np.nonzero(wc)
        wv = wc[ys, xs]
        vx = flow[ys, xs, 0]
        vy = flow[ys, xs, 1]
        # global candidate: strongest-structure window phase-corr (round 2)
        prow = (grad * structured).sum(axis=1)
        glob = None
        if prow.sum() > 0:
            rb = int(np.argmax(cv2.GaussianBlur(prow[:, None], (0, 0), 8).ravel()))
            a, b = max(0, rb - 64), min(h, rb + 65)
            pc = _phase_correlate(lum_i[a:b], lum_j[a:b])
            if pc["mag"] < FLOW_MAX_PX:
                glob = (pc["dx"], pc["dy"])

        def eval_shift(sl, wgt, wsum, gxw, gyw, dx, dy):
            sh = cv2.remap(sj[sl], gxw + np.float32(dx), gyw + np.float32(dy),
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            return float((np.abs(si[sl] - sh) * wgt).sum() / wsum)

        grids: dict[int, tuple] = {}
        prof = np.full((h, 2), np.nan, np.float32)
        last = None
        for r in range(0, h, PROF_STEP):
            a, b = max(0, r - PROF_ROW_HALF), min(h, r + PROF_ROW_HALF + 1)
            sl = slice(a, b)
            wgt = wfull[sl]
            wsum = float(wgt.sum())
            if wsum < PROF_MIN_MASS:
                continue  # nothing structured to protect in this window
            hh = b - a
            if hh not in grids:
                grids[hh] = np.meshgrid(np.arange(w, dtype=np.float32),
                                        np.arange(hh, dtype=np.float32))
            gxw, gyw = grids[hh]
            cands = []
            pcl = _phase_correlate(lum_i[sl], lum_j[sl])
            if pcl["mag"] < FLOW_MAX_PX:
                cands.append((pcl["dx"], pcl["dy"]))
            pcg = _phase_correlate(gi[sl], gj[sl])
            if pcg["mag"] < FLOW_MAX_PX:
                cands.append((pcg["dx"], pcg["dy"]))
            if glob is not None:
                cands.append(glob)
            if last is not None:
                cands.append(last)
            lo, hi = np.searchsorted(ys, a), np.searchsorted(ys, b)
            if float(wv[lo:hi].sum()) >= PROF_MIN_MASS:
                cands.append((float(_weighted_median(vx[lo:hi], wv[lo:hi])),
                              float(_weighted_median(vy[lo:hi], wv[lo:hi]))))
            if not cands:
                continue
            e0 = eval_shift(sl, wgt, wsum, gxw, gyw, 0.0, 0.0)
            best_e, best_d = e0, None
            for dx, dy in cands:
                e = eval_shift(sl, wgt, wsum, gxw, gyw, dx, dy)
                if e < best_e:
                    best_e, best_d = e, (dx, dy)
            if best_d is not None and best_e <= PROF_ACCEPT_REL * e0:
                prof[r] = best_d
                last = best_d
                self.stats["profile_windows_accepted"] += 1
        ok = ~np.isnan(prof[:, 0])
        if not ok.any():
            return np.zeros((h, 2), np.float32)
        idx = np.where(ok)[0]
        out = np.zeros((h, 2), np.float32)
        allr = np.arange(h)
        near = np.searchsorted(idx, allr)
        for c_ in range(2):
            vals = prof[idx, c_]
            filled = np.zeros(h, np.float32)
            for r in range(h):
                k = near[r]
                lo_i = idx[k - 1] if k > 0 else None
                hi_i = idx[k] if k < len(idx) else None
                if lo_i is not None and hi_i is not None and hi_i - lo_i <= PROF_GAP_INTERP_MAX:
                    t = (r - lo_i) / max(hi_i - lo_i, 1)
                    filled[r] = (1 - t) * vals[k - 1] + t * vals[k]
                else:
                    d_lo = r - lo_i if lo_i is not None else 10 ** 9
                    d_hi = hi_i - r if hi_i is not None else 10 ** 9
                    vnear = vals[k - 1] if d_lo <= d_hi else vals[k]
                    filled[r] = vnear * max(0.0, 1.0 - min(d_lo, d_hi) / PROF_DECAY_ROWS)
            out[:, c_] = cv2.GaussianBlur(filled.reshape(-1, 1), (0, 0),
                                          PROF_SMOOTH_SIGMA).ravel()
        return out

    @staticmethod
    def _residual_demote(lum_i: np.ndarray, lum_j: np.ndarray, flow: np.ndarray,
                         px: np.ndarray, py: np.ndarray,
                         gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
        """Soft mask (1 = demote flow): where warping j by the FLOW leaves
        clearly more photometric residual against i than warping j by the
        rigid PROFILE. This is the verification fb-consistency cannot do —
        DIS returning zero flow on a thin wire is perfectly fb-consistent,
        but it fails this test (the un-moved wire still mismatches)."""
        si = cv2.GaussianBlur(lum_i, (0, 0), RES_BLUR)
        sj = cv2.GaussianBlur(lum_j, (0, 0), RES_BLUR)
        j_flow = cv2.remap(sj, gx + flow[..., 0], gy + flow[..., 1],
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        j_prof = cv2.remap(sj, gx + px, gy + py,
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        e_flow = np.abs(j_flow - si)
        e_prof = np.abs(j_prof - si)
        bad = (e_flow > RES_MARGIN_REL * e_prof + RES_MARGIN_ABS).astype(np.float32)
        return np.clip(cv2.GaussianBlur(bad, (0, 0), RES_SIGMA), 0.0, 1.0)

    def _solve(self, spec: dict, lum_i: np.ndarray, lum_j: np.ndarray, frame_idx: int) -> dict:
        """Bidirectional flow + gates + rigid profiles + warp maps for one
        seam at one frame. Cached per frame; EMA-blended when consecutive."""
        st = self._state.get(spec["key"])
        if st is not None and st["idx"] == frame_idx:
            return st
        t0 = time.perf_counter()
        i8, j8 = self._encode8(lum_i), self._encode8(lum_j)
        f_ij = self._dis.calc(i8, j8, None)  # content of i at x sits at x+f in j
        f_ji = self._dis.calc(j8, i8, None)
        conf_i = self._conf(f_ij, f_ji, spec["valid"])  # trust of f_ij
        conf_j = self._conf(f_ji, f_ij, spec["valid"])
        h, wd = lum_i.shape
        if spec["cdepth"]:
            prof_ij = self._verified_profile(f_ij, conf_i, lum_i, lum_j, spec["valid"])
            prof_ji = self._verified_profile(f_ji, conf_j, lum_j, lum_i, spec["valid"])
        else:  # mode "flow": round-2 pure flow, zero fallback
            prof_ij = np.zeros((h, 2), np.float32)
            prof_ji = np.zeros((h, 2), np.float32)

        if st is not None and st["idx"] == frame_idx - 1:  # temporal EMA
            k = EMA_NEW
            f_ij = k * f_ij + (1 - k) * st["f_ij"]
            f_ji = k * f_ji + (1 - k) * st["f_ji"]
            conf_i = k * conf_i + (1 - k) * st["conf_i"]
            conf_j = k * conf_j + (1 - k) * st["conf_j"]
            prof_ij = k * prof_ij + (1 - k) * st["prof_ij"]
            prof_ji = k * prof_ji + (1 - k) * st["prof_ji"]

        gx, gy = np.meshgrid(np.arange(wd, dtype=np.float32), np.arange(h, dtype=np.float32))
        v = spec["valid"]
        px_ij = (prof_ij[:, 0][:, None] * v).astype(np.float32)
        py_ij = (prof_ij[:, 1][:, None] * v).astype(np.float32)
        px_ji = (prof_ji[:, 0][:, None] * v).astype(np.float32)
        py_ji = (prof_ji[:, 1][:, None] * v).astype(np.float32)
        if spec["kind"] == "sky" and spec["cdepth"]:
            # ROUND 3: photometric residual gate (sky only — fb-consistency is
            # blind to DIS's thin-wire failure; ring flow is texture-verified
            # well enough by fb and keeps its validated round-2 behavior).
            # Computed AFTER the EMA so laggy blended flow is demoted too.
            conf_i = conf_i * (1.0 - self._residual_demote(lum_i, lum_j, f_ij, px_ij, py_ij, gx, gy))
            conf_j = conf_j * (1.0 - self._residual_demote(lum_j, lum_i, f_ji, px_ji, py_ji, gx, gy))

        # displacement each camera samples along (BORDER_REPLICATE remap):
        #   i'(x) = i(x + (1-share_i(x)) * D_ji(x)),
        #   j'(x) = j(x + (1-share_j(x)) * D_ij(x)),
        #   D_ij = conf_i*f_ij + (1-conf_i)*profile_ij   (per-row rigid fallback)
        d_ij_x = conf_i * f_ij[..., 0] + (1.0 - conf_i) * px_ij
        d_ij_y = conf_i * f_ij[..., 1] + (1.0 - conf_i) * py_ij
        d_ji_x = conf_j * f_ji[..., 0] + (1.0 - conf_j) * px_ji
        d_ji_y = conf_j * f_ji[..., 1] + (1.0 - conf_j) * py_ji
        # ROUND 5 NEGATIVE RESULT (kept as a comment so nobody re-tries it):
        # biasing the morph MEETING POINT toward the sharper source (rho !=
        # share_i) was probed per-pixel AND per-row-aggregated
        # (probe_sharpsel5_GH / probe_sharpsel6_GH rows 3, scratchpad). Both
        # bend or double structure: per-pixel rho undulates with the local
        # sharpness field (S-curved crossarm, melted A-B palm trunk); per-row
        # rho shears vertical structures (snaking trunk) AND materializes
        # one-sided flow error as a DOUBLE contour — the midpoint morph's
        # error-splitting is what hides fb-consistent flow error, and any
        # rho != share gives it up. The G-H crest smear (H's FOV-edge
        # rendering is intrinsically curved+soft) is NOT fixable by any
        # content-driven warp retarget; next candidate is a STATIC per-cam
        # coverage-edge weight attenuation in the sky compose (no content
        # dependence -> no bending, no breathing).
        e_i = (1.0 - spec["share_i"])[None, :]        # i's morph envelope
        e_j = spec["share_i"][None, :]                # j's morph envelope
        map_i = (gx + e_i * d_ji_x, gy + e_i * d_ji_y)
        map_j = (gx + e_j * d_ij_x, gy + e_j * d_ij_y)

        # ROUND 4 — SharpSelect blend-share shift (see the constants block).
        # Computed from the MORPHED gained sources (post-EMA maps) so the
        # compose and QC paths of a frame see identical fields; EMA'd itself
        # for temporal stability (dsel is what the composite actually feels).
        dsel = np.zeros_like(lum_i)
        if self.sharpsel:
            a_m = self._morph(lum_i, map_i)
            b_m = self._morph(lum_j, map_j)
            d = np.abs(a_m - b_m)
            q = np.clip((cv2.GaussianBlur(d, (0, 0), SEL_D_SIGMA) - SEL_D_LO)
                        / (SEL_D_HI - SEL_D_LO), 0.0, 1.0)
            s_i = cv2.GaussianBlur(_grad_mag(a_m), (0, 0), SHARP_SIGMA)
            s_j = cv2.GaussianBlur(_grad_mag(b_m), (0, 0), SHARP_SIGMA)
            bi, bj = spec["beta_i"], spec["beta_j"]
            t_i = bi * (s_i + SEL_EPS) ** SEL_GAMMA
            t_j = bj * (s_j + SEL_EPS) ** SEL_GAMMA
            dsel = q * ((bi + bj) * t_i / (t_i + t_j + 1e-12) - bi)
            if st is not None and st["idx"] == frame_idx - 1:
                dsel = EMA_NEW * dsel + (1 - EMA_NEW) * st["dsel"]
            # commitment error: how far the band composite sits from the
            # NEARER source, on disagreeing structure. A composite that
            # commits to either source scores 0; a 50/50 smear scores high.
            # GE cannot see this (it measures source alignment, not blend).
            wgt = q * np.maximum(_grad_mag(a_m), _grad_mag(b_m))
            c0 = bi * a_m + bj * b_m
            c1 = c0 + dsel * (a_m - b_m)
            ce = self.stats.setdefault("commit_err", {}).setdefault(
                spec["key"], {"before": 0.0, "after": 0.0, "w": 0.0})
            ce["before"] += float((np.minimum(np.abs(c0 - a_m), np.abs(c0 - b_m)) * wgt).sum())
            ce["after"] += float((np.minimum(np.abs(c1 - a_m), np.abs(c1 - b_m)) * wgt).sum())
            ce["w"] += float(wgt.sum())

        st = {
            "idx": frame_idx, "f_ij": f_ij, "f_ji": f_ji,
            "conf_i": conf_i, "conf_j": conf_j,
            "prof_ij": prof_ij, "prof_ji": prof_ji,
            "dsel": dsel,
            "map_i": map_i,
            "map_j": map_j,
            "gated_frac": float((conf_i < 0.5)[v].mean()) if v.any() else 1.0,
        }
        self._state[spec["key"]] = st
        self.stats["flow_solve_s"] += time.perf_counter() - t0
        self.stats["seam_solves"] += 1
        if self._last_solved_idx != frame_idx:
            self._last_solved_idx = frame_idx
            self.stats["frames_solved"] += 1
        return st

    @staticmethod
    def _morph(img: np.ndarray, mp: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
        return cv2.remap(img, mp[0], mp[1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

    # ------------------------------------------------------------ compose path

    def stash(self, kind: str, letter: str, warped_lin: np.ndarray) -> None:
        """Keep the strips of this camera's warped LINEAR image that any of
        its seams needs (called by compose_frame right after each remap)."""
        for spec in self.specs:
            if spec["kind"] != kind:
                continue
            if spec["li"] == letter or spec["lj"] == letter:
                self._stash[(spec["key"], letter)] = np.ascontiguousarray(warped_lin[:, spec["cols"]])

    def apply(self, kind: str, acc: np.ndarray, frame_idx: int) -> None:
        """Add the weighted morph deltas of every `kind` seam into the linear
        accumulator (in place). Weights are the FROZEN compose weights, so
        the correction is exactly w_i*(i'-i) + w_j*(j'-j) inside the band and
        exactly zero outside it."""
        t0 = time.perf_counter()
        for spec in self.specs:
            if spec["kind"] != kind:
                continue
            a = self._stash.pop((spec["key"], spec["li"]), None)
            b = self._stash.pop((spec["key"], spec["lj"]), None)
            if a is None or b is None:
                raise RuntimeError(f"parallax: strips for {spec['key']} were not stashed")
            lum_i = a.mean(axis=2)
            lum_j = b.mean(axis=2)
            if kind == "sky":
                lum_i *= spec["vig_i"]
                lum_j *= spec["vig_j"]
            st = self._solve(spec, spec["gain_i"] * lum_i, spec["gain_j"] * lum_j, frame_idx)
            a_m = self._morph(a, st["map_i"])
            b_m = self._morph(b, st["map_j"])
            acc[:, spec["cols"]] += (
                spec["w_i"][:, :, None] * (a_m - a) + spec["w_j"][:, :, None] * (b_m - b)
            )
            if self.sharpsel:
                # ROUND 4 (SharpSelect): move dsel of blend share from j to i
                # between the PHOTOMETRICALLY CORRECTED morphed sources
                # (P*src is the scene-luminance estimate; ring P scalar, sky
                # P = gain*vig 2D). Exactly zero wherever either share is
                # zero, so out-of-band pixels stay bit-pristine.
                P_i, P_j = spec["P_i"], spec["P_j"]
                if spec["kind"] == "sky":
                    P_i, P_j = P_i[:, :, None], P_j[:, :, None]
                acc[:, spec["cols"]] += st["dsel"][:, :, None] * (P_i * a_m - P_j * b_m)
        self.stats["apply_s"] += time.perf_counter() - t0

    # ----------------------------------------------------------------- QC path

    def correct_lums(self, ring_lums: dict, sky_lums: dict, frame_idx: int):
        """Morphed COPIES of the per-cam linear-luma planes (QC/ghost path).
        Vignette is already applied to sky_lums; gains are NOT (the QC
        accumulators apply them), matching the compose-path photometry."""
        ring_c = {l: v.copy() for l, v in ring_lums.items()}
        sky_c = {l: v.copy() for l, v in sky_lums.items()}
        for spec in self.specs:
            src = ring_c if spec["kind"] == "ring" else sky_c
            a = np.ascontiguousarray(src[spec["li"]][:, spec["cols"]])
            b = np.ascontiguousarray(src[spec["lj"]][:, spec["cols"]])
            st = self._solve(spec, spec["gain_i"] * a, spec["gain_j"] * b, frame_idx)
            src[spec["li"]][:, spec["cols"]] = self._morph(a, st["map_i"])
            src[spec["lj"]][:, spec["cols"]] = self._morph(b, st["map_j"])
        return ring_c, sky_c

    # ----------------------------------------------------------------- report

    def report(self) -> dict:
        return {
            "mode": self.mode,
            "corrected_seams": [s["key"] for s in self.specs],
            "sky_ring_band": "uncorrected (deliberate; see ledger: note-1 cleared, 16 px band)",
            "flow": {
                "solver": "DIS (preset MEDIUM, varRefIters=10)",
                "input": "gain(+vig)-applied linear luma, gamma-encoded to 8 bit",
                "ctx_half_px": FLOW_CTX_HALF, "fb_gate_px": [FB_ABS_PX, FB_REL],
                "flow_max_px": FLOW_MAX_PX, "conf_sigma_px": CONF_SIGMA,
            },
            "morph": "each cam warped toward the other by (1 - own blend share); midpoint at seam col",
            "rigid_profile": {
                # ROUND 3: replaces the round-2 global constant / zero fallback
                "seams": [s["key"] for s in self.specs if s["cdepth"]],
                "estimator": "per-row-window VERIFIED candidates (luma pc, gradient pc, "
                             "strongest-window pc, last-accepted, confident-flow median); "
                             "accepted iff residual <= PROF_ACCEPT_REL x zero-shift",
                "row_half": PROF_ROW_HALF, "step": PROF_STEP,
                "min_mass": PROF_MIN_MASS, "accept_rel": PROF_ACCEPT_REL,
                "gap_interp_max": PROF_GAP_INTERP_MAX, "decay_rows": PROF_DECAY_ROWS,
                "smooth_sigma": PROF_SMOOTH_SIGMA,
            },
            "residual_gate": {
                "seams": "sky-sky only (fb-consistency is blind to DIS thin-wire failure)",
                "margin_rel": RES_MARGIN_REL, "margin_abs": RES_MARGIN_ABS,
                "blur": RES_BLUR, "sigma": RES_SIGMA,
            },
            "temporal_ema_new_weight": EMA_NEW,
            "sharp_select": None if not self.sharpsel else {
                # ROUND 4: disagreement-gated sharpness-weighted blend shares
                "why": "blend-of-disagreeing-shapes smear (G-H crossarm at H's "
                       "FOV edge) — invisible to GE, fixed in the blend, not the "
                       "warp; round-5 constants rescaled to the scene's dark "
                       "signal level (probe 2); morph-target bias REJECTED "
                       "(bends/doubles structure — see _solve comment)",
                "sharp_sigma": SHARP_SIGMA, "d_lo": SEL_D_LO, "d_hi": SEL_D_HI,
                "d_sigma": SEL_D_SIGMA, "gamma": SEL_GAMMA, "eps": SEL_EPS,
                "commit_err": {
                    k: {"before": round(v["before"] / max(v["w"], _EPS), 5),
                        "after": round(v["after"] / max(v["w"], _EPS), 5)}
                    for k, v in self.stats.get("commit_err", {}).items()
                },
                "per_seam_last_dsel_absmax": {
                    k: round(float(np.abs(v["dsel"]).max()), 3)
                    for k, v in self._state.items()
                },
            },
            "per_seam_last_state": {
                k: {"profile_med_dxdy": [round(float(np.median(v["prof_ij"][:, 0])), 2),
                                         round(float(np.median(v["prof_ij"][:, 1])), 2)],
                    "profile_absmax_px": round(float(np.abs(v["prof_ij"]).max()), 2),
                    "gated_frac": round(v["gated_frac"], 3)}
                for k, v in self._state.items()
            },
            "cost": self.cost(),
        }

    def cost(self) -> dict:
        n = max(1, self.stats["frames_solved"])
        return {
            **{k: round(v, 3) if isinstance(v, float) else v
               for k, v in self.stats.items() if k != "commit_err"},
            "flow_solve_s_per_frame": round(self.stats["flow_solve_s"] / n, 4),
            "apply_s_per_frame": round(self.stats["apply_s"] / n, 4),
            "total_s_per_frame": round((self.stats["flow_solve_s"] + self.stats["apply_s"]) / n, 4),
        }
