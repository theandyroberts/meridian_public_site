# Ground-truth digest: Spheris on-disk artifacts

## 1. PTGui calibration folder — `/Volumes/files/SpherisFootage/Roll01_Clip04/03:21:24_Mercy_Ptgui/`
Contents (all dated Mar 24 2024):
- 9 per-camera full-res stills, one per cam A–J, named `<reel>_<clip>_<id>.0000010.jpg` (frame 10 extracts), each ~7–8.5 MB, **6144x3240** (full 6K Komodo sensor res, NOT the 2048x1080 proxies)
- `mercy01.pts` (35,853 B) — the PTGui project
- `mercy01.jpg` (84 MB) — the stitched reference pano, **18598x9299** equirect (~2:1)

### `mercy01.pts` schema (it is JSON, not the old text .pts format)
- `$schema: https://www.ptgui.com/schemas/project_v33.schema.json`, `contenttype: com.ptgui.project_pro`, `software: "PTGui Pro 12.24"`, `fileversion: 33`
- Top-level keys: `$schema, contenttype, software, fileversion, compatibleversion, compatibleapplication, project, assets`. **No "spheris" block anywhere** — assets holds only an embedded ICC profile.
- `project` keys: `... panoramaparams, optimizer, globallenses, globalcameracurves, photometric, postprocess, imagegroups, controlpoints`
- Pano: `hfov=360, vfov=180, projection=equirectangular`, output jpeg q95, `outputcrop [0,0,1,1]`, blend engine `zerooverlap` with `seamfinding: true`
- `hasbeenoptimized: true`, optimizer `hvcpmode: twopass`, simplemode `heavyplusshift`, anchor = imagegroup 0 (cam A)
- **103 control points**, format `{"t":0, "0":[imgA, subA, x, y], "1":[imgB, subB, x, y]}` in source-pixel coords (6144x3240 space)

### Per-camera pose (imagegroups, one per camera, order A B C D E F G H J; degrees)
| Cam | lens | yaw | pitch | roll |
|---|---|---|---|---|
| A | 0 | 0.0000 | 10.0489 | 0.4712 |
| B | 0 | 59.6309 | 7.7839 | -1.4449 |
| C | 0 | 120.8405 | 12.0641 | -1.1050 |
| D | 0 | 179.6510 | 7.7520 | 0.6146 |
| E | 0 | -120.8309 | 9.7649 | -0.3921 |
| F | 0 | -59.7150 | 10.0252 | -0.0931 |
| G | 1 | 0.4136 | 51.5510 | 2.0280 |
| H | 1 | 125.5112 | 53.0516 | 5.9931 |
| J | 1 | -117.5247 | 51.8262 | 2.3794 |

Ring cams are ~60° apart in yaw with ~8–12° up-pitch; sky cams ~52° pitch at ~120° yaw spacing. All viewpoint (vpx/vpy/vpd) params = 0 (single-nodal-point model — parallax NOT modeled). Each imagegroup: `size [6144,3240]`, per-image `photometric.exposureoffset` (small, e.g. A=0.0066).

### Two global lenses (both `projection: rectilinear`, sensordiagonal 30.56mm)
- **Lens 0 (ring, Laowa 12mm)**: focal 13.0222mm, distortion a=-0.0023213, b=-0.0105846, c=0.0557465; shift long=0.0121456, short=0.0002781; vignetting coeffs [-0.11857, -0.09750, -0.04998, -0.01229, 0.01251]
- **Lens 1 (sky, Laowa 9mm)**: focal 9.8853mm, a=-0.0311194, b=0.1197776, c=-0.1392134; shift long=0.0094515, short=0.0168959; vignetting [-0.28572, -0.19712, -0.13347, -0.08801, -0.05412]

Note distortion is calibrated against the 6144x3240 stills; the MOVs are 2048x1080 proxies of the same sensor area, so angles/normalized shift transfer, pixel coords scale by 1/3 (2048/6144), assuming proxy has same aspect crop (6144:3240 = 1.896; 2048:1080 = 1.896 — identical, clean 3x scale).

## 2. Calibration artifacts on other clips
`find` across `/Volumes/files/SpherisFootage` for `.pts/.pto/ptgui/pano/calib`: **only Roll01_Clip04 has anything** (`03:21:24_Mercy_Ptgui/mercy01.pts`). No other clip has any calibration file. Since the rig is fixed, mercy01.pts is the single calibration for all 7 clips (rolls: Roll01_Clip04, Roll01_Clip07, Roll02_Clip02, Roll02_Clip09, Roll02_Clip13, Roll02_Clip020, Roll02_Take012 — each has exactly 9 MOVs; Clip04/Clip02/Clip09/Clip020 also have per-cam poster JPGs, Clip07/Clip13/Take012 are MOVs only). Local copies confirmed at `/Users/andrewroberts/Projects/spheris-smart-stitch/Roll01_Clip04/` (incl. the Ptgui folder) and `.../Roll02_Clip09/`.

