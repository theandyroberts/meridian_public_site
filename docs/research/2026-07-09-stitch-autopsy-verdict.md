# Spheris warp post-mortem: synthesis for the repo owner

First, the headline you need to internalize: **the warp math was never the problem, and "it never re-cropped or stretched anything" is false as a statement about the code.** Two independent re-implementations of your exact shader/Python math (NumPy port of `RemapCompute.metal`, verbatim rerun of `calibrate.py:warp_to_equirect`) produce heavily warped output — bowtie tiles, 420px checkerboard bow, 40% edge compression, 4x zenith smear. What you spent ~10 rounds fighting was a **parameter pipeline that fed the correct math garbage, plus a blend layer that erased the evidence.** Git confirms the asymmetry: `RemapCompute.metal`'s projection math was touched twice in 43 days (initial + a distortion swap immediately zeroed); every one of your revisions twiddled yaw/pitch/roll, optimizers, or blending.

---

## 1. Ranked root-cause hypotheses

**H1. Intrinsics were hand-locked wrong and frozen — focal ~10.4% too long, distortion zeroed, principal point forced to center. (Near-certain; primary cause of non-convergence.)**
- For: `calibrate.py` hardcodes `SENSOR_WIDTH_MM=22.56` (fictitious) and nominal 12mm → f_px 1089.36 / hfov 86.46°. PTGui's own bundle-adjusted solution in `mercy01.pts` says 13.022mm on a 27.03mm sensor (diag 30.56 = real Komodo 6K) → hfov 92.13°, f_px ≈ 987 at 2048. The derivation is circular (focal → hfov → focal) so it could never self-correct. Control-point reprojection: as-written params give **90.4px RMS (8.5°)** at 3840; PTGui focal alone drops it to 24.6px; full PTGui model to **4.21px**. PTGui shift = 74.6px @6144 (≈25px @2K source, ~11px output) discarded by forcing centered principal; lens distortion (c=+0.056 ring, large sky coeffs) zeroed on 03-24 with a commit promising "proper distortion tuning" that never happened. Your per-image *pitches* did converge to PTGui's values — angles were tunable, intrinsics weren't, so every round hit the same wall.
- Against: nothing. Every report independently converged on this.
- Cheapest discriminating test: already done and it discriminated — swap only f_px 1089→987 in the CP reprojection (`scratchpad/run_warp_test.py`): 90.4px → 24.6px RMS.

**H2. The .pts importer structurally cannot parse a real PTGui file — the correct calibration was unreachable by construction. (Confirmed, not a hypothesis.)**
- For: `CalibrationData.swift:41-133` requires root-level `imagegroups`, per-image `hfov`, absolute `outputsize.w/h`. Real PTGui v33 (`mercy01.pts`) has `project.imagegroups`, focal as mm in `project.globallenses[].lens.params` (no hfov field exists), relative outputsize → throws `PTSError.invalidFormat` at the first guard. The only .pts it parses is the fake one `calibrate.py:write_ptgui_pts` writes — a round-trip of its own wrong numbers, with a/b/c written as 0.0 unconditionally. `CalibrationLibrary.swift:39` additionally prefers .json over .pts with the same stem. So every "recalibrate in PTGui and import" round was Spheris→Spheris theater.
- Against: nothing.
- Cheapest test: one line — call `loadFromPTS(mercy01.pts)` and watch it throw.

