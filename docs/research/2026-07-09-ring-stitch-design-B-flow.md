# True Ring Stitch — Plate Lab Ingest Architecture

## 0. Design position

One new offline program, **`ringstitch`** — Python 3.11 + `opencv-python-headless` + NumPy, shipped as a PyInstaller single binary exactly like the existing `calibrate` binary (`build.sh` lines 59–75 precedent). It lives at `/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live/tools/ringstitch/` so it can import the already-validated NumPy warp (`calibrate.py:warp_to_equirect`), lens library, and .pts parsing conventions. It runs **only on the studio Mac** (M2, originals local or on `/Volumes/files/SpherisFootage`); the TS pipeline shells out to it as a new stage and the VPS only ever receives encoded renditions. GPU (Metal) is a V3 acceleration, not a dependency — the algorithm is CPU-deterministic first.

Quality thesis (from prior art): static calibration (PTGui-class) can never fix 60–120 px parallax ghosts at 1–3 m (`Δθ ≈ b·|1/d − 1/d_s|`, b ≈ 0.15 m, ~1200 px/rad at 2048-wide). The winning recipe is **static remap + per-frame bidirectional optical flow in the 6 overlap zones + flow-morphed novel-view blend + locked seams + temporal smoothing** (Mistika/Google Jump/Surround360). PTGui = rung (a–c); we ship (a–c) as MVP (immediately beats hconcat), (d–e) as V2 (beats PTGui on parallax).

---

## 1. Components

| # | Component | Language | Location |
|---|---|---|---|
| 1 | `ringstitch` CLI (calib parse, LUT bake, photometric solve, seam solve, per-frame render, encode, metrics) | Python/OpenCV/NumPy | `spheris-smart-stitch-live/tools/ringstitch/` |
| 2 | Calibration resolver (v33 `.pts` JSON parser + per-clip ring/sky refinement merge) | Python (ports `CalibrationData.swift` logic) | inside #1 |
| 3 | A/B metrics + eyeball-reel generator (`ringstitch metrics`, `ringstitch abreel`) | Python + ffmpeg | inside #1 |
| 4 | New pipeline stage `stitch.ts` (invoke, parse JSON progress, audit, fallback) | TypeScript | `/Users/andrewroberts/Projects/the_plate_lab/meridian_public_site/pipeline/src/stages/stitch.ts` |
| 5 | Renditions change: 2880-wide band-cropped watermarked preview from `drop.stitchedMaster` | TypeScript | `.../pipeline/src/stages/renditions.ts` |
| 6 | (V3) Metal warp/blend port reusing `RemapCompute.metal` / `StitchShaders.metal` patterns | Swift/Metal | spheris repo |

## 2. Data flow

```
NAS/local drop (9× ProRes proxy MOV, 2048×1080, bt709, TC-locked)
  │ ffprobe timecode tags
  ▼
[plan]  TC alignment → align.json (per-cam frame offsets, common window)
[calib] mercy01.pts (v33) ⊕ optional per-clip ring flow-refine → calibration_<sha>.pts
  │
  ▼ bake once per (calib, outsize) — CACHED across clips
[bake]  per-cam float32 map_x/map_y (equirect 3840×1920, ROI strips) + vignette gain maps
        + overlap masks (6 ring pairs incl. F–A wrap) → luts/<calibsha>/
[photo] per-clip: gain solve on N sampled frames (locked per clip) → photometric.json
[seam]  per-clip: temporally-aggregated overlap cost → frozen graph-cut seams → seams/<clip>/
  │
  ▼ per frame t (chunked, parallel, resumable)
[render] 6× decode → photometric normalize → static remap (ROI) → per-pair DIS flow
         (prev-frame init, FB-check, EMA) → α-ramp novel-view morph → seam+multiband
         → paste band into 3840×1920 canvas → rgb48 pipe
[encode] ffmpeg: master ProRes 422 3840×1920  +  preview H.264 2880×~560 (band crop, watermark)
[metrics] seam SSIM / ghost energy / flicker index + 3-way A/B reel → stitch_report.json
  │
  ▼
pipeline: drop.stitchedMaster set → buildRenditions stitched path → upload → publish
audit.jsonl: stitch.begin / stitch.chunk / stitch.metrics / stitch.complete (calib sha, config hash, tool version)
```

