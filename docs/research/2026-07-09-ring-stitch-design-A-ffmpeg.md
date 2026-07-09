# True Ring Stitch for Plate Lab Ingest — ffmpeg/CPU-first Architecture

**Verdict up front:** a static-LUT ffmpeg pipeline (precomputed xmap/ymap PGMs from mercy01.pts + cascaded `maskedmerge` with precomputed feather/seam masks) gets to PTGui-template visual parity (minus multiband) at ~2–5 fps on the M2, finishing the 7-clip catalog in ~1.5–5 h. It **cannot** beat PTGui on parallax — nothing static can hide 60–120 px near-field disparity. The flow bolt-on (V3) swaps the ffmpeg blend graph for a rawvideo-piped NumPy/OpenCV loop that consumes the *same* prep artifacts and adds per-frame DIS flow morphing in overlaps; that is the rung that beats PTGui. Everything below is drivable from the existing TS pipeline as one idempotent CLI stage. Verified on this machine: ffmpeg 8.0 `remap` exposes only `format`/`fill` (**nearest-only, uint16 integer maps** — no interp option), `maskedmerge` present with slice threading, `prores_videotoolbox`/`prores_ks` both available.

---

## 1. Components & data flow

```
mercy01.pts (v33, gold)         9× ProRes proxies (2048×1080, TC-locked ±4f)
      │                                    │
      ▼                                    │
[A] stitch-prep (Python, numpy-only V1) ◄──┤  (ffprobe TC tags, sample frames)
      │  emits: xmap/ymap_{A..J}.pgm (gray16, out-res × SS)
      │         cascade_mask_{2..9}.pgm, gains.json, trims.json
      │         prep_manifest.json (sha256 of pts + params + TCs)
      ▼
[B] stitch-run (TS builds + execs ONE ffmpeg process per clip)
      │  9 video inputs (trimmed per-cam) + 18 looped map stills + 8 looped masks
      │  remap ×9 → gain ×9 → maskedmerge cascade ×8 → lanczos downscale → encode
      ▼
   stitch/master/<sku>_equirect_3840x1920.mov  + stitch_manifest.json
      │
      ▼
[C] existing buildRenditions (drop.stitchedMaster path): band-crop, 2880-wide,
    watermarkFilter → site "stitched view"; encodeRingPano becomes fallback-only
      │
[D] stitch-qa (Python): seam-zone SSIM + flicker metrics + A/B reel → qa.json
```

Code lives at `pipeline/tools/spheris_stitch/` (Python package, pinned venv; optionally PyInstaller single binary like `calibrate` — build.sh precedent exists). TS stage `pipeline/src/stages/stitch.ts` shells out. Runtime deps: **ffmpeg (already required) + Python/numpy for prep**. OpenCV (`opencv-python-headless`) enters only at V2 (seam finding, prep-time) and V3 (flow engine).

## 2. Stage math / algorithms

### [A1] Calibration parse + LUT generation (the core)
Parse mercy01 v33 JSON directly (it's plain JSON; do NOT round-trip through hugin — modern .pts doesn't import). Per output pixel (at supersampled res, default 7680×3840):

1. `lon = ((x+0.5)/W)·2π − π`, `lat = ((y+0.5)/H)·π − π/2`; world ray `(cosλ·sinφ, sinλ, cosλ·cosφ)` — reuse the Spheris convention verbatim (+y = nadir, +z = yaw 0); `calibrate.py:warp_to_equirect` is the NumPy template and `CalibrationData.swift:188` defines `R = Ry·Rx·Rz`, upload `Rᵀ`.
2. `camRay = Rᵀ·ray`; reject `z ≤ 0`; `xn = x/z, yn = y/z` (tan space).
3. Ideal pixel radius: `f_px = focal_mm / sensordiagonal_mm · diag_px` (mercy01: 13.0222 mm, diag 30.56 mm → f_px at 2048×1080: 13.0222/30.56·2315.3 ≈ 986.6 for ring; 9.8853 → 749.0 for sky). `u_i = f_px·xn, v_i = f_px·yn`.
4. **PanoTools radial polynomial in the forward (pano→image) direction — no inversion needed**: `r = √(u_i²+v_i²)/(min(w,h)/2)`; `scale = a·r³ + b·r² + c·r + (1−a−b−c)`; `u_d = u_i·scale, v_d = v_i·scale`. This is where the Swift shader went wrong (tan-space radius) — do not copy it.
5. Principal shift: `u = u_d + w/2 + shift_long·w`, `v = v_d + h/2 + shift_short·h` (unit assumption **must** be settled by the validation harness, §2-A4). Reject outside `[2, dim−2]`.
6. Write `round(u)`, `round(v)` as 16-bit binary PGM (P5, maxval 65535); out-of-frame texels → `65535` (lands outside source → ffmpeg `fill=black`, and weight is 0 there anyway). Everything computed at 6144×3240 calibration space × exact 1/3 (aspect identical, verified 1.896:1 both).