**H3. Rig yaw geometry hardcoded wrong (5–28° per seam) with bundle adjustment silently disabled, including a genuine coverage hole. (Confirmed contributor.)**
- For: hardcoded `CAMERAS` seeds give ring gaps 54.7/53.3/54.5/54.1/**89.1**/54.4°; PTGui measured a near-even hexagon (58.8–61.2°). E→F gap 89.1° exceeds the (already wrong) 86.46° hfov → **−2.7° overlap, a black band near lon ±180°** (visible in `full_stitch_sim.jpg`). `run_bundle_adjustment` returns initial cameras unchanged after the 04-05 "remove OpenCV BA" commit.
- Against: pitches match PTGui well, so the flow-refinement partly worked — this is secondary to H1 (right yaws + wrong focal still can't align).
- Cheapest test: assert Σ(adjacent gaps)=360° and every gap < hfov. Fails instantly on E–F.

**H4. ~300px feather dissolves destroyed the iteration feedback signal — every misalignment rendered as faint ghosting, so revisions "looked like nothing changed." (Confirmed mechanism, not a geometry bug.)**
- For: `wx = smoothstep(1.0, 0.7, dx)` / `wy = smoothstep(1.0, 0.4, dy)` byte-identical since the initial commit, never tuned. Measured combined dissolve 200–340px at 3840. `full_stitch_sim.jpg` shows doubled power lines arcing across the sky — a 10–40px misregistration expressed as low-contrast double exposure instead of a hard seam you could measure.
- Against: it hides errors, doesn't cause them.
- Cheapest test: render one composite with hard binary nearest-camera masks. Seam discontinuities of 10–90px become instantly visible and measurable.

**H5. "Never looked warped" is a perception artifact of the preview path. (Likely explanation for the recollection; the only surviving explanation given H1–H4 are confirmed.)**
- For: horizontal tiles are uniformly minified ~2.2× (2048 source → ~930px tile), which reads as "scaled down" not "re-projected." `StitchShaders.metal:52-55` stretches the equirect anisotropically to any non-2:1 window and point-samples the LUT at small drawables — further disguising the warp signature. No app-rendered stills or recordings exist in either repo (ProRes recording was planned, never built), so the only thing you ever judged was this preview.
- Against: at full 3840×1920 the warp is unmissable (bowtie outlines, gridline bow), per the simulation.
- Cheapest test: fullscreen the app at an exact 2:1 drawable with a burned-in grid frame and compare against `tile_A_grid.jpg`.

**H6. Distortion radius-convention bug fossilized in the shader (would have bitten if tuning had ever happened). (Confirmed latent, moot in practice.)**
- For: `RemapCompute.metal:50` comment says r is image-normalized; code applies the PTGui polynomial to focal-normalized tan θ. Empirical convention search (32 variants) pinned the correct one: PanoTools `r_src = r(a·r³+b·r²+c·r+(1−a−b−c))` with r normalized to **min(w,h)/2**, Newton-inverted, shift **added** to principal, both shift fractions × **long side**. Moot only because coefficients were zeroed (H1).
- Cheapest test: push lens0 c=+0.0557 through both conventions and diff the displacement field.

**Exonerated:** float16 LUT quantization (max 0.50px, mean 0.17px — sub-pixel), rotation chain (R = Ry·Rx·Rz, transpose inverse — numerically verified, matches PTGui to 0.77–1.9px RMS on horizontal pairs once fed correct intrinsics), equirect loop and outputSize plumbing (correct full 360×180, 2:1, no band bug).

---

## 2. Verdict: trustworthy / indicted / unknown

**VERIFIED — safe reference for the Python stitcher:**
- `calibrate.py:warp_to_equirect` equirect↔ray↔pixel conventions and `ypr_to_rotation_matrix` (reproduce PTGui to ~0.1–0.2° on horizontal seams with correct params).
- `RemapCompute.metal` lon/lat loop (lines 26-27), ray construction, pinhole projection, rotation upload chain — mutually consistent with the Python and with PTGui.
- float16 UV LUT storage and linear source sampling.
- The empirically pinned PTGui v33 conventions (rotation order/signs as-written; shift longside/shortside both fractions of long side, added to pp; PanoTools polynomial with min(w,h)/2 normalization) — these are now measured facts, use them verbatim.

**INDICTED — do not carry one line of this forward:**
- The entire focal derivation: `SENSOR_WIDTH_MM=22.56`, nominal lens mm, `lens_library.json` FOVs, the circular focal↔hfov round-trip.
- Hardcoded `CAMERAS` yaws (esp. E–F 89.1°) and the disabled `run_bundle_adjustment`.
- Zeroed distortion, centered-principal assumption, discarded d/e shift, the silent zero-decode of old k1/k2 files.
- `CalibrationData.swift:loadFromPTS` in its entirety, and the .json-over-.pts library preference.
- The shader distortion radius convention (comment/code mismatch) and the historical "c ≈ k1" mapping.
- Feathering as configured — not wrong per se, but banned as a diagnostic environment.

**UNKNOWN — verify before trusting:**
- Sky lens (lens1) model quality: sky and sky-sky CP residuals are 2.3–11.8px vs sub-2px horizontal — parallax vs imperfect inversion of the stronger polynomial is unresolved.
- Vignetting coefficients (present in .pts, never used).
- `SeamOptimizer.swift` DP seam placement (never validated against correct geometry).
- Temporal sync / rolling shutter across the 9 cameras (never examined by any report).
- What the live app actually displayed on set — zero recorded renders exist, so H5 can't be retroactively proven, only inferred.

---

## 3. M0 validation gate for the new Python stitcher (day 1, all must pass before any blending code exists)

1. **Parser proof** — Load the real `mercy01.pts` (v33 schema: `project.imagegroups`, `globallenses`, `controlpoints`). Assert: 9 cameras; lens0 f=13.022mm, lens1 f=9.885mm; a/b/c nonzero; shift longside=0.012146; 103 CPs. Any parse failure or any zeroed coefficient = gate fail. *(Catches: H2, the silent-zero decode.)*
2. **Intrinsics provenance** — f_px computed only as `f_mm/27.03 × width_px`. Assert f_px@6144 = 2959.8 ±1% (hfov 92.13° ±0.25°). CI grep must show zero references to `SENSOR_WIDTH_MM`, `22.56`, or `lens_library.json` FOVs. *(Catches: H1 focal.)*
3. **Rig geometry** — Σ adjacent ring yaw gaps = 360.0° ±0.1°; every gap within [55°, 65°]; every gap ≤ hfov − 5°. *(Catches: H3, the E–F hole.)*
4. **Warp non-identity (checkerboard)** — Burn a 100px checkerboard into cam A, warp at 3840×1920 with .pts params. Assert: center-bottom bow ≥ 400px vs corners; edge-column mask height ≤ 65% of center-column height; equator tile width 973 ±10px (a flat, ~676px, or ~913px tile fails). Reference: `05_camA_checker_ptgui_focal.png` (pass) vs `04_camA_checker_focal1p5x.png` (the fail signature). *(Catches: H1, H5, any identity/near-identity warp.)*
5. **Control-point reprojection** — All 103 CPs, full model (ypr + f + a/b/c + shift/longside): RMS ≤ 5px @3840, median ≤ 2.5px, max ≤ 20px; horizontal-horizontal pairs ≤ 2px RMS. Sensitivity sentinels: flipping pitch sign must degrade RMS above 40px, flipping shift sign above 35px — if flips don't hurt, your conventions aren't actually being exercised. *(Catches: H6, shift normalization, rotation sign errors.)*
6. **Gold-image diff** — Warp cam A frame 0000010 alone; compare against the corresponding region of `mercy01.jpg` (18598×9299, exact 2:1): phase-correlation shift < 3px at 3840 scale, NCC ≥ 0.9 within the valid mask. This is the end-to-end check no recorded round ever ran. *(Catches: everything at once.)*
7. **Hard-mask composite** — Full 9-camera composite with binary nearest-angle masks, zero feathering. Measured seam discontinuity on distant content ≤ 4px. Feathering may not be enabled until this passes; feathering may never be widened to "fix" a seam. *(Catches: H4 — makes the H4 failure mode structurally impossible.)*
8. **Coverage map** — Valid-mask union spans all 360° of longitude at the equator with no hole (explicitly check lon ±180°); report and assert the expected bottom limit (~−16° lat with this rig). *(Catches: H3 hole; documents the known blind spot instead of discovering it in a dailies review.)*
9. **Invalid-pixel hygiene** — No dest pixel may silently map to source (0,0); out-of-frustum pixels must be masked, not defaulted. *(Catches: the incidental defect found in `warp_to_equirect`'s as-written remap.)*

---

## 4. What the empirical renders already PROVED (citable images, all in the session scratchpad; harness `run_warp_test.py` is rerunnable)

- **The as-written math warps, emphatically.** `full_stitch_sim.jpg`, `tile_A_grid.jpg`, `tile_G_grid.jpg` (Metal-path NumPy port); `01_camA_equirect_aswritten.png`, `03_camA_checker100_warped.png` vs `03b_camA_checker100_source.png` (calibrate.py path): 420px center-bottom bow, ~40% edge compression, bowtie outlines, 4× sky smear. "Never warped" is dead as a claim about the code.
- **Wrong (too-long) focal produces the "near-identity, just scaled" look.** `04_camA_checker_focal1p5x.png`: deliberately flatter, near-rectangular tile at 676px width — the visual signature consistent with what you remember seeing, in the direction the 1089-vs-987 error pushes.
- **Correct PTGui focal measurably widens the tile.** `05_camA_checker_ptgui_focal.png`: 973px equator width vs 913px as-written.
- **Feathering converts misregistration into invisible ghosting.** `full_stitch_sim.jpg`: doubled/ghosted power lines across 200–340px dissolve zones; `weight_map.jpg` shows the ramp widths.
- **Seams roughly continue even with wrong params** — which is exactly why tweaking never gave clear feedback: `02_camA_camB_50pct_overlap.png`.
- **The numbers**: as-written CP RMS 90.4px (8.5°) → 24.6px with PTGui ypr+focal → **4.21px (0.40°)** with the full PTGui model; horizontal pairs 0.77–1.9px. PTGui's solution is reproducible to near-noise by your own rotation/projection conventions. float16 LUT: 0.50px max error — exonerated.

**Bottom line:** keep the projection/rotation math as reference, burn the entire intrinsics/import/rig-seed layer, and never again develop stitching geometry under a 300px cross-fade. The single highest-leverage artifact you own is `mercy01.pts` + `mercy01.jpg` — a bundle-adjusted gold calibration and a gold render that sat next to the footage for 43 days without any recorded round ever diffing against either.