All tests complete. Both renders confirm the warp bows and compresses as it must. Compiling the digest.

# EMPIRICAL WARP TEST — Spheris calibrate.py math on real Roll01_Clip04 footage

## Environment / commands
- Python: `/Users/andrewroberts/Projects/spheris-smart-stitch/tools/.venv/bin/python` (has cv2 4.13.0, numpy 2.4.3 — usable as-is).
- Frames: `ffmpeg -v error -ss 5 -i "<mov>" -frames:v 1 -y camA_5s.png` on `A001_A004_0323U7.mov` and `B001_B004_121755.mov` (movs are 2048x1080 ProRes proxies, 24fps; same 1.8963 aspect as the 6144x3240 calibration stills).
- Test harness (kept, rerunnable): `scratchpad/run_warp_test.py`.

## 1. Calibration extracted from mercy01.pts
File: `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/03:21:24_Mercy_Ptgui/mercy01.pts` — **PTGui Pro 12.24 JSON project (project_v33 schema), NOT classic `o`-line PTO**. Schema interpretation required:
- Rotation: `project.imagegroups[i].position.params.{yaw,pitch,roll}` (deg).
- Lens: `project.globallenses[k].lens.params.focallength` (mm) + `sensordiagonal`=30.56mm → sensor 27.03x14.26mm for 6144x3240 (true RED Komodo 6K), so `f_px = f_mm/27.03*6144`.
- Shift d/e: `globallenses[k].shift.params.{longside,shortside}` — **both are fractions of the LONG side** (verified empirically below; normalizing shortside by H instead of W triples CP error).
- Control points: `project.controlpoints[] = {"t":0,"0":[imgIdx,subIdx,x,y],"1":[...]}`, pixels in 6144x3240 space; 103 points, all t=0.

| cam | lens | yaw | pitch | roll | f_mm | f_px@6144 | hfov | vfov |
|---|---|---|---|---|---|---|---|---|
| A | 0 | 0.000 | 10.049 | 0.471 | 13.022 | 2959.8 | **92.13°** | 57.39° |
| B | 0 | 59.631 | 7.784 | -1.445 | " | " | " | |
| C | 0 | 120.840 | 12.064 | -1.105 | " | " | " | |
| D | 0 | 179.651 | 7.752 | 0.615 | " | " | " | |
| E | 0 | -120.831 | 9.765 | -0.392 | " | " | " | |
| F | 0 | -59.715 | 10.025 | -0.093 | " | " | " | |
| G | 1 | 0.414 | 51.551 | 2.028 | 9.885 | 2246.8 | 107.64° | 71.58° |
| H | 1 | 125.511 | 53.052 | 5.993 | " | " | " | |
| J | 1 | -117.525 | 51.826 | 2.379 | " | " | " | |

- lens0 (horizontal): a=-0.002321 b=-0.010585 c=0.055747, shift d=+0.012146·W=+74.6px, e=+0.000278·W=+1.7px. lens1 (sky): a=-0.031119 b=0.119778 c=-0.139213 (NOT negligible), shift d=+58.1px e=+103.8px. Vignetting coefficients also present in .pts (unused by live path).
- Pano: equirectangular 360x180.

## 2. Structural discrepancies found (parameters, not warp math)
1. **Focal is wrong in the as-written pipeline.** `calibrate.py` hardcodes `SENSOR_WIDTH_MM=22.56` and uses nominal lens f (Laowa 12mm, lens_library.json claims 86.5x52.7). PTGui's own solution: sensor 27.03mm wide (diag 30.56 ✓ real Komodo 6K), f=13.022mm → **true hfov = 92.13°, not 86.5°**. As-written f_px is 10.4% too long (1089.4 vs 986.6 px at 2048 width). The "86.5°" spec is only self-consistent with the fictitious 22.56mm sensor.
2. **Hardcoded CAMERAS rig geometry contradicts the PTGui solution, and BA is disabled** (`run_bundle_adjustment` returns initial cameras unchanged). Hardcoded relative yaws: A→B 54.6°, B→C 53.3°, C→D 54.5°, D→E 54.1°, **E→F 89.1°**, F→A 54.4°. PTGui measured: 59.63, 61.21, 58.81, 59.52, 61.12, 59.72 (near-even hexagon). Per-seam errors of 5–8°, one of 28°. With 86.5° tiles and an assumed 89.1° E→F gap the model even predicts a 2.6° coverage hole there.
3. Distortion a/b/c and shift d/e are discarded by the live path; shift alone is ~75px at 6144 (~25px in proxy), and lens1's a/b/c are large.