Deterministic: pure numpy, no threads-order dependence, manifest records pts sha + generator version + all params.

### [A2] Photometric (gains.json)
V1: scalar per-cam gain `g_i = 2^(−EV_i)` from mercy01 `photometric.exposureoffset` (range +0.22…−0.12 EV), normalized to mean 1, applied via `colorchannelmixer=rr=g:gg=g:bb=g` post-remap. V2 adds: (a) per-shot least-squares gain solve — mean linear luma of each warped overlap on 24 sampled frames, minimize Σ(g_iŶ_i−g_jŶ_j)² + λΣ(g_i−1)², g_A≔1 (GainCompensator math, 9×9 solve, deterministic); (b) vignette correction `V(r)=1+c₀r²+…+c₄r¹⁰` (r/half-diagonal, mercy01 coeffs, sky worst at −0.29) baked as a per-cam **equirect-space gain map** encoded gain/2 in gray16, applied via `blend=all_mode=multiply` + `lutrgb=val*2` — two static-input SIMD filters, no per-pixel expressions.

### [A3] Blend masks — exact weighted average via maskedmerge cascade
Per-cam weight `w_i(x,y)` in source space (V1: the Metal recipe — `smoothstep(1.0,0.7,dx)·smoothstep(1.0,0.4,dy)` around principal point), sampled into equirect space through the LUT. Composite order A,B,C,D,E,F,G,H,J; precompute **cascade masks** `m_k = w_k / Σ_{j≤k} w_j` (0/0→0) as gray16 PGMs. Then `acc_k = maskedmerge(acc_{k−1}, warp_k, m_k)` reproduces the exact normalized weighted average `Σw_i·I_i / Σw_i` with 8 static-mask merges. V2 swaps radial weights for **locked content-aware seams**: aggregate cost `C = max_t(|ΔRGB| + |Δ∇|)` over 24 frames spread across the clip (temporal max ⇒ seam avoids anywhere anything *will* pass), DP min-cost path per overlap (`cv2.detail.DpSeamFinder COLOR_GRAD` at 0.25×), ownership map dilate + 80 px feather → same cascade-mask format. Runtime graph unchanged — that's the point.

### [A4] Validation harness (build once, run at every prep)
Warp the 9 calibration stills (6144×3240, on disk in `03:21:24_Mercy_Ptgui/`) through freshly generated LUTs and SSIM-compare against `mercy01.jpg` (18598×9299 reference, downscaled to match). This single test settles the a/b/c radius convention, shift units, and rotation signs empirically. Gate: SSIM ≥ 0.90 outside seam zones; on failure, bisect by rendering with a=b=c=0 (Laowa Zero-D ⇒ geometric error from dropping distortion is sub-2px — an acceptable degraded mode).

### [A5] TC trim (trims.json)
Per clip: ffprobe `timecode` tag per cam → common window = max start TC → min end; per-cam `skip_i` frames + common length `F` (Roll01_Clip04: skips A1 B3 C2 D2 E2 F1 G0 H2 J2, F=1631). Applied as `trim=start_frame=S:end_frame=S+F,setpts=PTS-STARTPTS` per input — frame-exact, deterministic, recomputed per drop.

### [B] Runtime ffmpeg graph (one process per clip)
35 inputs: 9 MOVs + `-loop 1` 18 map PGMs + 8 mask PGMs. Per cam:

