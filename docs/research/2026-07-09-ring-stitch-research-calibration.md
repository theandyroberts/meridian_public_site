# Spheris Calibration Story — Research Digest

**Repo note:** The path given (`/Users/andrewroberts/Projects/spheris-smart-stitch-live`) is a near-empty stub (only `config/calibration.json`, empty `recordings/`, `reference/`). The real, newest working copy (git, last commit Jul 8) is **`/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live`** — all findings below are from it. Two other stale copies exist: `/Users/andrewroberts/Projects/spheris-smart-stitch` (Apr 5 vintage, has the local footage dirs + an `Ingest/` dir) and `/Users/andrewroberts/Projects/UTK-PM-Guest-Lecture/spheris-smart-stitch-live` (Apr 10).

---

## 1. The .pts calibration format

`.pts` (JSON-shaped PTGui project) is the **only** on-disk calibration format; the old Spheris JSON was dropped (commit `cf7f288` "Drop JSON calibration format — PTS is now native"). Two schemas coexist, both parsed by `Sources/Spheris360LiveStitchLib/CalibrationData.swift`:

### Legacy schema (written by `tools/calibrate.py`)
Root keys: `ptguiversion: "12.0"`, `projectformat: 5`, `project {outputsize {w:3840,h:1920}, projection:"equirectangular", hfov:360, vfov:180}`, `imagegroups[{images[], lens{lenstype,hfov,a,b,c}, size}]`, plus `spheris` block. Per-image fields: `filename, width, height, include, lenstype:"rectilinear", hfov, yaw, pitch, roll, a, b, c, d, e`. The a/b/c/d/e values come from `lens_library.json` `typical_distortion`, which is **all zeros for every lens** — legacy files carry no real distortion.

