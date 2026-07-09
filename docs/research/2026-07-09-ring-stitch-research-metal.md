# Spheris Live Stitcher — Stitching Math & Pipeline Extraction

**Path correction:** the Swift/Metal source is NOT in `/Users/andrewroberts/Projects/spheris-smart-stitch-live` (that dir holds only `config/calibration.json` + one library calibration). The actual repo is `/Users/andrewroberts/Projects/spheris-smart-stitch` (git, branch `main`). Key files:
- `Sources/Spheris360LiveStitchLib/RemapCompute.metal` — the entire projection math (LUT generation kernel)
- `Sources/Spheris360LiveStitchLib/RemapGenerator.swift` — CPU-side dispatch + param packing
- `Sources/Spheris360LiveStitchLib/CalibrationData.swift` — JSON/.pts parsing, rotation matrix construction
- `Sources/Spheris360LiveStitchLib/StitchShaders.metal` + `StitchDisplayView.swift` — composite pass + grade
- `Sources/Spheris360LiveStitchLib/FrameGrabber.swift`, `RTMPStreamer.swift`, `FilePlaybackProvider.swift`, `VideoInputRouter.swift` — I/O
- `tools/calibrate.py` — calibration; contains a NumPy reference implementation of the identical warp (`warp_to_equirect`, line ~394)
- `CLAUDE.md` — architecture + flow-warp design notes; `mvp-status.html` — feature audit

---

## 1. Equirect-pixel → camera-UV math chain

Architecture: a one-time compute kernel `generateRemap` (RemapCompute.metal) bakes a `texture2d_array<half>` LUT, 9 slices, RGBA16Float, at output resolution (3840×1920). Each texel = `(nu, nv, weight, valid)`. The per-frame stitch shader only does LUT reads + weighted samples — all geometry is in the LUT.

**Rotation construction** (`CameraCalibration.rotationMatrix`, CalibrationData.swift:188): camera-to-world `R = Ry(yaw) * Rx(pitch) * Rz(roll)`, matrices built with `simd_float3x3(rows:)`:

```
Ry = [[ cos y, 0, sin y], [0,1,0], [-sin y, 0, cos y]]
Rx = [[1,0,0], [0, cos p, -sin p], [0, sin p, cos p]]
Rz = [[cos r, -sin r, 0], [sin r, cos r, 0], [0,0,1]]
```

World-to-camera `rotationInverse = R.transpose` — this (`R_inv`) is what's uploaded to the GPU. `tools/calibrate.py:ypr_to_rotation_matrix` is bit-identical (`Ry @ Rx @ Rz`); inverse `rotation_matrix_to_ypr` uses `pitch = asin(-R[1,2])`, `yaw = atan2(R[0,2], R[2,2])`, `roll = atan2(R[1,0], R[1,1])`.

**World coordinate convention:** +z = forward (yaw 0), +x = yaw +90° (right in equirect), **+y = nadir (down)**. Equirect row 0 (top) = zenith = ray (0,−1,0). Positive pitch looks up. Positive yaw pans right. Sky cams: pitch ≈ +54.8°.

**Full kernel pseudocode** (actual variable names, RemapCompute.metal):

```
// per output pixel gid, per camera slice
lon = ((gid.x + 0.5) / outW) * 2π − π                 // −π..π, left→right
lat = ((gid.y + 0.5) / outH) * π − π/2                // −π/2 (top/zenith) .. +π/2 (bottom/nadir)
ray = ( cos(lat)·sin(lon), sin(lat), cos(lat)·cos(lon) )   // world space
camRay = cam.R_inv * ray                              // world → camera
if (camRay.z <= 0) → write (0,0,0,0); return          // behind camera

xn = camRay.x / camRay.z                              // rectilinear normalized (tan-space)
yn = camRay.y / camRay.z

// PTGui radial polynomial: r' = a·r⁴ + b·r³ + c·r² + (1−a−b−c)·r
r = sqrt(xn² + yn²)
scale = (r > 1e-4) ? (a·r⁴ + b·r³ + c·r² + (1−a−b−c)·r) / r
                   : (1 − a − b − c)                  // limit r→0
xd = xn·scale;  yd = yn·scale

// pixel coords; PTGui d/e "shift" folds in as a PIXEL offset after focal scaling
u = cam.focal.x · xd + cam.principal.x + cam.distDE.x   // focal = (f_px, f_px), fx==fy
v = cam.focal.y · yd + cam.principal.y + cam.distDE.y

if u,v outside [margin=2 .. imageSize−2] → write (0,0,0,0); return
nu = u / imageSize.x;  nv = v / imageSize.y            // [0,1] sampling UV
weight = wx · wy                                        // see §2
write half4(nu, nv, weight, 1.0) to slice
```