```
[i:v] trim=start_frame=Si:end_frame=Si+F, setpts=PTS-STARTPTS,
      format=gbrp16le, scale=7680x3840:flags=lanczos [srcI];   ← SS=2 upscale-before-remap NOT needed;
```
— correction: supersampling is done by generating **maps at 2× output res** (source stays 2048×1080; remap does the magnification): `[srcI][xmapI][ymapI] remap=fill=black [wI]`, maps pre-converted `format=gray16le`. Then gain (`colorchannelmixer`), cascade: `[w1][w2][m2] maskedmerge [a2] … [a8][w9][m9] maskedmerge [pano2x]`, finally `scale=3840:1920:flags=lanczos, format=yuv422p10le` → encoder. Since `remap` is **nearest-only with integer maps**, the 2× supersample + lanczos downscale is what buys back sub-pixel smoothness (residual quantization ≈ 0.25 output px; without SS expect visible crawling on fine detail). `--supersample 1` exists for fast drafts.

Encode: default `prores_ks -profile:v 2` (bit-deterministic; record ffmpeg version + full argv sha in manifest); `--codec h264` (libx264 crf 12, fixed `-threads`) for smaller masters; `prores_videotoolbox` available as a speed escape hatch but excluded from the deterministic path (HW encoder output varies across OS builds). Nadir hole (< −19° elevation, no camera) stays black in the master; renditions crop above it.

**hugin bake-off (decision gate, not runtime):** render two 50-frame excerpts via generated `.pto` → `nona -g` → `multiblend`, as the static-stitch quality ceiling reference. It will look slightly better (sub-pixel warps + multiband) but costs ~1–3 s/frame plus ~9 TIFF writes/frame of intermediate I/O → 8–20 h/catalog + TBs of scratch; it only wins the runtime slot if the ffmpeg output shows unacceptable banding/aliasing that SS=2 + gains don't fix.

### [C] Renditions wiring
Stage sets `drop.stitchedMaster`; existing stitched-master branch in `renditions.ts` takes over (upgrade it from 960-wide to: `crop=3840:1152:0:384` (elevation +54°…−54° band, covers ring −19…+38° + sky overlap), `scale=2880:864`, existing `watermarkFilter` + PREVIEW_GRADE, libx264 CRF 30). `encodeRingPano` demotes to explicit fallback. Metadata: keep `stitchedResolution: 3840x1920` (now true); fix `colorPipeline` to bt709 for proxy-derived assets (probes prove proxies are 709, not Log3G10).

## 3. Calibration sourcing strategy
- **Gold:** `mercy01.pts` (PTGui Pro 12.24 v33, solved on Roll01_Clip04 6K stills; real distortion/shift/vignetting/EV; 103 CPs; the only calibration on the NAS). Resolution-independent after normalization; exact 3× proxy scale.
- **Per-roll, not per-clip:** ring is stable ≤0.1° across shoots — reuse everywhere. Sky (G/H/J) drifts up to ~6° pitch between rolls ⇒ **per-roll sky re-solve**: seed from mercy01, run `calibrate.py`'s flow + sky grid-search refinement (or one manual PTGui pass per roll, ~30 min) on a mid-clip frame; merge solved yaw/pitch/roll into a mercy01-derived .pts keeping lens/photometric blocks. Auto-retry with `--frame {50,100,300,600}` if sky inliers < threshold; if all fail, ship ring-band-only master (sky region black) + degraded flag rather than a scrambled sky (the Roll02_Clip020 ±15° roll failure is the cautionary tale).
- Every prep manifest and audit entry records `calibration_sha256` (matches the existing `_CALIBRATION/calibration_<sha>.pts` template convention from the kanban).

## 4. Pipeline placement, CLI, failure handling
**Placement:** new `stitch` stage in `ingest.ts` between `describePlate` and `buildRenditions`. Camera A stays the probed/checksummed master (stitched output is a *derived* artifact with its own sha in audit.jsonl); do not move it before `probe`.