### v33 schema (PTGui Pro 12.24 export; `config/calibration.pts` and `config/mercy01/mercy01.pts` are identical Mercy01 files, 2727 lines)
Root: `$schema: ...project_v33.schema.json`, `fileversion: 33`, `software: "PTGui Pro 12.24"`, `project`, `assets`, `spheris`. Inside `project`:
- `imagegroups[9]` — each has `size: [6144,3240]` (full 6K stills), `globallens` index, `position.params {yaw,pitch,roll,vpx,vpy,vpd,vppan,vptilt}` (viewpoint params all 0 on this fixed array), `images[0].photometric {flare, exposureoffset, whitepoint, globalcameracurve}`.
- `globallenses[2]` — `lens.params {projection:"rectilinear", focallength (mm), a,b,c, sensordiagonal: 30.56, mirrored}`, `shift.params {longside, shortside}` (principal-point shift), `shear`, `photometric.vignettingcoefficients[5]`.
- `globalcameracurves[1]` — `toning.luminancecurve {a:2.55, b:0.6}, saturationfactor: 1` (PTGui's curve formula undocumented; parsed but not applied).
- `panoramaparams {hfov:360, vfov:180, projection:"equirectangular"}`; `controlpoints`: 103 in Mercy01.

### Spheris extension block (both schemas, root-level `"spheris"`, survives PTGui round-trips since PTGui ignores unknown root keys)
```json
{"version":1, "rig_name":"Mercy01", "tool":"ptgui-12"|"spheris-calibrate v0.3",
 "created": iso8601, "sensor":{"width_mm":..., "height_mm":...},
 "cameras":[{"image_file":"A001_A001_0321VT.0000010.jpg","id":"A","lens":"Laowa 12mm Cine"}, ...]}
```
Maps camera letters A–J to image files and lens-library names. Without it, the Swift loader falls back to filename-first-letter convention.

### Mercy01 actual numbers (v33, `config/calibration.pts` == `config/mercy01/mercy01.pts`)
Per-camera geometry (degrees) and exposure offset (EV stops):

| Cam | lens | yaw | pitch | roll | expEV |
|---|---|---|---|---|---|
| A | 0 (12mm) | 0.0000 | 10.0489 | 0.4712 | +0.00662 |
| B | 0 | 59.6309 | 7.7839 | -1.4449 | -0.01249 |
| C | 0 | 120.8405 | 12.0641 | -1.1050 | -0.06480 |
| D | 0 | 179.6510 | 7.7520 | 0.6146 | -0.03100 |
| E | 0 | -120.8309 | 9.7649 | -0.3921 | -0.07626 |
| F | 0 | -59.7150 | 10.0252 | -0.0931 | -0.12285 |
| G | 1 (9mm) | 0.4136 | 51.5510 | 2.0280 | +0.21937 |
| H | 1 | 125.5112 | 53.0516 | 5.9931 | +0.02151 |
| J | 1 | -117.5247 | 51.8262 | 2.3794 | +0.05989 |

Lenses (PTGui-optimized):
- **lens[0] Laowa 12mm (ring A–F):** focallength 13.0222mm, distortion a=-0.0023213, b=-0.0105846, c=0.0557465; shift long=0.0121456, short=0.0002781; vignetting [-0.118567, -0.097496, -0.049981, -0.012291, +0.012505]. sensordiagonal 30.56mm → implied hFOV ≈ 92.1° at 27.03mm sensor width.
- **lens[1] Laowa 9mm (sky G/H/J):** focallength 9.8853mm, a=-0.0311194, b=0.1197776, c=-0.1392134; shift long=0.0094515, short=0.0168959; vignetting [-0.285718, -0.197118, -0.133473, -0.088006, -0.054122].

**Sensor discrepancy to be aware of:** the Mercy01 v33 spheris block records sensor 27.03×14.26mm (true Komodo 6K sensor, diag 30.56), while `calibrate.py` and `tools/lens_library.json` hardcode 22.56×11.88mm ("RED Komodo 6K Super 35"). Consequently calibrate.py's nominal hFOV is 86.46° (12mm) / 102.82° (9mm), f_px at 2048w = 1089.36 / 817.02, whereas PTGui's solved geometry implies ~92.1° hFOV for the ring. PTGui's values were optimizer-solved (fov/a/b/c flags true) and are the "gold" ones.

Distortion model per Swift comment (`CalibrationData.swift:559`): `r' = a·r⁴ + b·r³ + c·r² + (1−a−b−c)·r`. Vignetting applied in renderer as RGB ÷ V(r), V(r)=1 + c0r² + c1r⁴ + c2r⁶ + c3r⁸ + c4r¹⁰, r normalized to source half-diagonal. Exposure: RGB × exp2(offset). **Radial distortion is parsed but currently ZEROED in `RemapGenerator.swift` (SIMD4(0,0,0,0))** — PTGui's exact polynomial convention isn't public; multiple attempts left single-pixel boundary artifacts. Tone curve and viewpoint parsed, not applied.

Legacy library examples (`config/library/`, all `spheris-calibrate v0.2`, 2048×1080, zero distortion, different yaw-zero than Mercy01 — A at ~-81.8°): `Roll01_Clip04_f89_full.pts` ring pitches 7.4–10.6, sky pitch ~49.1–49.9; `Laowa12mmCine-Laowa9mmCine_2026-03-24_imported.pts` sky pitch 54.8; `Roll02_Clip020_0329_full.pts` shows a **failed** run (rolls ±15.6°, ring yaw spacing broken) with its `_1` retry mostly sane. `config/archive/root-calibration-artifacts/calibration_clip09.pts` is an old BA-era output with per-camera hfov drifting 89.3–98.9° (the "scrambled BA" era).

## 2. calibrate.py stage-by-stage (`tools/calibrate.py`, 1070 lines, v0.3)

CLI: `python calibrate.py --input ./Roll02_Clip09/ [--output x.pts] [--frame 100] [--quality fast|full] [--no-preview] [--lens-horizontal "Laowa 12mm Cine"] [--lens-upward "Laowa 9mm Cine"] [--custom-lens-* "focal_mm,fov_h_deg"] [--list-lenses]`.

0. **Frame extraction** (`ensure_frames`): globs `*.mov` in input dir, ffmpeg (`shutil.which`) extracts frame N (default 100) as `-q:v 2` JPEG next to each MOV (`select=eq(n,100)`, 120s timeout per file). Skips if JPEGs for all 9 letters exist; force re-extract when `--frame != 100`.
1. **Load** (`load_images`): for each camera letter, first image file whose uppercase name starts with `LETTER + "0"` (so `A001_...jpg` matches; naming contract required). Hard-exits if any letter missing.
2. **SIFT**: `cv2.SIFT_create(nfeatures=20000, contrastThreshold=0.01, edgeThreshold=20)` (low threshold deliberately for sky overlap) via `cv2.detail.computeImageFeatures2`.
3. **Matching**: only the 18 hardcoded `OVERLAP_PAIRS` (ring 6, sky-horizontal 9: G↔A/B/F, H↔B/C/D, J↔D/E/F, sky-sky 3). BFMatcher L2 knn k=2, Lowe ratio 0.7, `cv2.findHomography` RANSAC reproj thresh 5.0, MIN_INLIER_MATCHES=15, confidence = inliers/(8+0.3·matches). Builds symmetric `MatchesInfo` for OpenCV-detail compatibility.
4. **Initial cameras**: hardcoded `CAMERAS` table (identical to the Mercy01 numbers above, rounded to 0.1°), focal from lens library mm → px, principal point at image center, R from Y·X·Z yaw/pitch/roll.
5. **Bundle adjustment: DISABLED.** `run_bundle_adjustment` just logs initial geometry. Docstring: hardcoded values "already accurate to within 0.05° of the gold standard calibration. OpenCV's BA produces 80°+ errors that require heavy post-processing (wave correction, clamping, global yaw removal) and still ends up 5° off."
6. **Optical-flow refinement** (`refine_with_optical_flow`, default 5 iterations): each iteration warps all 9 grayscale images to a 3840×1920 equirect (pure numpy inverse mapping + `cv2.remap`); per overlap pair: requires ≥500 overlap px; bbox-crops patches; fills non-overlap pixels with mean gray (prevents Farneback locking to black); **CLAHE clipLimit=3.0 tile 8×8** (featureless sky/uniform surfaces); Farneback (`pyr_scale=0.5, levels=5, winsize=21, iterations=7, poly_n=7, poly_sigma=1.5, GAUSSIAN`); outlier rejection >2σ from median, needs ≥50 surviving samples; median dx/dy → Δyaw = dx·(360/3840)°, Δpitch = dy·(180/1920)° (so 1px ≈ 0.094°); skip pair if |flow| < 0.05px; weight = n_samples × flow magnitude. **Sky-horizontal pairs: 100% of correction to the sky cam (ring held fixed); same-tier pairs split 50/50.** Roll estimate stubbed at 0. Convergence: stop when no per-camera correction exceeds 0.001° or avg flow < 0.1px ("sub-pixel convergence").
7. **Sky refinement from feature matches** (`refine_sky_from_matches`): for each sky cam, gathers SIFT inliers from its sky-horizontal pairs (pair needs ≥8 inliers; ≥6 total points to proceed), unprojects horizontal-cam points to world rays using the *fixed* ring poses, then **coarse-to-fine grid search** minimizing mean reprojection error in the sky image: yaw/pitch ranges (±15° step 1.0 → ±2° step 0.1 → ±0.2° step 0.01), then roll (±2° step 0.2 → ±0.5° step 0.05 → ±0.1° step 0.01 — roll deliberately capped at ±2° because J's repeating bridge-arch patterns corrupt matches). Wide ±15° range exists "because rig geometry varies between shoots" (code comment ~line 740). Reported example in docs: sky RMSE improved 134px → 2px with 176 matches.
8. **Output**: writes legacy-schema `.pts` + spheris block. Auto-names into `config/library/{ClipDirName}_f{frame}_{quality}.pts` (non-clobbering `_1,_2` suffixes) and **mirrors to `config/calibration.pts`** as app default.
9. **Preview stitch** (optional): OpenCV detail spherical warp; `fast` ≈1s (50% scale, gain compensator, FeatherBlender), `full` ≈3min (native res, per-channel-blocks compensator, DpSeamFinder COLOR_GRAD at ≤400px scale, MultiBandBlender 7 bands) → `calibration_preview.jpg`.

**Error bounds — verification:** the "0.03° mean yaw / 0.06° pitch" claim is in CLAUDE.md/AGENTS.md line 87 ("What works well: Horizontal ring calibration: 0.03° mean yaw error, 0.06° pitch error vs gold standard") — documentation claim, not asserted in code. Code/docs corroborate: flow refinement "converges horizontal ring to within 0.1° of gold standard" (CLAUDE.md:57), initial geometry "within 0.05°" (calibrate.py docstring), **Farneback noise floor ~0.2–0.5px at 3840×1920** (≈0.02–0.05°) limits sky-cam flow convergence — which is why sky uses feature-match reprojection instead.

**Failure modes:** (a) featureless/overcast sky → zero sky matches → sky cams stay at initial ±flow-only (scene-dependent; needs bridges/buildings/trees in the sky-horizontal overlap); (b) J camera match corruption from repeating patterns; (c) parallax on close objects — rotation-only model cannot fix translation artifacts (the known enemy); (d) single-frame calibration — a bad frame choice (motion blur, no features) degrades everything, hence `--frame` and filenames embedding frame number (`Roll01_Clip04_f89_full.pts`); (e) evidence of a bad run shipped to library: `Roll02_Clip020_0329_full.pts` has ±15° rolls.

## 3. Ring vs sky stability across shoots

- **Ring: very stable.** Hardcoded initial ring geometry (from Mercy01) is "accurate to within 0.05°" of gold standard before refinement; refinement converges to 0.03°/0.06°. Ring pitches across shoot files stay in the ~7.4–12.1° band with consistent ~60° yaw steps. Ring cams are treated as the fixed reference frame (flow corrections for sky-horizontal pairs go 100% to sky).
- **Sky tier: unstable between shoots.** "Sky camera pitch varies significantly between shoots (~6° between Roll01 and Roll02)" (CLAUDE.md:63). Confirmed in files: Roll01_Clip04 sky pitch 49.1–49.9° vs the 2026-03-24 imported/Roll02 files at 54.8° vs Mercy01 at 51.6–53.1°. H roll is 6.0° in Mercy01, 0.64° in Roll01. Hence the ±15° grid search.
- **Yaw-zero convention changed between eras:** old Roll01/Roll02 files put A at ~-81.8°; current CAMERAS/Mercy01 puts A at 0. Old files remain valid via their own values (CLAUDE.md:62).
- Organizationally (MVP_KANBAN.md, MLS_BUILD_KANBAN.md issue #5): calibration is a **per-job template**, copied to `_CALIBRATION/calibration_<sha>.pts` with SHA-256 in `manifest.json`; each take's sidecar records the active template; switching is blocked during recording. i.e., production expects one calibration per shoot/job, refreshed opportunistically — not per clip.

## 4. Can calibrate.py run per-clip during ingest?

**Yes, with caveats.** Dependencies (setup.sh): Python 3, `opencv-python-headless`, `numpy` (+`pyinstaller` only for bundling); ffmpeg on PATH; venv convention `tools/.venv/` (not present in this checkout — `setup.sh` creates it). The build even produces a **standalone PyInstaller `calibrate` binary** bundled into the .app (`build.sh` lines 59–75; `CalibrateRunnerPanel.swift` runs it with streamed output) — so the Plate Lab pipeline could ship/invoke a self-contained binary with zero Python setup.

Input needed from a drop of 9 MOVs: a single directory where each file's name starts with `{Letter}0` (actual convention `A002_A009_032364.mov` etc., matching `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/` and `Roll02_Clip09/`). Everything else is derived: frames are extracted by ffmpeg (default frame 100), lenses default to Laowa 12mm/9mm, output auto-named. Non-interactive, deterministic exit codes via `sys.exit(1)` on missing images/lens/ffmpeg.

Runtime: not documented end-to-end. Components: 9× ffmpeg single-frame extracts; SIFT 20K feats on 9× 2048×1080; 18 BF-knn matches; ≤5 flow iterations each doing 9 numpy equirect warps at 3840×1920 + 18 Farneback fields (the dominant cost — order tens of seconds to low minutes on Apple silicon); sky grid search is vectorized and fast. With `--no-preview` expect roughly 1–3 min/clip (estimate); `--quality full` preview adds ~3 min (documented in code), `fast` ~1s.

Per-clip risks for automation: single-frame dependence (would want retry with different `--frame` values when sky matches < threshold — the log already exposes per-pair inlier counts and sky RMSE); side-effect of mirroring output to `config/calibration.pts` (harmless but global-state-ish); JPEGs written next to source MOVs; legacy output carries **zero distortion coefficients** — for seam quality better than PTGui, ingest should prefer merging solved geometry into a Mercy01-style v33 template (real distortion + vignetting + exposure) or port the Mercy01 lens params into the per-clip output. Alternative supported flow: reuse the shoot-level `.pts` as-is (ring is stable) and only re-solve sky per shoot.

## 5. Other offline-stitch/export-relevant assets in the repo

- `Sources/Spheris360LiveStitchLib/RemapGenerator.swift` + `RemapCompute.metal` + `StitchShaders.metal` — the actual stitch math: precomputed equirect→(camera UV, blend weight) LUT (texture2d_array, 9 slices, RGBA16Float) + single fused fragment shader (weighted blend, exposure, vignetting, optional 3D LUT). Directly portable to an offline renderer.
- `Sources/Spheris360LiveStitchLib/CalibrationData.swift` — dual-schema (legacy/v33) .pts parser incl. shift, distortion, vignetting, EV, tone curve, viewpoint; `CalibrationLibrary.swift`, `CalibrationPickerPanel.swift`, `CalibrateRunnerPanel.swift` (in-app calibrate runner).
- **Planned parallax fix** (CLAUDE.md "Next major feature"): per-frame Metal compute flow-warp in overlap zones (~20–30% of pixels) before blending — "what Mistika's optical flow stitch does"; insertion point documented. Plus planned full-res ProRes 3840×1920 recording of the stitched output via AVAssetWriter. This is the exact roadmap for beating PTGui (static geometry + blend) on close-object parallax.
- `tools/generate_lut.py` + `config/luts/REDLog3G10_RWG_to_Rec709.cube` — RED log/gamut → Rec.709 33pt .cube (color pipeline for renditions).
- Meridian Media Manager (separate app in same repo): `Sources/MeridianMediaManager/`, `Sources/R3DMetadataBridge/`, `MeridianExportArtifacts.swift`, `MeridianRawMediaScanner.swift`; specs `docs/MERIDIAN_MEDIA_MANAGER_FEATURE_SPEC.md`/`_HANDOFF.md` — MMM generates stitched/proxy/thumbnail web assets; captured live-stitch and 9-grid recordings are explicitly *fallback* web assets only, metadata must flag fallback use.
- `docs/STOCK_CAPTURE_NAMING_CONTRACT.md` — canonical stock clip ID scheme (`SPH-STK-YYYYMMDD-LOCATIONSLUG-SEQ`, `Roll_001_Clip_001`, `CAM_01_ID_V_POS_A`) that must survive ingest → stitched asset → website catalog → purchase lookup; the Plate Lab ingest should key to this.
- `docs/MVP_KANBAN.md`, `docs/MLS_BUILD_KANBAN.md`, `docs/kanban-data.json` — calibration template lifecycle decisions; flow-warp/distortion-parity ranked as post-MVP quality experiments.
- `config/spheris.sqlite`, `camera_library.migrated.json`, `live_devices.migrated.json` — device/camera library state; `config/archive/root-calibration-artifacts/` — pre-overhaul calibrations (incl. the BA-era scrambled `calibration_clip09.pts`).
- Old repo copy `/Users/andrewroberts/Projects/spheris-smart-stitch/` additionally has an `Ingest/` directory and `03:21:24_Mercy_Ptgui/` (original PTGui project dir) inside `Roll01_Clip04/`.

Key file paths: `/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live/tools/calibrate.py`, `.../tools/lens_library.json`, `.../config/calibration.pts`, `.../config/mercy01/mercy01.pts`, `.../config/library/*.pts`, `.../Sources/Spheris360LiveStitchLib/{CalibrationData,RemapGenerator}.swift`, `.../setup.sh`, `.../build.sh`, `.../docs/STOCK_CAPTURE_NAMING_CONTRACT.md`.