## 3. Warp renders (all in scratchpad, 3840x1920 canvas, as-written math replicated verbatim from `warp_to_equirect` calibrate.py:394)
- `01_camA_equirect_aswritten.png` — cam A alone (as-written f=1089.36px, hfov 86.46°, hardcoded ypr A=-81.7/10.1/-0.7).
- `02_camA_camB_50pct_overlap.png` — A+B, 50% alpha in mask intersection. Content roughly continues across the seam; tiles clearly warped (arched tops, bowed bottoms).
- `03_camA_checker100_warped.png` (+ `03b_camA_checker100_source.png` source) — 100px checkerboard+grid burned in, then warped.
- `04_camA_checker_focal1p5x.png` — deliberate 1.5x focal (f=1634px, hfov 64.15°): visibly flatter, near-rectangular tile — the "near-identity" look.
- `05_camA_checker_ptgui_focal.png` — same but with PTGui-derived focal (f=986.6px, hfov 92.13°).
- Sources: `camA_5s.png`, `camB_5s.png`.
- Incidental: as-written code maps invalid dest pixels to source (0,0) and relies solely on the mask; canvas outside the mask is filled with whatever pixel (0,0) holds.

## 4. Deformation measurements (as-written warp, cam A)
- **The warp is emphatically NOT identity.** Checkerboard shows bowed horizontals and edge compression exactly as a rectilinear→equirect warp must.
- Width at equator row (v=960): **913px** vs expected ~923px for 86.5° (deficit explained by the +10.1° pitch putting the equator below the optical axis). Max row width 986px at row 677. PTGui-correct focal gives 973px at equator / 1054px max (6.7% wider). 1.5x-focal control: 676px.
- Bowing: bottom edge bows **down 420px at tile center** vs corners (713/1133/702); top edge rises ~95px at center (675/572/665). Vertical mask extent: 562px at center column vs 309/357px at left/right edges — ~40% edge compression.
- Conclusion: if the on-set output "never stretched anything," the live Metal path could not have been evaluating this math with these parameters — the math itself visibly warps.

## 5. Control-point reprojection RMS (all 103 CPs → 3840x1920 equirect; 1° = 10.67px)
| model | RMS | median | max |
|---|---|---|---|
| As-written calibrate.py params (hardcoded ypr, f via 22.56mm, no dist/shift) | **90.4px = 8.48°** | 41.8px | 352.6px |
| PTGui ypr+focal, centered pp, no dist/shift | 24.6px = 2.31° | 17.7px | 83.9px |
| + a/b/c + shift (shortside/H — wrong norm) | 12.7px | 9.5px | 45.6px |
| + a/b/c + shift (**both /longside — correct**) | **4.21px = 0.395°** | 1.92px | 17.0px |
- Per-pair with full model: horizontal-horizontal pairs 0.77–1.9px RMS (≈0.1–0.2°, i.e., PTGui's solution is reproducible to near-noise); sky pairs 2.3–5.7px; sky-sky (G-J 11.8, H-J 7.3) — residual pattern consistent with parallax (real inter-camera baseline, close subjects) plus possibly imperfect inversion of lens1's stronger polynomial.
- Convention search (32 variants tested): best = **rotation order Ry@Rx@Rz with pitch+/roll+ signs exactly as calibrate.py's `ypr_to_rotation_matrix`**, PanoTools polynomial `r_src = r·(a·r³+b·r²+c·r+(1−a−b−c))` with r normalized to min(w,h)/2, Newton-inverted for image→sphere, shift ADDED to the principal point. Flipping pitch sign → 44px; flipping shift sign → 37px; so the conventions are now pinned empirically.

## 6. VERDICT
- **`warp_to_equirect` in calibrate.py is geometrically correct and trustworthy as reference math.** Its equirect↔ray↔pixel conventions plus `ypr_to_rotation_matrix` reproduce PTGui's optimized solution to ~1–2 equirect px (≈0.1–0.2°) on horizontal seams once fed PTGui's actual parameters (correct focal, distortion, shift).
- **Everything feeding it is broken**: (a) focal derived through a fictitious 22.56mm sensor (true 27.03mm) and nominal 12mm (true optimized 13.02mm) → 10.4% focal error ≈ 2.8° per seam edge; (b) hardcoded rig yaws wrong by 5–28° with bundle adjustment disabled; (c) distortion and 75px principal-point shift discarded. Combined as-written CP error: **8.5° RMS** — cross-fade feathering would smear this into exactly the "soft but never aligned, never visibly re-warped" result described.
- **Day-1 validation gate for the new Python stitcher**: (1) tile angular width at equator within 1% of 2·atan(w/2f) using f from the .pts (f_mm/27.03·w_px), i.e. ~973px@3840 for lens0, not 922; (2) checkerboard warp must show ≥400px center-bottom bow and ~40% edge height compression for a +10°-pitched lens0 tile at 3840x1920; (3) CP reprojection RMS ≤ ~5 equirect px @3840 using .pts ypr+focal+a/b/c+shift (shift fractions both × long side); (4) never use lens_library.json FOVs or SENSOR_WIDTH_MM=22.56.

Files (all under `/private/tmp/claude-501/-Users-andrewroberts-Projects-the-plate-lab/99d9eefc-b8c1-4980-bea8-97a60ce8370d/scratchpad/`): `run_warp_test.py`, `camA_5s.png`, `camB_5s.png`, `01_camA_equirect_aswritten.png`, `02_camA_camB_50pct_overlap.png`, `03_camA_checker100_warped.png`, `03b_camA_checker100_source.png`, `04_camA_checker_focal1p5x.png`, `05_camA_checker_ptgui_focal.png`.