**CLI (idempotent; JSON-line result on stdout, logs on stderr; exit 0 ok / 2 degraded-fallback / 3 hard fail):**
```
spheris-stitch prep --clip-dir D --pts P --out D/stitch --src-size 2048x1080 \
    --out-size 3840x1920 --supersample 2 --seam-mode radial|content \
    --gain-mode pts|solve [--force]
spheris-stitch run  --prep D/stitch/prep --out D/stitch/master/<sku>.mov \
    --codec prores|h264 --engine ffmpeg|flow [--dry-run] [--force]
spheris-stitch qa   --prep … --master … --naive … --out qa.json [--reel reel.mp4]
```
Idempotence: `prep` no-ops when `prep_manifest.json` input-hash (pts sha ⊕ params ⊕ per-cam TC/frame-counts) matches; `run` no-ops when `stitch_manifest.json` matches and output sha verifies. `--dry-run` prints the full ffmpeg argv (auditable, diffable).

**Failure handling:** missing cam letter / TC tag absent / TC spread > 2 s → degraded (zero-offset trim or fallback); ffmpeg nonzero exit or `|frames_out − F| > 2` → one retry then degrade; degrade = publish via `encodeRingPano` fake pano + `stitch_fallback: true` in audit (mirrors MMM's fallback-asset flagging) — **never block publish on stitch failure**. QA gate is advisory (flags for eyeball), not blocking.

## 5. QA / objective A/B evidence
`stitch-qa` computes, on 24 sampled frames + full-clip strips: (1) **seam-zone SSIM** — between the two contributing warped layers inside each overlap (alignment quality; compare vs naive hconcat where SSIM ≈ garbage); (2) **flicker index** — mean |Y_t − Y_{t−1}| inside seam strips minus the same in mid-camera control strips (temporal stability); (3) auto-assembled eyeball reel: `hstack` of 512-px crops centered on each seam, naive vs stitched (vs PTGui-frame reference for the calibration clip). Emits `qa.json` into audit. This is the harness that later proves V3 > PTGui on the 1–3 m parallax cases.

## 6. Compute estimate (7 clips ≈ 640–700 s ≈ ~16k output frames, M2 10-core)
Per frame at SS=2: 9× ProRes-proxy decodes (~15–25 ms aggregate), 9 remaps + 8 maskedmerges on 7680×3840 gbrp16 (~1.5–2.5 GB memory traffic ≈ 0.2–0.5 s), prores_ks encode (overlapped). Expect **0.8–2 fps → 2.5–5.5 h catalog**; SS=1 ≈ 3–5 fps → **~1–1.5 h**. Prep: ~1–2 min/clip (+~3 min/roll for sky re-solve). V3 flow engine: +6 DIS-FAST strips (~20–40 ms parallel) + NumPy composite ≈ 2–4 fps → **~1.5–3 h**. All comfortably "hours"; read from local scratch copy, not SMB, for retry cost and determinism.

## 7. V3 flow bolt-on — exact seam
The ffmpeg blend graph is a black box between "9 trimmed decoded streams" and "encoded pano"; V3 replaces only that box, keeping every prep artifact:
`ffmpeg decode ×9 → rawvideo pipes → Python worker: cv2.remap (float32 versions of the SAME maps — sub-pixel, fixes the nearest-only limitation for free) → per ring-overlap: DIS-FAST flow (prev-frame init, EMA λ≈0.8, confidence-gated to zero-flow where texture/consistency low) → half-flow morph of both layers (Mistika recipe) → cascade-mask composite (same masks) → pipe → ffmpeg prores_ks encode.`
Selected via `--engine flow`; same manifest/QA/audit contract. Upgrade path within V3: α-ramp warp across the overlap (Surround360 NovelView) if mid-overlap morph distortion shows. Note ffmpeg `remap` *can* technically take per-frame map videos, but 9 cams × 2 maps × gray16 × 3840×1920 ≈ 15 MB/frame/cam of map traffic makes the pipe-loop strictly better.

## 8. Honest ceiling vs PTGui
- **V1** beats naive hconcat immediately (real geometry, feathered overlaps, level horizon, sky tier) ≈ PTGui-with-feather. Visible vs PTGui: no seam routing, no multiband, ~0.25 px SS-residual shimmer.
- **V2** ≈ PTGui-template parity for video: locked content-aware seams + gains ≈ PTGui's seam+blend, minus multiband's last few percent on high-frequency seam texture. **Parallax ghosts at 1–3 m (60–120 px) remain** — identical to PTGui, because both are static. No ffmpeg-only configuration escapes this.
- **V3** is the only rung that beats PTGui: per-frame local correspondence absorbs near-field disparity; residuals shrink to occlusion-edge wobble. It exits "pure ffmpeg" but stays CPU-only OpenCV/NumPy, no GPU/Metal/VPS requirement.

## 9. Milestones (engineer-days)
- **MVP / V1 (~8 d):** LUT generator + mercy01.jpg validation harness (2.5) · prep CLI: trims/gains/radial masks/manifests (1.5) · ffmpeg graph builder + run CLI + idempotence (2) · TS stage + renditions 2880 band + audit + fallback (1.5) · catalog bake + tuning (0.5). Exit: all 7 clips published with true stitched previews.
- **V2 (~8–10 d):** temporally-aggregated locked seams + mask gen (2.5) · gain solve + vignette multiply chain (1.5) · qa CLI + A/B reel + thresholds (2) · per-roll sky re-solve automation + retry ladder (2) · nona/multiblend reference excerpts + decision (1). Exit: seam-zone SSIM ≥ PTGui-template reference on calibration clip; zero visible banding.
- **V3 (~9–12 d):** pipe-loop engine + float remap (2) · DIS + EMA + confidence gating + morph (4) · perf/parallelism (1.5) · QA extension + parameter sweep on worst parallax clip (2.5). Optional +2–3 d: 6K master path (same generator, `--src-size 6144x3240 --out-size 7680x3840`; R3D decode via Resolve render remains an upstream manual step). Exit: A/B reel shows near-field objects crossing seams ghost-free where PTGui reference ghosts.

## 10. Top 5 risks & mitigations
1. **PTGui v33 convention misreads (a/b/c radius normalization, shift units, sign conventions).** Mitigation: the mercy01.jpg validation harness is built *first* and gates every prep; degraded fallback = zero distortion (Zero-D lenses ⇒ ≤~2 px error).
2. **Sky-cam pose drift per roll (~6°) → broken zenith on 6 of 7 clips.** Mitigation: per-roll re-solve seeded from mercy01 with frame-retry ladder; hard floor = ring-band-only master + degraded flag; QA sky-overlap SSIM gate.
3. **ffmpeg remap nearest/integer maps → aliasing crawl.** Mitigation: 2× map supersample + lanczos down; measured on 300-frame excerpt before committing; escape hatch = V3 engine's float32 `cv2.remap` (can be pulled forward independently of flow).
4. **Throughput/miss on "hours" (M2, 16k frames, SS=2, prores_ks).** Mitigation: benchmark excerpt first; knobs = SS=1, h264 masters, per-clip parallelism (clips are independent; 2 concurrent runs fit M2 memory), local scratch instead of SMB.
5. **Expectation gap: "$8k/min pro stitch" vs V1/V2 parallax ghosts.** Mitigation: previews keep the existing "PRO STITCH ON DELIVERY" watermark framing; seam routing (V2) hides the common cases; V3 is the funded path to the claim; per-clip seam-yaw offsets (regenerate cascade masks with rotated seam placement) as a cheap manual rescue for a persistent near object on a specific clip.

**Key paths:** calibration `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/03:21:24_Mercy_Ptgui/mercy01.pts` (+ NAS twin `/Volumes/files/SpherisFootage/Roll01_Clip04/…`), reference pano `…/mercy01.jpg`, NumPy warp template `/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live/tools/calibrate.py` (`warp_to_equirect`), rotation/convention source `…/Sources/Spheris360LiveStitchLib/CalibrationData.swift`, integration targets `/Users/andrewroberts/Projects/the_plate_lab/pipeline/src/ingest.ts` and `…/pipeline/src/stages/renditions.ts`, test footage `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04` and `…/Roll02_Clip09`, ffmpeg `/opt/homebrew/bin/ffmpeg` (8.0; remap=nearest-only confirmed, maskedmerge + prores_ks/prores_videotoolbox confirmed).