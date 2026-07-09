# True Ring Stitch for Plate Lab Ingest — Architecture (Swift/Metal Headless Reuse)

## 0. Decision summary

Add a headless SwiftPM executable **`spheris-render`** to the capture repo (`/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live`), reusing `Spheris360LiveStitchLib` (CalibrationData, RemapGenerator, RemapCompute.metal, stitch math) with a new offscreen compute-kernel composite and an AVAssetWriter ProRes sink. The TS ingest pipeline shells out to it as a new `stitch` stage; its output becomes `drop.stitchedMaster`, so `buildRenditions`'s existing stitched-master path produces the 2880-wide watermarked web preview and `encodeRingPano` (xstack hconcat) is demoted to fallback-only. Calibration = the PTGui-solved **mercy01.pts v33** (real distortion/vignetting/EV/shift), vendored + SHA-pinned; optional per-clip sky/flow re-solve via the existing `calibrate` PyInstaller binary. V3 adds the already-planned per-frame Metal flow-warp (Mistika-style) in ring overlaps — the parallax fix PTGui structurally cannot do (mercy01.pts viewpoint params are all 0).

Everything runs on the studio Mac (Apple Silicon, Metal, VideoToolbox ProRes); the VPS only receives uploaded renditions — unchanged.

---

## 1. Components & data flow

```
[NAS SMB / local originals: 9x ProRes422Proxy 2048x1080 MOV per clip]
        │  (stage copies to local scratch if reading from SMB)
        ▼
pipeline/src/stages/stitch.ts  (NEW, TypeScript, between discover and probe)
  ├─ resolves calibration: _CALIBRATION/calibration_<sha>.pts (mercy01 v33 template,
  │   optionally merged with per-clip calibrate.py re-solve)
  ├─ spawns: spheris-render (headless Swift/Metal CLI, see §3)
  │     ┌──────────────────────────────────────────────────────────────┐
  │     │ spheris-render                                               │
  │     │  1. parse .pts (CalibrationData.swift, v33 schema)           │
  │     │  2. ffprobe-equivalent TC scan → per-cam frame offsets       │
  │     │  3. RemapGenerator → RGBA32Float LUT (6 or 9 slices)         │
  │     │  4. loop: AVAssetReader x6 (lockstep, TC-trimmed)            │
  │     │      → [V3: flow-warp compute pass, overlap zones]           │
  │     │      → stitchCompute kernel (weighted blend + vignette/EV)   │
  │     │      → band crop → CVPixelBuffer → AVAssetWriter ProRes      │
  │     │  5. emit render-report.json (hashes, trims, metrics)         │
  │     └──────────────────────────────────────────────────────────────┘
  ├─ writes audit.jsonl entries (tool version, pts sha, input shas, metrics)
  └─ sets drop.stitchedMaster = _STITCHED/<clipId>_ring3840.mov
        ▼
probe → assignSku → sha256 → … → buildRenditions (existing stitched-master path,
   bumped 960→2880-wide + watermarkFilter) → uploadRenditions → publishPlate (VPS)
```

Metrics sidecar: `tools/seam_metrics.py` (OpenCV, CPU) computes seam-zone SSIM / flicker per clip for A/B evidence; invoked by the stage in `--verify` mode.

---

## 2. Math / algorithm per stage

### 2.1 Geometry (reused verbatim from RemapCompute.metal)
Per output pixel: `lon/lat → world ray (cosLat·sinLon, sinLat, cosLat·cosLon)` (+y = nadir) → `camRay = R_inv·ray` (`R = Ry·Rx·Rz`, `R_inv = Rᵀ`) → reject `z≤0` → tan-space `xn,yn = camRay.xy/z` → PTGui radial `r' = a·r⁴+b·r³+c·r²+(1−a−b−c)·r` → `u = f_px·xd + cx + shift` — all baked once into a LUT. **Offline change: LUT stored RGBA32Float, not 16F** (half UVs quantize ~1 px at 2048-wide sources; unacceptable when the whole point is sub-pixel seams). One LUT per clip (per calibration), generated in <100 ms, cached beside the output keyed by pts SHA.