- **Focal/principal:** native JSON carries `focal_length_px` directly (e.g. A: 1089.36) and `principal_point` (typically [1024, 540] = image center). `fx = fy = focalLengthPx`, no aspect term. On .pts import, focal is derived: `focalPx = width / (2·tan(hfov/2))`; principal forced to image center; sensor width 22.56 mm used only to compute display-only `focal_length_mm` — sensor dims never enter the projection.
- **Mirrored flag: does not exist** in this codebase (no mirroring anywhere; all 9 inputs assumed upright, unmirrored).
- **GPU struct layout** (`CameraParamsBuffer`, RemapGenerator.swift): `simd_float3x3 rotationInverse` (48 B, 3 columns × 16), `SIMD2<Float> focal`, `SIMD2 principal`, `SIMD4 distABC` (a,b,c,pad — matches Metal `float3` 16-B padding), `SIMD2 distDE`, `SIMD2 imageSize`, `SIMD2 outputSize`. Dispatch: 16×16 threadgroups, one dispatch per slice with `setBytes`.
- **Slice/slot order** (AppDelegate.swift:6): `gridSlotCameraIDs = ["G","H","J","A","B","C","D","E","F"]` — slot index = remap slice = fragment texture index `1+i`. MOVs matched to cameras by `image_file` prefix or first-letter.
- **Reimplementation caveat:** UV stored as float16 → ~1 px quantization at 2048-wide sources; an offline renderer should use float32 maps (e.g. cv2.remap maps) or recompute per pixel.
- **NumPy reference:** `calibrate.py:warp_to_equirect` implements the same chain (sign convention `lat = (0.5 − v/eqH)·π`, `dy = −sin(lat)` — same y-down world) minus distortion, using `cv2.remap` with per-camera `map_x/map_y`. Directly reusable for offline CPU stitching.

## 2. Blend weights & photometric

**Weight** (baked into LUT, RemapCompute.metal:86-96), computed in **source-image space** from distance of the landing pixel to the source principal point:

```
dx = |u − cam.principal.x| / (imageSize.x · 0.5)   // 0 center → 1 edge
dy = |v − cam.principal.y| / (imageSize.y · 0.5)
wx = smoothstep(1.0, 0.7, dx)   // reversed-edge smoothstep: ==1 for dx ≤ 0.7, →0 at dx=1  (30% feather)
wy = smoothstep(1.0, 0.4, dy)   // ==1 for dy ≤ 0.4, →0 at dy=1  (60% feather, wide for sky↔ring blend)
weight = wx · wy
```

**Composite** (StitchShaders.metal `stitchFragmentShader`): for each of 9 slices, `remaps.read(pos, slice)` (nearest read — `pos` from fragment position rescaled by `drawableW/H`), if `valid > 0.5`: bilinear-sample that camera texture (`filter::linear, clamp_to_edge`) at `uv`, accumulate `color += rgb·w; tw += w`; final `color /= tw`. Pure normalized weighted average — no multiband, no seam carving at runtime.

**Photometric — important:** there is **no per-camera exposure gain and no vignetting correction anywhere in the live pipeline** (grep-verified: zero hits for vignett/photometric). The only photometric ops are global, applied after blending, gated by `uniforms.lutEnabled`:
1. Exposure: `color += exposure · 0.1806` in REDLog3G10 code values (1 stop = 0.6·log10 2 ≈ 0.1806; Log3G10 B=0.6), clamped 0..1. UI: ±0.5 EV steps, clamped ±4 (`AppDelegate.applyExposure`).
2. 33³ 3D LUT (RGBA16Float `texture3d`, trilinear): REDLog3G10/REDWideGamut → Rec.709, generated by `tools/generate_lut.py` (Log3G10 decode A=0.091 B=0.6 C=155.975327, RWG→709 matrix, Rec.709 OETF), loaded from `.cube` by `LUTLoader.swift`.

