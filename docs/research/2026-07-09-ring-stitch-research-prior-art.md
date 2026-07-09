# Offline multi-camera 360 ring stitching that beats PTGui on parallax — prior-art & algorithm digest

## 1. Why PTGui-class stitchers leave parallax seams

PTGui/Hugin/nona compute **one static remap per camera**: a fixed geometric model (lens intrinsics + rotation, optionally a single global viewpoint) baked into a lookup table, then blend the warped images. That remap can only be exactly correct for scene points at **one distance** — the stitching/convergence distance `d_s`.

Geometry: adjacent lenses have baseline `b` between entrance pupils (for a 6-camera hexagonal ring of radius `r`, `b = 2·r·sin(30°) = r`). A point at distance `d` projects into the two cameras with an angular disagreement of approximately

```
Δθ ≈ b · |1/d − 1/d_s|   (radians)
pixel error ≈ px_per_rad · Δθ
```

Concrete numbers for the Spheris rig: Laowa 12mm on Komodo S35 (≈27mm sensor width) → HFOV ≈ 97° ≈ 1.7 rad over 2048 px → ≈1200 px/rad. With `r ≈ b ≈ 0.15 m` and stitch distance set to infinity:

- object at 1.5 m → ≈ **120 px** of double-image/shear at the seam
- object at 3 m → ≈ **60 px**
- object at 10 m → ≈ 18 px
- object at 50 m → ≈ 3–4 px (roughly invisible after blending)

So distant road/buildings stitch fine statically, but the exact content driving plates care about — poles, guardrails, passing cars at 1–3 m — misaligns by tens to >100 px. No amount of blending fixes a 60 px disparity: feathering gives ghosts, sharp seams give cuts. PTGui's per-image "viewpoint correction" is a single global adjustment (designed for handheld nadir patching), not per-object; and PTGui is a stills tool — video workflows apply one frozen template to every frame, so the misalignment is also frozen while the world moves through it. **Fixing parallax requires per-frame, per-pixel LOCAL correspondence in the overlap — i.e., optical flow or depth.**

## 2. Facebook Surround360 (open-sourced, archived)