### 2.2 TC alignment (new, in CLI)
Read each MOV's `tmcd` track. `startTC_common = max(startTC_i)`; `skip_i = startTC_common − startTC_i` (frames); `N = min(frames_i − skip_i)`. Validated vector: Roll01_Clip04 → skips A=1,B=3,C=2,D=2,E=2,F=1(,G=0,H=2,J=2), N=1631. Recorded in report; deterministic. Missing/contradictory tmcd → exit 3 unless `--allow-untimed` (zero offsets + `untimed:true` flag in report → surfaced in audit).

### 2.3 Photometric
Apply v33 per-image `exposureoffset` (RGB × 2^EV) and lens vignetting `V(r)=1+c0r²+…+c4r¹⁰` (divide), as the newest lib already parses/applies. **Skip the Log3G10→709 3D LUT**: the proxies are already bt709 (ffprobe-verified) — gate on `--input-color bt709|log3g10` so future 6K R3D-derived masters can re-enable it. Optionally solve one residual per-cam gain per clip (median overlap luminance ratio at frame N/2), solved once — never per frame (gain flicker).

### 2.4 Blend (MVP)
Existing LUT weight `w = smoothstep-feather(dist from principal)` normalized weighted average, ported from `stitchFragmentShader` into a compute kernel (drop drawable-scaling uniforms, label/tally passes). Ring-only render = 6 slices; sky cams optional via `--cams`.

### 2.5 Band crop
From the LUT: band = contiguous rows where `max_over_x(Σ ring weight) > 0` shrunk to rows where coverage is gap-free across all x (ring pitch ~8–12° up, vFOV ~57° → roughly equirect rows ~550–1170 of 1920, ≈3840×620). `--band auto` computes it and writes `bandY0/bandY1` into the report; `--band full` emits full 3840×1920 (sky rows black or sky-cam-filled) for the master deliverable path.

### 2.6 V3 flow-warp (per-frame local parallax correction — the beat-PTGui move)
Parallax at the 6 ring seams is `Δθ ≈ b·|1/d − 1/d_s|` → 60–120 px at 1–3 m; unfixable by any static model. Per frame, per adjacent ring pair (5–6 overlaps):
1. Render each cam's overlap strip to equirect space (LUT already gives this).
2. Bidirectional dense flow L↔R on the strip: **Vision `VNGenerateOpticalFlowRequest`** (ANE/GPU, native Swift) as default; OpenCV DIS (FAST/MEDIUM) via a small shim as the deterministic/audit fallback; RAFT-CoreML as `--quality max`.
3. Metal compute pass writes a per-frame **delta-UV texture**: cam L displaced by `+α(x)·flow`, cam R by `−(1−α(x))·flow`, α ramping 0→1 across the overlap (Surround360 α-warp / Mistika morph). Stitch kernel samples `LUT.uv + deltaUV` — zero change to blend logic.
4. Temporal stability: init flow from t−1, EMA `flow_t = 0.8·flow_t + 0.2·flow_{t−1}`, confidence gate (low-texture / high residual → decay deltaUV to 0 = static geometry), per-shot gain lock. This is the Jump/Surround360 anti-flicker recipe and directly matches the flow-warp design already written into the repo's CLAUDE.md (insertion point between frame arrival and composite; `refine_with_optical_flow` in calibrate.py is the in-repo Farneback template; deleted `SeamOptimizer.swift` at `72e5c8c^` is retrievable prior art for cost maps).

---

## 3. CLI interface (`spheris-render`)

New target `Sources/SpherisRenderCLI` in the capture repo's Package.swift, depending on `Spheris360LiveStitchLib`. Distributed to the product repo as a prebuilt signed binary `pipeline/bin/spheris-render` + `VERSION` + SHA-256 (CI builds on tag).