**Toggle points:** `StitchDisplayView.lutEnabled` / `.exposure` (public vars; 'G' key toggles grade — exposure resets to 0 on toggle-off; 'L' toggles labels). Same uniforms mirrored to `VirtualCameraView`.

**Offline-only exposure handling exists in Python** (`calibrate.py:generate_preview_stitch`): OpenCV `ExposureCompensator` (GAIN fast / CHANNELS_BLOCKS full), `DpSeamFinder("COLOR_GRAD")`, `MultiBandBlender(bands=7)` (full) or `FeatherBlender(0.02)` (fast) — CPU, produces `calibration_preview.jpg`; none of it is in the live path. This is the in-repo template for a better-than-naive offline blend.

## 3. Distortion status

- **Model in shader:** PTGui quartic `r' = a·r⁴ + b·r³ + c·r² + (1−a−b−c)·r` + `d/e` pixel shift, fully implemented and applied unconditionally — but **every coefficient in every data file is 0.0**.
- **Why zeroed:** commit `6807522` (2026-03-24, "Switch distortion model from k1/k2 to PTGui a/b/c/d/e") replaced the original `dist = 1 + k1·r² + k2·r⁴` model and *"reset all existing calibrations to zero distortion (old k1/k2 values were rough guesses anyway). Ready for proper distortion tuning."* Tuning never happened. Also the lenses are Laowa "Zero-D" (near-zero distortion by design), so `tools/lens_library.json` `typical_distortion` is all zeros for every lens.
- **Conventions tried:** (1) k1/k2 radial (rough guesses, discarded); (2) current PTGui a/b/c form. **Latent convention mismatch:** the shader applies the polynomial to tan-space radius `r = √(xn²+yn²)` (r = tan θ); the comment claims "1.0 = image half-diagonal mapped to focal"; real PTGui normalizes r=1 at half the *smaller image dimension* in pixels. Nonzero coefficients copied from an actual PTGui project would need rescaling (`r_ptgui = r_tan · f_px / (min(w,h)/2)`) — untested with nonzero values.
- **Where coefficients survive:** `DistortionParams {a,b,c,d,e}` on `CameraCalibration` (JSON key `distortion`; legacy k1/k2 files decode to zeros via a tolerant `init(from:)`); packed into `CameraParamsBuffer.distABC/.distDE`; `.pts` importer passes PTGui a-e straight through; `calibrate.py` writes lens-library values to JSON but **hardcodes a=b=c=d=e=0 in its .pts export** (`write_ptgui_pts`).
- **Remaining artifact:** per CLAUDE.md the dominant residual is **parallax on close objects** (translation between the 9 camera centers — not fixable by rotation-only calibration or by distortion coefficients). No documented distortion-specific artifact; rotational alignment after flow refinement is 0.03° yaw / 0.06° pitch vs gold standard, so uncorrected lens distortion contributes only minor seam misalignment.

## 4. Headless offline renderer — what exists / what's needed

- **No AVAssetWriter anywhere.** mvp-status.html row: "No AVAssetWriter, no ProRes recording. Offline `flow_stitch.py` writes ProRes but live app has zero recording" — **`flow_stitch.py` does not exist anywhere on disk** (mdfind + find verified); treat that claim as stale/aspirational.
- **Existing render-to-texture/readback path:** `FrameGrabber.captureIfNeeded` — blits `currentDrawable.texture` into a `.managed` BGRA8 staging texture, `blit.synchronize`, then in `commandBuffer.addCompletedHandler` does `staging.getBytes` and hands raw BGRA `Data` to `onFrame` on a background queue. Currently feeds `RTMPStreamer`, which spawns `ffmpeg -f rawvideo -pix_fmt bgra -i pipe:0 …` — this exact pattern works verbatim for offline ProRes (`-c:v prores_ks`) by piping instead to a ProRes encode. Caveat: grabber is fps-throttled and copies `min(src, stream)` without scaling.
- **Zero-copy vs reusable:** CVPixelBuffer specifics are confined to input (`CVMetalTextureCacheCreateTextureFromImage` in `StitchDisplayView.updateFrames`) — inherently reusable since offline input is also decoded ProRes. `FilePlaybackProvider` already reads MOVs via `AVAssetReader` → `copyNextSampleBuffer` → BGRA CVPixelBuffers, and is pull-based; only the real-time pacing (`CVDisplayLink` at 1/24 s in `VideoInputRouter`) needs to be replaced with a synchronous per-frame loop.
- **Display coupling to remove:** `StitchDisplayView` is an `MTKView`; the render pass comes from `currentRenderPassDescriptor`/`currentDrawable`, and the fragment rescales `in.position.xy` by `drawableW/H` uniforms. Headless version: create an offscreen `MTLTexture` render target at LUT resolution (3840×1920) with a hand-built `MTLRenderPassDescriptor` (or convert the fragment to a compute kernel), set drawableW/H = LUT size, drop passes 2/3 (labels/tally — cosmetic overlays only).
- **Fully reusable as-is:** `RemapGenerator` (needs only `MTLDevice`), `CalibrationData` (+ `.pts` loader), `RemapCompute.metal`, the stitch fragment math, `LUTLoader`. Alternate reference: `VirtualCameraShaders.metal:sampleSphere` re-samples the same LUT per arbitrary ray (perspective reprojection) — useful if the storefront preview should render rectilinear driving-plate views rather than full equirect.
- **Pure-CPU alternative:** `calibrate.py` already contains everything for an ffmpeg/OpenCV offline pipeline (per-camera `warp_to_equirect` maps + exposure comp + DP seams + multiband blend), just currently single-frame.