## 3. ffprobe of camera files
**Roll01_Clip04 `A001_A004_0323U7.mov`**: ProRes 422 **Proxy** profile, 2048x1080, yuv422p10le, 10-bit, 24/1 fps exact, duration 68.0s (1632 frames), ~21.8 Mbps. Color: primaries/transfer/space all **bt709** (so proxies are already display-referred 709, NOT tagged Log3G10/RWG despite catalog claims). Stream tag `timecode: 07:00:43:02`; separate tmcd data track with same TC. Container tag `encoder: Blackmagic Design DaVinci Resolve` (proxies rendered from R3Ds in Resolve), creation 2024-03-24. No audio.

**Roll02_Clip13 `A002_A013_03233T.mov`**: identical recipe — ProRes 422 Proxy, 2048x1080, yuv422p10le, 24 fps, bt709/bt709/bt709, duration 122.667s (2944 frames), ~35.6 Mbps, `timecode: 13:17:51:13`, Resolve-encoded.

## 4. Timecode sync across all 9 cams of Roll01_Clip04
Per-file (duration s, nb_frames, start TC):
```
A 68.000 1632 07:00:43:02
B 68.083 1634 07:00:43:00
C 68.042 1633 07:00:43:01
D 68.042 1633 07:00:43:01
E 68.042 1633 07:00:43:01
F 68.083 1634 07:00:43:02
G 68.000 1632 07:00:43:03
H 68.083 1634 07:00:43:01
J 68.042 1633 07:00:43:01
```
**NOT file-start aligned: start TCs spread over 4 frames (:00 to :03)** and frame counts vary 1632–1634. They ARE mutually timecode-locked (all within the same second, genlock/jam-sync evident). A stitch stage must trim per-camera by TC: common window = max start TC **07:00:43:03** (cam G) to min end (frame 1634 rel. 07:00:43:00) ≈ **1631 common frames**. Per-cam skip offsets (frames from own start to 07:00:43:03): A=1, B=3, C=2, D=2, E=2, F=1, G=0, H=2, J=2.

## 5. Current pipeline code
**`pipeline/src/stages/renditions.ts`** — fake pano in `encodeRingPano()` (used when `drop.stitchedMaster` is absent):
- Order: `["E","F","A","B","C","D"]` (yaw order, 360° L→R; matches .pts yaws -121, -60, 0, +60, +121, 180)
- Each cam full frame `scale=480:270` (squeezes 1.896:1 → 16:9, no crop despite "crops" folklore), through `PREVIEW_GRADE` (`eq=contrast=1.22:saturation=1.45:gamma=1.06`), then `xstack inputs=6 layout=0_0|480_0|...|2400_0` → **2880x270 strip**, no blending, no sky cams
- Watermark via `watermarkFilter(font, sku, label)`: center `PLATE LAB · PREVIEW` fontsize h/9 white@0.16; bottom-left `<SKU> · NOT FOR PRODUCTION` h/24 white@0.55; boxed top-left label `RING PANORAMA · PRO STITCH ON DELIVERY` h/16 white@0.85 on black@0.45
- Encode: libx264 veryfast CRF 30, yuv420p, faststart, `-an`
- `buildRenditions(drop, sku, outDir)` also makes per-cam 480-wide previews (labels from `CAMERA_POSITIONS`) and a 1280-wide `poster.jpg` (t=1s, fallback t=0). If `drop.stitchedMaster` exists it 960-wide-encodes that instead of calling encodeRingPano.

**`pipeline/src/ingest.ts` stage order** (sequential, each audited; publish last+atomic): `discover` → `probe(masterFile = stitchedMaster ?? cameraFiles.A)` → `assignSku` → `sha256File(master)` → `loadTelemetry` → `labelDrop` → `describePlate` → `buildRenditions` → `uploadRenditions` → `publishPlate`. A new **stitch stage belongs between describePlate and buildRenditions** (or before probe if the stitched output should become the probed/checksummed master); its output can be handed in as `drop.stitchedMaster` so buildRenditions' existing stitched-master path takes over and encodeRingPano becomes dead code. Note plate metadata hardcodes `stitchedResolution: "3840x1920"` and `colorPipeline: "Log3G10 / REDWideGamutRGB"` — both currently aspirational vs. the bt709 proxies.

## 6. Hardware / ffmpeg
- CPU/GPU: **Apple M2, 10-core GPU, Metal 4** (Liquid Retina MacBook — modest; fine for Metal shader stitching of 2048x1080 proxies, heavy for CPU 6K work)
- ffmpeg: **8.0 (homebrew, /opt/homebrew/bin/ffmpeg)** with videotoolbox; **both `remap` (VVV->V) and `v360` filters present**. remap is `.S` (slice-threaded) — usable for LUT-based per-camera equirect projection maps generated from the .pts lens/pose params, with v360 available for projection conversions.

Key implications for the stitch stage: mercy01.pts provides a full static geometric+photometric calibration (poses, 3-coeff radial distortion, shift, vignetting, exposure offsets) transferable to the proxies at 1/3 scale; PTGui's model has zero parallax handling (vp params all 0, static seams) — that is the quality bar to beat; files need TC-based trims (offsets differ per clip, recompute per drop from ffprobe `timecode` tags).