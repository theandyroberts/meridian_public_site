# Spheris smart-stitch: git + docs archaeology digest

Repo: `/Users/andrewroberts/Projects/spheris-smart-stitch` — 29 commits on `main` (only branch, no stashes, reflog = linear history), 2026-03-23 → 2026-05-01. All commits co-authored by Claude. No kanban/issue files; docs = `CLAUDE.md` + `mvp-status.html` only.

## 1. Chronological table of stitch-related revisions

| Date | Commit | Files | What changed | Trying to fix | Domain |
|---|---|---|---|---|---|
| 03-23 | b1131df | initial | Entire app + `calibrate.py` (765 ln). RemapCompute lon/lat mapping, k1/k2 radial distortion, smoothstep feather weights all born here | — | geometry+blend+calib |
| 03-24 | 569779f | config/calibration.json | Hand-tweak sky yaws: G -88.5→-83.5, J 150→145 (±5°) | "improve alignment with horizontal ring" | angles only |
| 03-24 | bbea00e/1f82529/b9f9615 | UI + calibrate.py | Calibration library/picker UI | workflow | none |
| 03-24 | a05c182 | CalibrationData.swift | `.pts` import: `focalPx = width/(2·tan(hfov/2))`, principal forced to center, PTGui a/b/c **approximated** to k1/k2 with comment "For small values, c ≈ k1" | ingest PTGui calibrations | calibration (convention attempt #1) |
| 03-24 | 6807522 | RemapCompute.metal, RemapGenerator.swift, CalibrationData.swift, calibrate.py | Shader distortion switched k1/k2 → PTGui polynomial `r' = a·r⁴+b·r³+c·r²+(1−a−b−c)·r` + d/e pixel shift. **"All existing calibrations reset to zero distortion (old k1/k2 values were rough guesses anyway). Ready for proper distortion tuning."** | match PTGui convention (attempt #2) | geometry — then immediately neutralized |
| 03-24 | 84fba35 | RemapGenerator.swift | SIMD3+pad → SIMD4 for distABC (Metal float3 layout bug: dist params were being read garbled on GPU) | struct misalignment | geometry plumbing |
| 03-24 | 4f0203a | CalibrationData.swift, library | Old k1/k2 library files silently decode to **zero** distortion | crash on old files | calibration |
| 03-24 | bee8c3f/8cf7834 | library | Delete BA calibrations ("~180° roll values from bad BA convergence") + stale preview | bad optimizer output | calibration |
| 03-25 | d34049b…2fe2438 | StitchDisplayView etc. | RED overlay sim, crop engine, frame grabber full-res | UI/capture | none |
| 03-26 | a0c7461 | vps/app.py | Stream-viewer feedback archived per-clip as JSON **on the VPS** (`DATA_DIR/feedback/`) — none stored in repo | QA loop | none |
| 03-29 | e91c74f "mid model creation" | StitchShaders.metal + 20 files | Fragment shader: scale frag pos to remap dims (window-size fix), 3D LUT color grade + exposure; virtual camera views; 10 new library calibrations | display/color | blend/display only |
| 03-29 | 2eac82e | SeamOptimizer.swift (new, 537 ln), calibrate.py | Content-aware DP min-cost seam placement, **smoothstep 80px feathered blend, manual "Seams" button**; BA angle clamping "to prevent wild optimizer drift"; ffmpeg hang fix | visible seams | blending + calib guardrails |
| 04-05 | 72e5c8c | calibrate.py (414+/287−) | **Remove OpenCV BA entirely** (80°+ yaw errors); replace with hardcoded `CAMERAS` array + Farneback dense optical-flow refinement + sky feature-match grid search (±15°) | broken bundle adjustment | angles/calibration only |
| 04-05 | 8ad1923/2907047 | CLAUDE.md | Project context, planned ProRes recording | docs | none |
| 05-01 | b58758b | mvp-status.html | Spec-vs-code audit | docs | none |

That is ~10 rounds; the pattern is unmistakable (see §4).

## 2. Distortion-convention hunt — what's actually recorded

- **Attempt 1** (a05c182, 03-24): map PTGui a/b/c → k1/k2 via "c ≈ k1" small-value approximation.
- **Attempt 2** (6807522, same day, 3.5h later): implement PTGui polynomial natively in the shader; **reset every calibration to a=b=c=d=e=0**; commit promises "proper distortion tuning" that never appears in any later commit.
- **The unresolved convention bug is fossilized in the shader comment** (`RemapCompute.metal:50`): "r is normalized radius (1.0 = image half-diagonal mapped to focal)" — but the code applies the polynomial to `r = sqrt(xn²+yn²)` where xn,yn are **focal-normalized tangent coordinates** (r = tan θ), not PTGui's image-dimension-normalized radius. No commit ever tested or corrected this.
- **No "really close / 1px boundary artifact" notes exist anywhere in the repo** — not in commit messages, code comments, CLAUDE.md, or mvp-status.html. That saga lives only outside git (chat history).
- End state everywhere today: `lens_library.json` typical_distortion all zeros (10 lenses), `config/calibration.json` all zeros, every library .json/.pts all zeros, `calibrate.py` writes `"a": 0.0, "b": 0.0, "c": 0.0` unconditionally (`write_ptgui_pts`, line 846), and Python `warp_to_equirect` (line 389) **contains no distortion term at all** — pure pinhole K/R.
- **Structural find:** Swift `loadFromPTS` (CalibrationData.swift:41) parses only the homegrown pseudo-.pts that calibrate.py writes (root-level `imagegroups`, `outputsize.w/h`, per-image `hfov/yaw/pitch/roll/a/b/c`). A genuine PTGui v12 project (`mercy01.pts`: `project.imagegroups`, `globallenses` with `focallength`+`sensordiagonal`, relative outputsize) would throw `invalidFormat`. **PTGui's real optimized lens data was never importable into the app.** The "distortion coeffs zeroed after failed attempts to match PTGui" claim is confirmed, and the round-trip was always Spheris→Spheris.

## 3. Recorded complaints / QA notes

- Viewer feedback JSON lives on the VPS only (`vps/app.py` FEEDBACK_DIR); nothing local. No ghosting/seam complaints in-repo.
- CLAUDE.md "Known limitations": parallax on close objects ("unavoidable"), scene-dependent sky matches, J camera corrupted by repeating bridge arches. Notably it frames residual error as **parallax/rotation**, never as focal/distortion error.
- Commit-message admissions: "bad BA convergence" 180° rolls (bee8c3f); OpenCV BA "scrambled rotations (80° yaw errors)... 300 lines of post-processing... still left 5° residuals" (CLAUDE.md); "wild optimizer drift" (2eac82e).
- mvp-status.html: status tracking only; no stitch-quality findings.

## 4. Did geometry ever change? (the diagnostic asymmetry)

**No — confirmed by git.** `git log -G lon` on RemapCompute.metal hits only the initial commit: the **equirect lon/lat mapping, ray construction, pinhole projection, and centered-principal assumption were never revised in 43 days of iteration**. RemapCompute.metal was touched exactly twice ever (initial + distortion-model swap that was immediately zeroed). The feather weights (`wx = smoothstep(1.0, 0.7, dx)`, `wy = smoothstep(1.0, 0.4, dy)`) are byte-identical since the initial commit — never tuned once. The focal derivation is doubly frozen and **circular**: calibrate.py locks `focal = 12mm·2048/22.56 = 1089.36px`, writes hfov=86.4571° from that focal, and the Swift loader converts that hfov back to 1089.4px. Principal point is `(1024, 540)` in every calibration ever committed. All ~10 rounds twiddled: yaw/pitch/roll (569779f, 72e5c8c, hardcoded CAMERAS), optimizer machinery (BA→flow), blending (SeamOptimizer), and display/color — never intrinsics or projection math.

**PTGui gold contradicts the frozen intrinsics.** `mercy01.pts` optimized values: ring lens focallength **13.022mm** (nominal 12), sky **9.885mm** (nominal 9), sensordiagonal 30.56mm, nonzero distortion (ring: a=-0.00232, b=-0.01058, c=+0.05575; sky: a=-0.03112, b=+0.11978, c=-0.13921), per-image d/e shifts present, 103 control points. Derived (caveat: my computation from PTGui's focal+sensordiagonal on the 6144×3240 stills): PTGui effective hfov ≈ 92.1° vs the app's hardcoded 86.46° — roughly a **10% focal / ~6° per-camera FOV discrepancy the app could never express**, which yaw-twiddling cannot fix and which the wide feather cross-fade (plus float16 UVs) would smear into "soft but never warped-looking" output. PTGui per-image pitches (7.8–12.1°) do match the app's CAMERAS array, so the *angles* converged to gold while the *intrinsics* never could.

## 5. Ground-truth artifacts for A/B

| Path | What it is |
|---|---|
| `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/03:21:24_Mercy_Ptgui/mercy01.jpg` | **Gold standard**: PTGui full equirect render, 18598×9299 (exact 2:1), 84MB |
| `.../03:21:24_Mercy_Ptgui/mercy01.pts` | Genuine PTGui v12 JSON project — optimized focals, nonzero a/b/c, per-image y/p/r, 103 control points |
| `.../03:21:24_Mercy_Ptgui/{A..J}*.0000010.jpg` | The 9 source stills PTGui used, full-res 6144×3240 |
| `/Users/andrewroberts/Projects/spheris-smart-stitch/calibration_preview.jpg` | 5815×2737 OpenCV multiband preview from calibrate.py (2026-03-23 run) |
| `Roll01_Clip04/*.{jpg,mov}`, `Roll02_Clip09/*.{jpg,mov}` (also on NAS) | Per-camera 2048×1080 proxy footage + extracted stills, 9 cams each |
| `config/library/*.{json,pts}` (~14 profiles) + root `calibration*.{json,pts}` | Every historical calibration; all distortion zeroed, all principal=center, focals 1089.36/817.02 |
| `tools/calibrate.py::generate_preview_stitch` (line 870) | Regenerates `calibration_preview.jpg` — fast=FeatherBlender(0.02)@50%, full=MultiBandBlender(0,7) native |
| `reference/*.png` | RED camera UI overlay refs only — NOT stitch references |
| `/Users/andrewroberts/Projects/spheris-smart-stitch-live/` | Nearly empty: `config/calibration.json` + one library json dated 2026-05-01 (identical zero-distortion 1089.36px values); `recordings/` empty; **no** `config/mercy01/` or `config/calibration.pts` there (contrary to prior context) |
| App-rendered stitched stills/recordings | **None exist in either repo** — FrameGrabber captures to screen only; ProRes recording was planned, never built |

**Bottom line for trust assessment:** the lon/lat↔ray math in RemapCompute.metal and calibrate.py's `warp_to_equirect` are mutually consistent and plausible as reference, but the entire intrinsics layer (nominal-focal lock, centered principal, zeroed distortion, wrong-radius PTGui polynomial, PTGui-.pts loader that can't read real PTGui files) is untrustworthy and was never validated against `mercy01.jpg` in any recorded round. Day-1 gate: render one camera through the proposed warp with mercy01.pts intrinsics and difference it against the corresponding region of mercy01.jpg.