## 5. Per-frame flow-warp compute pass (planned)

From CLAUDE.md "Next major feature":
- Metal compute shader, runs **per frame, before the stitch composite**; for each overlap zone, compute a displacement field between the two cameras' *warped* (equirect-space) views; warp pixels to align before blending; process only overlap zones (~20–30% of pixels). Explicitly modeled on Mistika's "optical flow stitch". Target hardware: M4 Mac mini.
- **Insertion point:** between `updateFrames()` (camera textures arrive) and `draw()` (stitch render). Design: compute dispatch reads camera textures + remap LUT, writes corrected textures to a scratch buffer; stitch shader samples scratch instead of raw camera frames. Hooks already present: `VideoInputRouter.latestCleanFrames` (kept "for seam optimization, etc.") and `StitchDisplayView.updateCalibration(remapTexture:)` for hot-swapping LUTs.
- Planned recording sits downstream: `Camera frames → Flow warp compute → Stitch render → Screen + Stream + ProRes disk (AVAssetWriter, 3840×1920)` so recordings bake the corrections.
- **Prior art (removed):** `SeamOptimizer.swift` (537 lines, deleted at commit `72e5c8c`, retrievable via `git show 72e5c8c^:Sources/Spheris360LiveStitchLib/SeamOptimizer.swift`) — content-aware seam placement: GPU LUT readback → 1/8-scale cost maps from inter-camera color difference in overlaps → min-cost DP seam path → ownership map → rewrite LUT weights with 80 px feather. Removed with the broken-BA overhaul; a "FlowAligner" is named in that commit message but never existed as a file in git history. The calibration-time Farneback flow (`refine_with_optical_flow`: 3840×1920 equirect warps, CLAHE, median flow → yaw/pitch deltas, noise floor 0.2–0.5 px, sky-horizontal corrections applied 100% to sky cams) is rotation-only, but is the in-repo template for computing overlap-zone flow fields.

## Calibration data locations (for offline use)

- Real per-shoot calibrations (v0.2 format, PTGui-style a-e distortion): `/Users/andrewroberts/Projects/spheris-smart-stitch/config/library/Roll01_Clip04_f*_full.json`, `Roll02_Clip020_*.json`, plus `/Users/andrewroberts/Projects/spheris-smart-stitch/calibration_clip09.json` and `/Users/andrewroberts/Projects/spheris-smart-stitch-live/config/calibration.json` (Roll02 gold: A yaw −81.7468, pitch 10.0961, roll −0.7, f=1089.36 px; output 3840×1920 equirect). `.pts` twins alongside each.
- Root `/Users/andrewroberts/Projects/spheris-smart-stitch/calibration.json` is an obsolete v0.1 placeholder (ideal 60°-spaced yaws, 90° hfov, k1/k2) — do not use.
- Local test footage (9 ProRes MOVs each): `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04`, `Roll02_Clip09` (also duplicated at `/Users/andrewroberts/Projects/ring_stitch/`); camera letter = filename first character.