## 3. Per-frame algorithm (precise)

**Inputs at frame t:** ring frames `I_c` (c ∈ {E,F,A,B,C,D}), decoded to `rgb48le` via 6 parallel `ffmpeg -ss <TC-trim> ... -pix_fmt rgb48le -f rawvideo` pipes; static maps `map_c` (CV_16SC2 + interp table via `cv2.convertMaps`); vignette maps `V_c` (source-space, from .pts coeffs `V(r)=1+c0r²+c1r⁴+c2r⁶+c3r⁸+c4r¹⁰`, r normalized to half-diagonal); per-cam gains `g_c = exp2(EV_c) · gainSolve_c`; frozen seam masks; previous flows `F_{p,t−1}`.

1. **Photometric normalize (source space):** `I'_c = g_c · I_c / V_c` (float32).
2. **Static warp:** `W_c = cv2.remap(I'_c, map_c, INTER_LINEAR)` — only within the camera's equirect ROI strip (~1035 px wide + overlap margins; ring band rows ≈ 500–1200 of 1920). Geometry chain is the audited one: equirect (lon,lat) → world ray (y-down convention) → `R_inv·ray` → `xn=x/z, yn=y/z` → PTGui radial poly + shift → pixel UV, with mercy01 intrinsics scaled 6144→2048 (clean 3× — identical 1.896 aspect).
3. **Per adjacent pair p=(L,R)** (6 pairs, ~395×700 px overlap strips `O_L, O_R`, gray, 0.5× downscale, CLAHE 3.0):
   - `F_LR = DIS(O_L, O_R)` and `F_RL = DIS(O_R, O_L)` (DIS FAST preset; MEDIUM at `--quality max`), warm-started from `F_{p,t−1}`. Semantics: `O_R(x + F_LR(x)) ≈ O_L(x)`.
   - **Forward–backward check:** confidence `C(x) = 1` iff `|F_LR(x) + F_RL(x + F_LR(x))| < 1.5 px` (half-res). Low-confidence → flow forced to 0 (static-geometry fallback) after edge-aware hole fill (`ximgproc.fastGlobalSmootherFilter` guided by `O_L` — the cheap stand-in for Jump's bilateral solver).
   - **Temporal smoothing:** `F_t = clamp(λ·F_raw + (1−λ)·F_{t−1}, ±Δmax)`, λ=0.8 (0.5 where frame-difference says the region is static); Δmax ≈ 4 px/frame.
   - Upscale flows 2× to full-res strips.
4. **Novel-view morph (the parallax kill):** with ramp `α(x) ∈ [0,1]` left→right across the overlap:
   - `Ô_L(x) = O_L(x + α(x)·F_RL(x))`  (α=0 ⇒ pure L; α=1 ⇒ L content in R geometry)
   - `Ô_R(x) = O_R(x + (1−α(x))·F_LR(x))`
   Both warps approximate the *same intermediate viewpoint*, so they agree wherever flow is correct — ghosting is absorbed, not hidden (Surround360 `NovelView` / Jump ray-space idea, backward-warp smooth-field approximation).
5. **Blend:** MVP: `V(x) = (1−α)Ô_L + αÔ_R` (feather). V2: blend `Ô_L/Ô_R` through the **frozen graph-cut seam** with 5-band Laplacian `MultiBandBlender` — hides residual sub-5 px error and exposure steps.
6. **Composite:** non-overlap regions pasted from single warped cams; band written into the 3840×1920 canvas (black/alpha outside coverage in MVP; sky tier G/H/J added statically in V2 — sky ≈ infinity ⇒ zero parallax ⇒ static stitch with the live pipeline's wide `wy` feather is correct there).
7. **Emit** rgb48 frame → encoder pipes.

**Seam solve (per clip, once):** aggregate overlap cost `max_t(|∇-weighted color diff|)` over K≈24 sampled frames (post-flow in V2), graph-cut (`GraphCutSeamFinder COST_COLOR_GRAD`) at 0.25×, upsample, freeze for the clip. V2.5: hysteresis — re-solve only if cost under the seam exceeds threshold, cross-fade over 12 frames.

**Determinism:** no RNG anywhere; `cv2.setNumThreads` pinned; parallelism at frame-chunk granularity only (intra-frame ops fixed threads); prores_ks intra-only encode is deterministic; locked `requirements.txt` + tool version + calib SHA + config hash in every audit event. Re-run ⇒ byte-identical chunks.

## 4. Calibration sourcing

- **Geometry+photometric gold:** `mercy01.pts` (PTGui v33, `/Volumes/files/SpherisFootage/Roll01_Clip04/03:21:24_Mercy_Ptgui/mercy01.pts`; local copies in `the_plate_lab/spheris-smart-stitch-live/config/`). It is the only real calibration on disk and the rig is fixed — valid for all 7 clips' ring tier. Use its solved focal (13.0222 mm / sensordiag 30.56), distortion a/b/c, shift long/short, vignetting, per-image EV. **Do not** use `calibrate.py`'s hardcoded 22.56 mm sensor (hFOV 86.5° vs PTGui-solved ~92.1°) or the zeroed legacy library distortion.
- **Validation before any video (M0 gate):** render our Python warp of the 9 PTGui stills and diff against `mercy01.jpg` (18598×9299 reference) + reproject the 103 control points through our chain; target < 1.5 px RMS at 6K. This nails the PTGui polynomial/shift normalization conventions empirically (the known r-normalization trap) with ground truth, before conventions can poison everything downstream.
- **Per-clip drift insurance:** optional `--refine-ring` runs the calibrate.py Farneback ring refinement (converges 0.03°/0.06° vs gold) on frame N of the clip; merged Δyaw/Δpitch only — lens params always stay mercy01's. Sky pitch drifts ~6° between rolls ⇒ `--solve-sky` per roll (grid-search reuse) before sky tier ships in V2.
- **Provenance:** resolved calibration written as `_CALIBRATION/calibration_<sha256>.pts` per `docs/STOCK_CAPTURE_NAMING_CONTRACT.md` conventions; SHA recorded in audit + plate metadata.
- **TC alignment is per-drop calibration too:** parse ffprobe `timecode` tags, trim to common window (Roll01_Clip04: offsets A=1 B=3 C=2 D=2 E=2 F=1, 1631 common frames); hard-fail if spread > 12 frames or fps ≠ 24/1.

## 5. Pipeline stage placement & CLI

**Placement:** new `runStitch` between `describePlate` and `buildRenditions` in `/Users/andrewroberts/Projects/the_plate_lab/meridian_public_site/pipeline/src/ingest.ts`. It sets `drop.stitchedMaster` → `buildRenditions`' existing stitched-master branch takes over (with the preview encode bumped from 960 to **2880-wide band crop** + existing `watermarkFilter`, label updated to `RING PANORAMA · TRUE STITCH`). `encodeRingPano` (xstack fake) is demoted to explicit fallback, audit-flagged `stitch_fallback: true` (matches MMM's "fallback assets must be flagged" rule). Master checksum/provenance: original cam-A file stays the checksummed source master; `stitchedMaster` gets its own sha256 in audit + metadata, making `stitchedResolution: "3840x1920"` finally true (fix `colorPipeline` to bt709 until the R3D path exists — see risk 5).

**CLI:**

```
ringstitch plan    --drop <dir> --json                       # probe + TC align only
ringstitch render  --drop <dir> --calib <pts> --out <dir>
                   --profile master|preview|both --quality fast|standard|max
                   [--refine-ring] [--solve-sky] [--frames A:B]
                   [--jobs N] [--resume] [--json-progress]
ringstitch metrics --out <dir> --ab hconcat|ptgui|all
ringstitch abreel  --out <dir>                               # 3-way seam-crop reviewer mp4
ringstitch validate-calib --calib <pts> --stills <dir> --ref mercy01.jpg
```

Exit codes: 0 ok · 2 calib invalid · 3 TC alignment failure · 4 partial (failed chunks listed in report). Output contract: `stitch/<calibsha8>-<cfghash8>/{master.mov, preview.mp4, stitch_report.json, chunks/*.ok}`.

**Idempotency:** content-addressed workdir keyed by (calib SHA, config hash, input SHAs); per-chunk `.ok` markers with output-segment SHA; `--resume` skips complete chunks; ffmpeg concat-demuxer assembly; atomic rename of finals. Re-invocation with unchanged inputs is a no-op (stage checks report + hashes and short-circuits).

**Failure handling:** missing/extra cam letter → exit 2 pre-render; TC unparseable/unlocked → exit 3; chunk crash → 1 retry then mark failed, continue, exit 4 (pipeline decides: publish fallback preview, keep drop unpublished-as-stitched); NAS stall → per-read timeout + resume; disk precheck (catalog masters ≈ 35–55 GB ProRes 422 — require 100 GB free); every path audited to `audit.jsonl`.

## 6. A/B metrics harness

Three contenders on identical frame ranges: **(a)** hconcat baseline (existing `encodeRingPano`), **(b)** PTGui: actual PTGui Pro 12.24 batch render of mercy01.pts on a 100-frame extracted sample (honest comparison) plus our own static-remap+feather as its per-frame proxy, **(c)** ringstitch.

- **Seam-zone SSIM / ghost energy:** per pair, SSIM and gradient-weighted mean `|Ô_L − Ô_R|` on the (flow-aligned for us, raw-warped for a/b) overlap strips — direct pre-blend misalignment measure, no ground truth needed.
- **Flicker index:** temporal high-frequency energy of per-column mean luminance inside 40 px seam bands + frame-to-frame delta of ghost energy (catches seam jumping and flow breathing).
- **Eyeball reel:** auto-generated per clip — worst-N seconds ranked by ghost energy, 2× zoomed seam crops, 3-way xstack with labels, synced. Report JSON per clip into `stitch_report.json` + audit.

Acceptance gates: MVP ⇒ ghost energy < hconcat by construction and no brightness banding; V2 ⇒ seam-zone SSIM > PTGui render on the 1–3 m parallax clips and flicker index ≤ PTGui static (i.e., no added shimmer).

## 7. Compute estimate (M2, 8-core CPU / 10-core GPU)

Catalog: 7 clips × 34–151 s ≈ 10–17 min ≈ **15k–25k output frames** (budget 20k).

| Cost/frame (standard quality) | est |
|---|---|
| 6× VideoToolbox decode (piped) | 15–25 ms |
| 6× ROI remap (16SC2 fixed-point) | 15–20 ms |
| 12× DIS-FAST flows @0.5× strips | 30–60 ms |
| morph warps + seam/multiband (strips only) | 40–80 ms |
| ProRes 422 encode 3840×1920 | 20–40 ms |
| Python/NumPy overhead | 50–150 ms |

≈ **0.2–0.5 s/frame** end-to-end with 3–4 chunk workers ⇒ **20k frames ≈ 1.5–3 h** — inside the 2–4 h envelope. Levers that keep it there: static maps baked once and cached across all 7 clips; strip-ROI processing (never touch the full canvas per-cam); flow at 0.5×; prev-frame warm start (halves DIS iterations); frame-chunk parallelism; all hot loops in cv2/NumPy (zero per-pixel Python). `--quality max` (DIS-MEDIUM full-res or RAFT-via-CoreML) is 1–2 s/frame ⇒ 6–11 h — overnight, per selected hero clips only. V3 Metal warp/blend port drops the non-flow cost to <10 ms/frame (~5× throughput) if catalogs grow.

## 8. Milestones

| Phase | Content | Effort |
|---|---|---|
| **M0 — convention spike** | v33 .pts Python parser; PTGui warp reimpl; validate vs `mercy01.jpg` + 103 control points (<1.5 px RMS gate); single-frame static stitches of all 7 clips | 2 d |
| **MVP — rungs a–c** | TC align; cached LUT bake; per-clip gain lock; temporally-aggregated frozen graph-cut seams; multiband; chunked idempotent render; ProRes master + 2880 watermarked preview; `stitch.ts` + audit + hconcat A/B. *Visibly beats hconcat day one.* | 6–8 d |
| **V2 — rungs d–e** | DIS bidirectional flow + FB gating + edge-aware fill + temporal EMA; α-ramp novel-view morph; metrics harness + PTGui A/B + abreel; per-clip ring refine; static sky tier ⇒ full 3840×1920 dome. *Beats PTGui on 1–3 m parallax with evidence.* | 8–10 d |
| **V3 — quality/perf** | RAFT/`VNGenerateOpticalFlowRequest` `--quality max`; Metal warp/blend port; seam hysteresis + occlusion masks; 6K R3D re-render path for the true $8k/min master; optional full Surround360 continuous novel-view | 10–15 d |

## 9. Top 5 risks

1. **PTGui distortion/shift convention mismatch** (known trap: tan-space vs half-min-dimension r-normalization; the Swift port zeroed distortion over exactly this). *Mitigation:* M0 gate against mercy01.jpg + control points is a hard prerequisite; fallback = zero distortion (Laowa Zero-D lenses ⇒ sub-few-px error) with shift/vignetting kept.
2. **Flow failure → seam breathing/wobble** on textureless walls, motion blur, occlusion-only content. *Mitigation:* FB-consistency gating to static geometry (never worse than PTGui), EMA + Δmax clamp, flicker metric as regression gate, `--quality` escalation per clip.
3. **Runtime blowout in Python.** *Mitigation:* strip-ROI + fixed-point maps + warm-started half-res DIS + chunk parallelism, budgeted checkpoint on Clip04 at MVP end; pre-de-risked escape hatch = Metal port of warp/blend (shaders already exist in-repo).
4. **TC/sync edge cases** (offset spread differs per clip, frame-count drift 1632–1634 already observed). *Mitigation:* `plan` asserts lock ≤ 12-frame spread and exact 24/1 fps; exit 3 → pipeline publishes flagged hconcat fallback instead of silently misaligned stitch; manual `--offsets` override.
5. **Deliverable-claim gap:** proxies are bt709 2048-wide (not Log3G10/RWG), so the "pro" 3840×1920 master is proxy-sourced (still ~9k unique source px across the ring — resolution is fine; color claim is not). *Mitigation:* fix plate metadata to truth now; V3 R3D full-res re-render (same maps ×3 scale) is the path to the honest $8k/min master; watermark/label wording reviewed before publish.

**Key paths:** stitcher home `/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live/tools/` (with `calibrate.py`, `lens_library.json`) · pipeline `/Users/andrewroberts/Projects/the_plate_lab/meridian_public_site/pipeline/src/{ingest.ts, stages/renditions.ts, audit.ts}` · calibration `/Volumes/files/SpherisFootage/Roll01_Clip04/03:21:24_Mercy_Ptgui/{mercy01.pts, mercy01.jpg}` (local: `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/03:21:24_Mercy_Ptgui/`) · test footage `/Users/andrewroberts/Projects/spheris-smart-stitch/{Roll01_Clip04, Roll02_Clip09}` · Metal reference `/Users/andrewroberts/Projects/spheris-smart-stitch/Sources/Spheris360LiveStitchLib/{RemapCompute.metal, StitchShaders.metal, RemapGenerator.swift, CalibrationData.swift}`.