Repo: [facebookarchive/Surround360](https://github.com/facebookarchive/Surround360) — 14/17-camera ring, C++/OpenCV pipeline in `surround360_render`. **Archived read-only Aug 31, 2021.**

Algorithm (relevant files: `source/optical_flow/OpticalFlow.cpp`, [`NovelView.h`](https://github.com/facebookarchive/Surround360/blob/master/surround360_render/source/optical_flow/NovelView.h)/`NovelView.cpp`):
1. Rectify each camera to a common projection; take the overlap strip between each adjacent pair.
2. Compute **bidirectional optical flow** L→R and R→L per pair, per frame. Their flow is a custom coarse-to-fine pyramid patch-match-style method with color+gradient data term, edge-aware smoothing, and initialization from the previous frame's flow (cheap temporal coherence). (No formal paper; see [issue #233](https://github.com/facebookarchive/Surround360/issues/233) — the algorithm exists only as code + blog post.)
3. **Novel-view synthesis**: for each output column between camera centers, synthesize the virtual view at interpolation parameter α by warping the left image by α·flow and the right image by (1−α)·flow, then blend the two warps (weights favor the nearer camera and flow-confidence). This turns the 6 discrete viewpoints into a continuous circle of virtual viewpoints — parallax is *absorbed* rather than hidden, because every output ray is synthesized as if captured from the correct position on the ring. This is exactly the mechanism that beats PTGui.

What it bought them: ghost-free stereo ODS output with moving close objects; seams effectively cease to exist (whole overlap is a synthesis region, not a blend line).
Cost profile: CPU-only, heavily multithreaded; historically ~30–60 s per stereo 8K frame pair on a 32-core Xeon; flow dominates. For mono, 6 overlaps at 2K it's far cheaper — the flow concept costs roughly "one dense flow per overlap per frame."
Reusability today: the repo builds against OpenCV 3.x + gflags/glog/folly; needs patching for modern compilers/OpenCV 4. The **optical-flow + NovelView module is fairly self-contained** and has been extracted by others; best treated as reference pseudocode — reimplementing the warp-by-α scheme on top of a modern flow (DIS/RAFT) is less work than resurrecting the build.

## 3. Mistika VR / Insta360 dynamic stitching

- **[Mistika VR](https://www.sgo.es/mistika-vr/)** (SGO): per-frame **optical-flow stitching** — computes flow in each overlap and morphs both sides toward agreement before blending; user controls include "Stitch Feature" density (~8–25 typical), flow depth, and manually keyframed **edge points** that locally push the seam off faces/objects ([workflow guide](https://www.immersiveshooter.com/2019/01/11/how-to-stitch-360-video-with-mistikavr/), [Meta creator docs](https://creator.oculus.com/create-build/stitching-with-mistika-vr/)). GPU-accelerated, near-real-time at 4–8K. It is the industry's proof that "static calibration + per-frame flow morph in overlaps" is the pragmatic sweet spot.
- **Insta360 Stitcher / Pro "dynamic stitching"**: same idea consumer-grade — recompute local alignment (template/flow based) in overlaps every frame instead of using the factory static calibration; fixes near-subject ghosting, occasionally "breathes" on textureless regions.
- Kolor Autopano Video (GoPro, discontinued) had a similar per-frame local-warp mode. None of these do true novel-view synthesis; they do **flow-driven mesh/pixel morphing inside the overlap**, which is visually sufficient for mono panoramas.

## 4. Google Jump (Anderson et al., *Jump: Virtual Reality Video*, SIGGRAPH Asia 2016)

[Paper](https://research.google.com/pubs/pub45617.html) ([blog](https://blog.google/products-and-platforms/products/google-ar-vr/jump-using-omnidirectional-stereo-vr-video/)). 16-camera GoPro ring → ODS stereo. Ideas worth stealing:

1. **Flow restricted to the stitching problem**: they estimate correspondence between adjacent cameras only, largely along epipolar (horizontal) direction — a 1D-ish search is faster and more robust than general 2D flow.
2. **Temporally coherent flow by construction**: data term computed per frame, but the solve includes the previous frame's flow as a prior/initialization, plus **edge-aware smoothing via the Fast Bilateral Solver** (Barron & Poole, ECCV 2016 — Barron is a Jump co-author). Result: flow that is smooth where the image is smooth, crisp at edges, and stable over time — the single biggest anti-flicker idea in the literature.
3. **Ray-space compositing, no seams**: every output ray is a weighted combination of flow-warped samples from *all* cameras that see it (weights by angular proximity), like Surround360's α-warp but formalized. Blending in the warped domain means exposure differences and residual flow errors fade smoothly.
4. **Engineering for hours of footage**: deliberately cheap discrete flow + filtering rather than variational solves; "processed millions of frames." The lesson: choose a flow whose cost you can pay 6× per frame, then spend the savings on temporal coherence.

## 5. Practical modern building blocks

**OpenCV `cv::detail` stitching pieces** (all exposed in Python as `cv2.detail`):
- `ExposureCompensator` — `GAIN`, `GAIN_BLOCKS`, `CHANNELS`, `CHANNELS_BLOCKS`. Per-image (or per-block) gain solved from overlap statistics; fixes vignette/iris mismatch banding. Cost: negligible (solve once per shot or once per second, not per frame — per-frame gains flicker).
- `GraphCutSeamFinder` (`COST_COLOR`, `COST_COLOR_GRAD`) — min-cut seam through the overlap avoiding high-difference pixels; run at reduced scale (0.1–0.3) or it's slow/memory-hungry. `DpSeamFinder` is a cheaper dynamic-programming variant; `VoronoiSeamFinder` is the trivial baseline.
- `MultiBandBlender` — Burt–Adelson Laplacian pyramid blending (5–7 bands typical). Hides exposure steps and small (<~5 px) misalignments; does nothing for large parallax.
- `cv2.remap` with precomputed maps + `convertMaps` (fixed-point) is the fast static warp: ~2–5 ms per 2K image per core.

**Optical flow options for 2K overlap strips (~500×1080 each, 6 pairs/frame):**
- **`cv2.DISOpticalFlow`** (Kroeger et al. 2016): the workhorse. Dense inverse search + variational refinement; presets ULTRAFAST/FAST/MEDIUM. On one modern CPU core roughly 5–15 ms (FAST) to 40–80 ms (MEDIUM) per overlap strip; dramatically better than Farneback on large displacements, and 6 strips parallelize across cores trivially. Handles the 60–120 px disparities if you set `finestScale`/pyramid appropriately or downscale 2× first.
- **Farneback**: ~50–150 ms per strip, mushy on large motion, poor at edges — dominated by DIS on both axes; skip it.
- **RAFT** (or RAFT-small / NeuFlow / SEA-RAFT): best quality, especially on occlusions and thin structures (poles!). ~10× slower than fast classical methods; on a desktop GPU ~50–150 ms per 1080p pair; on **Apple Silicon** run via CoreML/PyTorch-MPS at ~100–300 ms per pair at half res. Alternative on macOS: **Vision `VNGenerateOpticalFlowRequest`** (ANE/GPU accelerated, tens of ms) — pertinent given the Swift/Metal codebase in spheris-smart-stitch-live.
- Rule of thumb: DIS-FAST for the pipeline default, RAFT as a `--quality max` flag.

**ffmpeg pieces:**
- [`remap` filter](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_remap.c): takes 16-bit single-channel xmap/ymap video streams (PGM P2/P5 looped), `interp=nearest|bilinear` only — no lanczos, **integer-precision maps only** (no sub-pixel fractional maps → slight aliasing on fine detail), one input per remap → **no cross-input blending**; you must remap each camera then `overlay`/`blend`, and ffmpeg has no multiband blender and no per-frame map updates (maps are static unless you stream them). Good enough for rung (a); a dead end beyond that.
- `v360`: projection conversion (fisheye↔equirect↔cubemap etc.) for a **single already-stitched input**; useful for reprojecting the finished pano, not for stitching.
- **hugin toolchain as CLI**: `nona` (warps per `.pto`, GPU option `-g`, sub-pixel, outputs cropped TIFFs with alpha) → `enblend` (graph-cut-ish seam + multiband) or **[multiblend](https://horman.net/multiblend/)** (David Horman; same idea, simultaneous seam for all images, ~10×–300× faster than enblend, O(n) vs O(n²)) or `verdandi` (fast simple blend). A per-frame loop of `nona + multiblend` is a legitimate batch stitcher.
- **PTGui → hugin**: hugin can import **old-format** `.pts` (pre-JSON PTStitcher-style); **modern PTGui (v10+) JSON `.pts` files do not load**, masks/viewpoint never convert, circular crops are flaky ([hugin-ptx thread](https://groups.google.com/g/hugin-ptx/c/m7eEEWNPG24), [scripting wiki](https://wiki.panotools.org/Panorama_scripting_in_a_nutshell)). The JSON is readable though — extracting yaw/pitch/roll/fov/distortion per lens into your own map generator (or into a generated `.pto`) is a ~100-line script and the better path. Even better: you already have calibration tooling in spheris-smart-stitch-live — emit remap LUTs directly from that calibration and skip PTGui entirely.

## 6. Temporal stability (anti-flicker)

Per-frame decisions flicker; every production system adds hysteresis:
- **Flow smoothing**: initialize frame t's flow from t−1 (Surround360, Jump) — also a big speedup; then blend `flow_t = λ·flow_t + (1−λ)·flow_{t−1}` (λ≈0.7–0.9), or add a temporal term to the solve (Jump). Optionally low-pass only where the *image* is static (gate by frame difference) so genuinely moving objects aren't smeared.
- **Seam locking / seam hysteresis**: don't recompute graph-cut seams every frame. Either (i) compute the seam on temporally aggregated cost (max or mean of per-frame costs over a window — the seam avoids anywhere an object *will* pass), (ii) add a penalty term for deviating from the previous frame's seam labeling, or (iii) keep the seam fixed until overlap cost under the current seam exceeds a threshold, then cross-fade to the new seam over a few frames.
- **Exposure-gain smoothing**: solve gains per shot or filter per-frame gains with a long EMA — per-frame gain solves produce global brightness pumping.
- **Confidence-gated flow**: where flow confidence is low (textureless sky, motion blur), fall back to zero-flow static geometry rather than letting garbage flow wobble; blend the fallback smoothly. Sky is handled by the dedicated G/H/J cams anyway (sky is effectively at infinity → static stitch is fine there).
- Driving-plate bonus: forward motion makes overlap content flow *predictably* (mostly radial/horizontal); a Kalman/EMA on per-overlap median disparity gives a very stable "scene depth per seam" signal you can use to gate everything above.

## 7. Quality ladder for the ingest pipeline (6× 2048×1080 → ~8K×(~1080–2000) ring pano; costs per output frame)

| Rung | What | Visual outcome on driving plates | CPU (M-class, all cores) | Apple-Silicon GPU/Metal |
|---|---|---|---|---|
| (a) static remap + feather | precomputed LUT per cam (`cv2.remap`/ffmpeg remap), linear feather in overlaps | Distant scene fine; poles/guardrails/cars at 1–3 m show 60–120 px **double images** at all 6 seams; seams also visible as brightness bands | ~30–80 ms | <2 ms (trivial Metal kernel — the live stitcher already does this) |
| (b) + exposure/vignette comp | `GainCompensator`/`BLOCKS` solved per shot, applied in LUT or as per-cam gain | Brightness banding gone; parallax ghosts unchanged | +~0 (amortized) | +0 |
| (c) + graph-cut seams + multiband | `GraphCutSeamFinder` at 0.2× (with temporal cost aggregation), `MultiBandBlender` or multiblend at full res | Seams **route around** near objects when possible → poles survive if overlap has empty sky/road nearby; a car *filling* the overlap still shows a hard cut/pop; without seam locking, seams jump frame-to-frame | +0.3–1 s (multiband at 8K dominates; multiblend ≈2–4× faster than enblend) | multiband as Metal pyramid ≈ +5–15 ms |
| (d) + per-frame flow warp in overlaps | DIS (FAST/MEDIUM) per overlap pair, warp both sides half-flow toward each other (Mistika-style morph) or α-ramp warp across the overlap (Surround360-style); blend | **Ghost-free** near objects: passing cars slide through seams intact, guardrails continuous; residual artifacts only at occlusion boundaries/motion blur (brief edge wobble) | +60–300 ms (6 DIS strips, parallel); RAFT option: +1–3 s | DIS-equivalent or VNOpticalFlow ≈ +30–100 ms; warp ≈ free |
| (e) + temporal smoothing | flow EMA + prev-frame init, seam locking/hysteresis, gain lock | Removes the last visible defect class: **shimmer/breathing** at seams; output reads as single-camera | +~0 | +~0 |

Realistic totals at rung (d)+(e): **~0.5–1.5 s/frame pure-CPU Python/OpenCV** (a 30 s clip = 720 frames ≈ 6–18 min — acceptable for offline ingest), or **~50 ms/frame** if the warp/blend is pushed into a Metal kernel reusing the live-stitcher code, with only flow on CPU/ANE. Rung (d) with temporal coherence is exactly the Mistika/Jump recipe and is the point at which output should visibly beat PTGui-template stitches on the 1–3 m parallax cases; rungs (a)–(c) alone will not, because no seam placement can hide a 100 px disparity when the near object occupies the whole overlap.

**Recommended architecture for `pipeline/`**: calibration → per-camera remap LUTs (from spheris calibration or a generated hugin `.pto`), solve gains per shot, then per frame: remap (GPU/CPU) → DIS flow per overlap (prev-frame init, EMA) → morph-warp overlaps → locked graph-cut seams + multiband blend → encode. Surround360's `NovelView` α-warp is the upgrade path if the morph shows mid-overlap distortion.

Sources: [Surround360 repo](https://github.com/facebookarchive/Surround360) · [NovelView.h](https://github.com/facebookarchive/Surround360/blob/master/surround360_render/source/optical_flow/NovelView.h) · [Surround360 flow-algorithm issue #233](https://github.com/facebookarchive/Surround360/issues/233) · [Jump: Virtual Reality Video](https://research.google.com/pubs/pub45617.html) · [Google Jump blog](https://blog.google/products-and-platforms/products/google-ar-vr/jump-using-omnidirectional-stereo-vr-video/) · [Mistika VR](https://www.sgo.es/mistika-vr/) · [Mistika VR stitching guide](https://www.immersiveshooter.com/2019/01/11/how-to-stitch-360-video-with-mistikavr/) · [Meta: Stitching with Mistika VR](https://creator.oculus.com/create-build/stitching-with-mistika-vr/) · [Insta360 third-party stitching manual](https://onlinemanual.insta360.com/pro2/en-us/video/postproduction/7) · [NVIDIA optical-flow blog](https://developer.nvidia.com/blog/opencv-optical-flow-algorithms-with-nvidia-turing-gpus/) · [ffmpeg RemapFilter wiki](http://ves.scottexteriors.com/wiki-https-trac.ffmpeg.org/wiki/RemapFilter) · [vf_remap.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_remap.c) · [multiblend](https://horman.net/multiblend/) · [multiblend 2.0 announcement](https://groups.google.com/g/hugin-ptx/c/0yOq36ydCCM) · [hugin .pts import thread](https://groups.google.com/g/hugin-ptx/c/m7eEEWNPG24) · [PanoTools scripting wiki](https://wiki.panotools.org/Panorama_scripting_in_a_nutshell)