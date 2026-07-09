# True Ring Stitch in Ingest — Design

2026-07-09 · v1 · research corpus: `docs/research/2026-07-09-ring-stitch-*`

## Goal

Replace the fake hconcat "ring panorama" in the ingest renditions stage with a **true
calibration-driven stitch** of the 6 ring cameras, rendered offline during ingest:

1. A watermarked web preview (the site's "stitched view", ≥2880 wide) that visibly
   beats the current xstack fake immediately.
2. A path to full-res 3840×1920-band ProRes masters — the "$8k/min pro stitched"
   deliverable.
3. A credible, measured path to **beat PTGui on parallax seams** via per-frame
   optical-flow correction in the overlap zones.

## Why PTGui leaves seams (the core physics)

A calibration remap solves "bend and stretch the rectangle" exactly — but it is one
**global, static** geometry. The six lenses sit centimeters apart, so a pole 2 m away
genuinely appears in different directions from adjacent cameras (parallax). No single
warp aligns both the pole and the background. Beating PTGui = adding **per-frame,
local** alignment: optical flow between adjacent cameras inside each overlap zone,
warping both sides toward a virtual middle before blending (the Surround360 /
Google Jump / Mistika VR recipe). Offline ingest can afford this; live stitching can't.

## What we verified we already have (research digests)

- **The exact math, twice.** The live stitcher's Metal kernel
  (`RemapCompute.metal`, repo `~/Projects/spheris-smart-stitch`) implements
  equirect→camera: `R = Ry(yaw)·Rx(pitch)·Rz(roll)` (world +y = down), rectilinear
  tan-space, PTGui quartic distortion `r' = a·r⁴+b·r³+c·r²+(1−a−b−c)·r`, pixel-space
  d/e shift, focal from hfov, principal = center. And `tools/calibrate.py` contains a
  **NumPy reference of the same warp** (`warp_to_equirect`) using `cv2.remap`,
  plus an offline preview stitch already using OpenCV `ExposureCompensator`,
  `DpSeamFinder("COLOR_GRAD")`, and `MultiBandBlender` — a direct template.
- **Calibration + ground truth.** `mercy01.pts` (PTGui v33) with **103 control
  points** and a rendered reference `mercy01.jpg` exist. Distortion coefficients are
  zeroed everywhere (the PTGui polynomial convention was never verified — the known
  historical trap in this codebase).
- **Sync.** The 9 cameras are TC-locked with small known frame offsets
  (Roll01_Clip04: A+1 B+3 C+2 D+2 E+2 F+1; 1631 usable frames). Sub-frame exposure
  offsets (±half frame, no genlock) remain — a real limit flow must tolerate.
- **Studio Mac reality.** Apple Silicon GPU available; ffmpeg has remap/v360; but the
  disk is 90 % full (47 GiB free) — masters must stream to the NAS.

## Decision: architecture B ("flow-stitcher"), with grafts

Three architectures were designed independently and adversarially judged
(`docs/research/2026-07-09-ring-stitch-verdict.json`):

| | quality ceiling | first win | perf | maint fit | calib | risk | total |
|---|---|---|---|---|---|---|---|
| A ffmpeg-first | 8 | 6 | 4 | 8 | 8 | 7 | 41 |
| **B flow-stitcher (winner)** | **9** | 6 | 6 | 7 | 9 | 7 | **44** |
| C metal-reuse | 8 | 8 | 9 | 4 | 7 | 5 | 41 |

**B wins because it has no throwaway rung**: the MVP static path (float32 `cv2.remap`
LUTs + frozen graph-cut seams + multiband blend) is the *same engine* the flow morph
later plugs into. A's ffmpeg maskedmerge graph gets discarded the moment flow arrives;
C's Metal excellence is a maintenance mismatch for a one-person TS/ffmpeg shop —
but C stays warm as the performance escape hatch (see below).

**Component:** a small Python/OpenCV CLI (`pipeline/stitch/`), invoked from a new
TypeScript `stitch` stage between telemetry and renditions. Idempotent, audited,
`--dry-run` prints the full command line; every output carries a manifest with input
hashes + tool versions + argv hash.

**Grafts adopted from A:** standing SSIM gate vs `mercy01.jpg` on every prep (not
one-time); degraded-mode ladder (never block publish — hconcat fallback, ring-band-
only master, zero-distortion mode); per-clip seam-yaw rotation knob as a manual
rescue; one-time hugin `nona`+`multiblend` 50-frame excerpt as the static-quality
ceiling reference.

**Grafts adopted from C:** golden-frame CI (render frames 10/100/500 of Clip04,
compare to stored refs); idempotency keyed on input hashes, not output bytes;
exit-code taxonomy with report-always-written; the headless-Metal plan is
pre-de-risked and triggers if MVP throughput misses 0.5 s/frame.

## Phased plan

**M0 — Convention gate (do first, ~1 day).** Parse `mercy01.pts` in Python; reproject
the 103 control points (**gate: <1.5 px RMS**) and SSIM-diff a rendered still against
`mercy01.jpg` — *before touching any video*. Both prior failures in this codebase
(zeroed distortion, wrong tan-space radius) were exactly this mistake. This gate is
the highest-leverage day of the whole project.

**M1 — Single-clip vertical slice (~5–6 days total).** Roll01_Clip04 only:
TC-trim → cached float32 LUTs → per-clip exposure gain lock → frozen graph-cut seams
+ feather (defer multiband + flow) → 3840×1920 ProRes ring-band master **written to
the NAS** → `stitch.ts` stage wires it as `drop.stitchedMaster` → watermarked 2880
preview on the site, hconcat as audited fallback. One real clip end-to-end proves
calibration, TC contract, pipeline integration, disk/SMB reality — and already looks
dramatically better than the fake.

**M2 — Catalog rollout (~2–3 days).** Generalize to all 7 clips; multiband blend;
per-clip gain solve; degraded-mode ladder; golden-frame CI.

**M3 — Flow ("beat PTGui", ~1–2 weeks).** Bidirectional DIS optical flow in overlap
zones with forward-backward consistency gating, edge-aware hole fill, alpha-ramp
novel-view morph, temporal flow smoothing (no breathing seams), and the **A/B
harness**: seam-zone SSIM + temporal-flicker metrics + eyeball reel vs a real
PTGui batch render of the same clip. The claim gets evidence, not vibes.

**M4 — Full sphere (later).** Sky tier (G/H/J) into a true 360×180 with nadir patch
+ spherical metadata; per-roll sky re-solve via `calibrate.py`.

## Traps promoted to first-class requirements (judge: "missed by all")

1. **Disk:** stream masters to the NAS; per-clip scratch-then-evict; preflight checks
   NAS mount + free space, not local disk.
2. **Gamma vs linear:** PTGui exposure/vignette corrections are defined in linear
   light; proxies are gamma bt709. Linearize before gains or accept biased seams.
3. **Range/matrix pinning:** every ffmpeg↔cv2 rawvideo pipe pins `-color_range`
   (ProRes = limited), 709 matrix, chroma siting — else blacks shift *and* every QA
   metric silently lies.
4. **Sub-frame sync:** TC alignment is frame-quantized; exposure instants differ by
   up to ~±20 ms. Verify mid-clip sync (audio cross-correlation); treat abnormal TC
   spread as "camera restarted — unusable", not "offsettable".
5. **Watermark/grade ordering:** QA metrics computed pre-grade/pre-watermark; the
   hconcat fallback must pass the identical grade+watermark chain for like-for-like
   A/B on site.
6. **Spherical metadata:** inject equirect V2 metadata (sv3d/st3d) into masters so
   buyer QC tools recognize 360 content; specify the nadir treatment in the
   deliverable spec.

## Risks

- PTGui convention mismatch → caught day 1 by M0 gate; fallback zero-distortion mode
  (~2–4 px error with these low-distortion lenses).
- Throughput miss on CPU → C's headless Metal CLI plan is pre-written; trigger at
  <0.5 s/frame.
- SMB flakiness mid-render → per-clip scratch + resumable chunking + preflight.
- Flow artifacts on motion (temporal parallax from sub-frame offsets) → consistency
  gating falls back to static seam locally; seams prefer low-motion columns.
- Catalog growth makes runtime matter → same Metal escape hatch, kept warm.

## Effort summary

MVP on-site win: **~1 week**. Full catalog at static-stitch quality: **+2–3 days**.
Better-than-PTGui flow stitch with measured evidence: **+1–2 weeks**. Full 360×180
with sky tier: follows.