```
spheris-render \
  --pts <calibration.pts>            # v33 or legacy schema
  --clips <dir>                      # 9 MOVs, {Letter}0… naming contract
  --cams A,B,C,D,E,F                 # subset; default ring-6
  --out <clipId>_ring3840.mov        # written via tmp + atomic rename
  --size 3840x1920 --band auto|full|y0:y1
  --codec prores422hq|prores422|h264 # VideoToolbox
  --trim-tc auto|none
  --quality static|flow              # MVP | V3
  --flow-engine vision|dis|raft      # V3
  --input-color bt709|log3g10
  --report <render-report.json>      # also mirrored to stdout as last line
  --frames N --start-frame M         # smoke tests / golden frames
  --creation-date <iso8601>          # fixed, for reproducible containers
```

Exit codes: 0 ok · 2 missing camera file · 3 TC unresolvable · 4 calibration parse/validation · 5 encode failure · 6 GPU/device init. `render-report.json`: tool git describe, macOS build, pts sha256, per-cam input sha256 + skip frames, N frames, band rows, LUT hash, per-seam pre-blend SSIM (cheap, computed on every 24th frame), wall time. **Idempotency**: recompute the report key (hash of pts sha + input shas + args + tool version); if `--out` exists with matching key in its sidecar report → exit 0 without re-rendering (ProRes encodes aren't guaranteed bit-identical across OS updates, so idempotency is keyed on inputs, not output bytes).

### TS integration (`pipeline/src/stages/stitch.ts`)
- Placement: **between `discover` and `probe`** — probe/sha256 then run on the stitched master, making the currently-aspirational `stitchedResolution: "3840x1920"` metadata truthful. (Digest-sanctioned alternative — between describePlate and buildRenditions — loses that.)
- Invocation: `execa("pipeline/bin/spheris-render", args)`; parse the report; append `audit.jsonl` entry `{stage:"stitch", tool, version, ptsSha, inputShas, cliArgs, skips, frames, seamSSIM, wallMs, outSha}`. Copy the active `.pts` to `_CALIBRATION/calibration_<sha>.pts` per the existing manifest convention (STOCK_CAPTURE_NAMING_CONTRACT keys survive into the report).
- On failure: audit the failure, set `drop.stitchFailed`, fall back to `encodeRingPano` (kept alive as degraded path) so ingest never blocks publication.
- Renditions: stitched-master branch in `buildRenditions` bumped from 960 → **2880-wide band** encode through `PREVIEW_GRADE` + `watermarkFilter` (label becomes `RING PANORAMA · TRUE STITCH`); full-res ProRes master stays in `_STITCHED/` as the $8k/min deliverable source — never uploaded to the VPS.

---

## 4. Calibration sourcing strategy

1. **Canonical**: `mercy01.pts` (PTGui Pro 12.24, v33, `hasbeenoptimized:true`, 103 control points) — the only real calibration on disk and the only one with nonzero distortion, shift, vignetting, EV. Rig is fixed → one template for all 7 clips. Vendored at `pipeline/calibration/mercy01_v33.pts`, SHA-pinned.
2. **Scale transfer**: solved on 6144×3240 stills; MOVs are exact 1/3 proxies (identical 1.896 aspect). Focal (mm + sensordiagonal), shift (longside/shortside fractions), distortion (normalized-radius polynomial), vignetting are all resolution-normalized — CalibrationData already derives f_px from actual image width. Nothing to convert.
3. **Per-clip refinement (optional, V2)**: run the PyInstaller `calibrate` binary `--no-preview` per clip (~1–3 min) to flow-refine ring (converges 0.03°/0.06°) and re-solve sky pitch (varies ~6° between rolls). Then a ~100-line merge script writes **solved yaw/pitch/roll into the v33 template**, keeping Mercy01 lens distortion/vignetting/EV (calibrate.py's own output zeroes distortion). Guardrails: reject solves with |roll|>3° on ring cams or broken 60° yaw spacing (the `Roll02_Clip020` failure signature); retry `--frame` 100→300→600 when sky inliers < threshold. Ring-only MVP doesn't need any of this — Mercy01 ring geometry is within 0.05° everywhere.

### 4.1 Distortion-coefficients-zeroed: does it matter, and the fix
`RemapGenerator.swift` currently forces `distABC = 0` because PTGui's normalization convention was never pinned down. Quantified with the real Mercy01 coefficients: the PTGui polynomial is identity at r=1 by construction; worst-case mid-field deviation (r≈0.5–0.7) is ≈0.007 normalized → **~11 px at 6K, ~3–4 px at the 2048 proxies** (12mm ring lens; 9mm sky lens ≲2 px). So: invisible in the 2880 web preview after feathering, marginal-but-real at 6K delivery masters, and in V3 the flow-warp absorbs any smooth ≤4 px residual anyway. Verdict: ship MVP zeroed; fix properly in V2 for the "pro stitch" claim.

**Fix without test charts** — the repo already contains ground truth:
- Implement the candidate convention in the LUT kernel: `r_px = f_px·√(xn²+yn²)`, `r_n = r_px/(min(w,h)/2)`, apply polynomial to `r_n`, scale back (the current shader wrongly applies it to tan-space r directly).
- Validate two ways: (a) reproject the **103 control-point pairs** through the candidate model — correct convention gives ~1–2 px residuals, wrong ones give structured radial error; (b) render frame-10 stills and diff against **mercy01.jpg** (PTGui's own 18598×9299 output) with seam-zone SSIM. Feature-flag `--distortion on|off`; golden-frame CI test locks it once validated. Per-clip flow refinement remains the belt-and-braces for whatever sub-pixel residual is left.

---

## 5. Headless-ification: what is display-bound today, and effort

| Coupling | Fix | Effort |
|---|---|---|
| `StitchDisplayView: MTKView` — render pass from `currentDrawable`/`currentRenderPassDescriptor`; fragment rescales by `drawableW/H` uniforms | Port fragment math to a `stitchCompute` kernel writing an offscreen `MTLTexture` at LUT res (cleaner than a hand-built render pass); drop label/tally passes (cosmetic) | 1–1.5 d |
| `CVDisplayLink` pacing in `VideoInputRouter` (real-time push) | Synchronous per-frame loop over `FilePlaybackProvider`-style `AVAssetReader.copyNextSampleBuffer` — already pull-based; just remove pacing | 1–1.5 d (incl. TC lockstep) |
| No writer: `FrameGrabber` is fps-throttled BGRA readback feeding an ffmpeg pipe (`RTMPStreamer`) | New `AVAssetWriter` + `AVAssetWriterInputPixelBufferAdaptor`, ProRes via VideoToolbox; render into an IOSurface-backed CVPixelBuffer pool (no readback). Fallback: the FrameGrabber→`ffmpeg -f rawvideo -pix_fmt bgra` pattern works verbatim with `-c:v prores_ks` if AVAssetWriter fights back | 1 d |
| Reusable unmodified | `RemapGenerator` (needs only `MTLDevice`), `CalibrationData` (+v33), `RemapCompute.metal`, weight math, `LUTLoader` | 0 |

Total headless-ification core: **~4–5 engineer-days**; nothing structural blocks it.

### Swift/Metal maintenance risk for a TS-team product
Contain, don't port: (1) the CLI is a **frozen versioned contract** — semver'd binary, JSON report schema, exit codes; the TS team never touches Swift. (2) CI in the capture repo runs golden-frame tests (render frames 10/100/500 of Roll01_Clip04, compare to stored PNGs within tolerance) so any lib change that shifts output fails loudly. (3) Prebuilt binary vendored into the product repo with SHA — no Xcode/SwiftPM in the ingest environment. (4) Documented escape hatch: the pure-Python path (calibrate.py's `warp_to_equirect` + cv2.remap + `ExposureCompensator`/`DpSeamFinder`/`MultiBandBlender`, all already in-repo) can reproduce rungs (a)–(c) CPU-only at ~0.5–1.5 s/frame if the Swift toolchain ever becomes unmaintainable. The Metal path is the performance/quality optimum, not a single point of failure.

---

## 6. A/B evidence harness

`tools/seam_metrics.py` + `tools/ab_reel.py` (CPU, OpenCV, runs anywhere):
- **Seam-zone SSIM (alignment)**: per overlap, SSIM between the two cams' warped views inside the overlap mask, pre-blend — measures geometric agreement; report per-seam median + p5 over the clip.
- **Ghost metric**: gradient-doubling score in blended seam zones (double edges from parallax raise it).
- **Flicker**: per seam column-band, mean frame-to-frame ΔE of the *output* after global-motion compensation; catches seam breathing/wobble.
- **Baselines**: (i) current xstack hconcat, (ii) MVP static, (iii) PTGui reference — mercy01.jpg for frame 10 of Clip04 exactly, plus a small PTGui batch render of ~50 frames for one clip if a per-frame PTGui baseline is wanted.
- **Eyeball reel**: auto-generated triptych (hconcat | ours | PTGui) crops centered on the two busiest seams, 10 s per clip.

---

## 7. Failure handling

- **CLI**: typed exit codes (§3); all diagnostics to stderr, report always written (with `status:"failed"`, `failedStage`) on any error; tmp-file + atomic rename means a crash never leaves a corrupt master; re-run is a no-op if the key matches, full re-render otherwise.
- **Stage**: no blind retries (deterministic tool — same inputs fail the same way), except one retry for exit 6 (transient GPU init). On exit 3, auto-retry with `--allow-untimed` only if per-cam durations agree within ±2 frames, and flag the plate `tcUnverified`. On any hard failure: audit entry, `drop.stitchFailed = reason`, fall back to `encodeRingPano`, continue ingest.
- **QC gates before publish**: report frame count within ±2 of expected (duration×24 − max skip); band rows within expected range; per-seam SSIM p5 above threshold (else flag `seamQualityLow`, still publish preview but hold master).
- **Determinism/audit**: report pins macOS build + tool commit; Vision-engine flow may drift across OS updates, so `--flow-engine dis` (single-threaded OpenCV DIS) is the audit-reproducible mode; audit re-renders use it.

---

## 8. Compute estimate (7-clip catalog, M2 10-core GPU)

Catalog ≈ 7 clips × 34–151 s ≈ ~640 s ≈ **15.4 k output frames** (24 fps), 6 decoded streams each.

| Stage | Per-frame | Catalog |
|---|---|---|
| LUT generation | once/clip, <100 ms | negligible |
| Decode 6× ProRes Proxy 2048×1080 (VideoToolbox) | ~5–10 ms aggregate | — |
| MVP static stitch kernel 3840×1920 | 2–5 ms GPU | — |
| ProRes 422 HQ encode (M2 ProRes engine) | ~5–8 ms | — |
| **MVP total** | ~40–80 fps end-to-end | **≈ 5–15 min** |
| V3 flow: 5 overlap strips × Vision flow (~15–40 ms) + warp pass (~2 ms) | ~100–250 ms/frame → 4–10 fps | **≈ 0.7–1.5 h** (DIS-CPU mode: ~2–3 h) |
| Per-clip calibrate re-solve (V2, optional) | — | ~10–20 min total |
| Future 6K-source masters | 3× decode cost, same 3840 output | ~2–4× above; still hours |

Read from local scratch (stage copies from SMB first): 6 × ~35 Mbps streams are trivial locally, but SMB latency can stall lockstep readers. Comfortably inside "hours, not days" at every rung.

---

## 9. Milestones

**MVP — true static stitch shipping to the site (6–8 eng-days)**
CLI scaffold + args/report (1) · compute-kernel composite offscreen (1–1.5) · lockstep readers + TC trim (1–1.5) · AVAssetWriter ProRes + band crop (1) · idempotency/determinism plumbing (0.5) · TS stage + audit + 2880 preview wiring + fallback (1) · metrics harness v1 + hconcat A/B (1).
*Exit criterion: geometrically correct feathered equirect band, vignette/EV applied, visibly better than xstack immediately; catalog renders < 30 min.*

**V2 — calibration parity + delivery-grade statics (5–7 eng-days)**
PTGui distortion convention solve + CP/mercy01.jpg validation + golden-frame CI (2–3) · per-clip calibrate re-solve + v33 merge tool + guardrails (1–2) · residual per-cam gain solve, band/preview polish, QC gates (1) · PTGui A/B baseline render + reel (1).
*Exit: seam-zone SSIM ≥ PTGui-template on far-field content; masters credible for the "pro stitch on delivery" claim on clips without close-object parallax.*

**V3 — per-frame flow-warp, beat PTGui on parallax (8–10 eng-days)**
Vision flow integration + strip extraction (2) · delta-UV Metal warp pass with α-ramp (2–3) · temporal EMA + confidence gating + static fallback (1–2) · A/B tuning on the 1–3 m parallax cases + eyeball-reel sign-off (2) · perf + DIS audit mode (1).
*Exit: passing cars/poles cross seams without ghosting; flicker metric ≤ static baseline; objective + eyeball evidence archived per clip in audit.*

Total ≈ **19–25 engineer-days** to the full beat-PTGui claim; site-visible improvement lands at day ~7.

---

## 10. Top 5 risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Swift/Metal orphan code for a TS team** — bus factor, bit-rot with macOS updates | Frozen CLI contract (semver, JSON schema, exit codes); prebuilt SHA-pinned binary vendored into product repo; golden-frame CI in capture repo; documented Python/OpenCV fallback reproducing rungs (a)–(c) |
| 2 | **Distortion convention solved wrong** → worse seams than zeroed coefficients | Validate against 103 control points + mercy01.jpg before enabling; `--distortion` feature flag defaults off in MVP; golden-frame regression locks it after sign-off |
| 3 | **Flow-warp artifacts** (occlusion smear, textureless wobble) look worse than static on some clips | Confidence-gated fallback to static per overlap per frame; temporal EMA + prev-frame init; per-clip `--quality` override in stage config; eyeball-reel gate before flipping the default |
| 4 | **Reproducibility drift** — GPU float ordering, Vision engine changes, ProRes encoder non-bit-identity across OS updates | Idempotency keyed on input hashes + args + tool version (not output bytes); report pins OS build + commit; fixed `--creation-date`; deterministic DIS-CPU mode for audit re-renders |
| 5 | **TC/sync edge cases** — missing tmcd tracks, frame-count spread beyond the Roll01 pattern, a bad clip (cf. the failed Roll02_Clip020 calibration) poisoning automation | Per-clip TC report with hard QC gates; `--allow-untimed` only under duration-agreement check + plate flag; calibration-solve sanity guards (roll/yaw-spacing) with auto frame retry; hconcat fallback keeps ingest unblocked |

Key paths: CLI target → `/Users/andrewroberts/Projects/the_plate_lab/spheris-smart-stitch-live/Sources/SpherisRenderCLI/`; reused lib → `.../Sources/Spheris360LiveStitchLib/{CalibrationData,RemapGenerator}.swift`, `RemapCompute.metal`, `StitchShaders.metal`; calibration → `.../config/mercy01/mercy01.pts` (vendor to `the_plate_lab/pipeline/calibration/`); TS stage → `/Users/andrewroberts/Projects/the_plate_lab/pipeline/src/stages/stitch.ts` (new), wiring in `pipeline/src/ingest.ts`, preview bump in `pipeline/src/stages/renditions.ts`; test fixtures → `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04` and `Roll02_Clip09`.