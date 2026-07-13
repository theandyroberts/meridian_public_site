# Cinema-Grade Stitch Gap Analysis: stitchlab vs. the Mistika VR + Operator Pair

**Executive summary.** stitchlab is a fully-automated, batch 360 stitching pipeline that has walked the entire classical alignment ladder — calibrated warp, photometric/vignette lock, sub-frame temporal resync, bidirectional flow-morph, verified rigid seam re-registration, and a structure-first hard-break detector — and, in its final rounds, benchmarked itself against a professional anchor stitch (Drew's Mistika-class **4K, 4096×2048 REC709** composite of the same viaduct plate, `structure/pro-anchor/pro_summary.json`). The measured result is that on the **alignment craft** stitchlab now sits at or above the pro's own quality ceiling on **seven of the twelve** problem classes (near-field parallax, moving subjects, foliage, exposure/colour, camera-sync, low-texture, rolling shutter), reaches the pro's *concession technique* (symmetric cross-dissolve, translucent double) on the wire and fast-near-field classes, and leaves **genuine unclosed gaps** on three fronts: **nadir/zenith pixel synthesis** (we have no patch tool at all — the pro concedes this by *patching*; we cannot even patch), **stabilization** (we have none — latent, not triggered on this well-controlled plate but real for less-controlled captures), and **one arch-crest occlusion residual** (a 22.6 px ledge at f492 c3248, plus a class of "detector-invisible" taper artifacts it can create by conceding badly). The gap to Mistika is therefore no longer the alignment craft — automation already equals or beats the operator there on determinism, per-frame coverage, and no fatigue — but three things a human still owns: predictive concession, semantic salience, and pixel synthesis (patch/paint), plus one physics wall (fast near-field shape-class mismatch) that only 3D/depth-warp novel-view synthesis can close.

> **Thesis:** We do not need to out-align the operator — we already do — we need to automate the operator's *judgment about when to stop aligning*, add the *one capability we entirely lack* (pixel synthesis for nadir and concession cleanup), and place a *metric-ranked, lightweight human-review fallback* on the short list of frames where the physics is genuinely unclosable.

---

## 1. Tools available in Mistika VR

SGO ships two distinct products; the operator lives in **Mistika VR** (the stitcher) and round-trips heavy paint/roto to **Mistika Boutique** (the finisher, which embeds the *same* optical-flow engine plus real VFX nodes).

**1.1 Optical-flow stitch engine.** Award-winning pixel-level Optical Flow that locally warps overlap content to kill ghosting; toggled per-sequence (**Use Optical Flow**). Compute-heavy — disabling it makes renders ~3× faster, so operators leave it off for layout and enable it only for final quality.

**1.2 Positional refinement.** **Positions → Improve Offsets** and **Improve Angles** auto-optimize per-camera placement; **Stitch Feather** (blend width, "5–15 often works well") controls seam softness / ghost suppression.

**1.3 Edge Points.** The manual scalpel — force a specific camera to own a region and bend the stitch line *around* a hard object, off a face, or to hide a subject seen by only one lens. The primary fine-tuning override on the flow/seam.

**1.4 Keyframe Animation.** Animation of *every* stitching parameter over the timeline — track a moving subject across a seam or a mid-shot lighting change with different stitch/position/edge-point/color values at different times.

**1.5 Calibration & parallax.** **Autocalibrate** (Meta collaboration, solves per-camera geometry in seconds); **70+ `.grp` presets** for named rigs (auto-stitch on load); custom presets savable and cross-compatible with Ultima/Boutique; "unique parallax algorithms" plus experimental **Forward Distance** for the stitch depth plane; **PTGui / AutoPano solve import** (fisheye + rectilinear since 10.2).

**1.6 Stabilization & horizon.** One-click image stabilization (analyzes horizon ±45°; **nadir/zenith deliberately untracked**); **gyro/IMU metadata** stabilization with rolling-shutter compensation; horizon leveling via Ctrl/Alt-drag with **Bake in Output Camera**.

**1.7 Stereo/depth.** Stereo-3D mode with **Convergence** control and the experimental **AM (Align Matches)** button for vertical-parallax/disparity; **Mesh Support** (Pro tier) for coaxial rigs.

**1.8 Color.** Auto **Color Match** (exposure/WB across lenses, often run twice); per-lens **Temperature / Green Tint**; per-input-camera **CDL** (offset/power/slope/sat).

**1.9 Patch/paint.** Limited in VR (edge-points + static nadir cap); real clone/roto/keyer/paint lives in **Boutique** (or Mocha VR / Fusion) for rig removal, nadir/zenith caps, moving-object paint-out.

**1.10 GPU + output.** Nvidia-accelerated h264/h265 (QP constant-quality), official ProRes (mac+win), EXR/DWA, Custom Crop, Inject Spatial Media Metadata, mono/stereo equirect.

**1.11 Automation.** CLI render (`mistika -r`), scriptable `.rnd` job files, render queue + `runBatch.cfg` submitter, **Deadline** farm plugin, unified script syntax across `.env/.grp/.rnd/.clp`, and **VR Connect** (live in-headset review in a Quest).

---

## 2. Techniques employed by a Mistika operator to create a quality stitch

The skilled end-to-end loop (Immersive Shooter / Mantis Sub / Meta / SGO):

1. **Import at native res**, set Files-Per-Segment to lens count, set I/O to isolate the working range.
2. **Load `.grp` preset / Autocalibrate / import PTGui** — a starting point, not the answer; eyeball overlap zones for gross misalignment first.
3. **Stabilize *first*, then stitch** — import gyro metadata before final flow, because a stabilized frame changes what the seams see.
4. **Global optical-flow pass** — Improve Offsets → Improve Angles, Stitch Feather ~5–15; raise feather only until ghosts vanish (too high smears detail).
5. **Per-region / keyframed seam refinement** — Edge Points to force camera choice and bend seams off faces/poles/near-seam objects; **keyframe** them for subjects walking through a seam.
6. **Stereo (if S3D)** — set Convergence ≈60, AM button to remove vertical parallax, check for flow "jello."
7. **Manual patch/paint of survivors** — static nadir cap + edge points, or round-trip to Boutique/Mocha/Fusion for true rig removal.
8. **Horizon + orientation** — Ctrl-drag level, Bake in Output Camera.
9. **Color match** — run Match Color (repeat), fine-tune Temperature/Green Tint/CDL; decide which lens is the reference.
10. **QC + output** — review **in-headset** (seams read differently at true FOV than on a flat monitor), render ProRes/EXR, inject metadata, batch/farm.

**The irreducible human judgment throughout:** where to *hide* seams (viewer gaze), which lens wins a contested overlap, feather-vs-detail tradeoff, when to keyframe vs. accept static, which artifacts flow can fix vs. which need manual paint, and reviewing at true headset FOV.

---

## 3. Problem areas overcome by those tools and techniques

The canonical twelve classes, each measured against the **professional anchor** — Drew's finished stitch (analyzed as a 4096×2048 REC709 adaptation, 97 frames, SRC 2605–2989), whose hardest structural hard-break *anywhere* is **4.5 px** with **zero chop-and-re-add cuts** (`structure/pro-anchor/pro_summary.json`: `hard_break_max_px_anywhere 4.5`, `offsets_chop_and_readd 0`). That 4.5 px ceiling *is* the professional bar. Where a pro cannot solve below it, the error is not cut — it is **converted to a smooth cross-dissolve / translucent double the silhouette detector cannot even segment** (the anchor's own `detector_blindspot` note). The concession is the technique; hiding it well is the craft.

| # | Problem area | What it physically is | Pro verdict (anchor) | How the concession is hidden |
|---|---|---|---|---|
| 1 | **Near-field parallax** | Different lens viewpoints; disparity grows as objects near (10–15 cm baseline → 17 px @4 m, up to 56 px worst sky columns) | **SOLVE far / CONCEDE nearest metres** | Diffuse into a soft semi-transparent double over the nearest few metres (palm crown + lattice towers, A-B region) |
| 2 | **Moving subjects across seam** | Subject traverses overlap while seam computes → doubled or sliced | **SOLVE** (car crosses the seam without splitting, E-F f1486) | Nothing to hide — genuinely closes |
| 3 | **Thin structures / wires** | Sub-10 px filaments carry ~no FFT energy vs sky gradient; flow locks onto sky | **CONCEDE** (faint cable/wire doubling) | Keep the wire faint → reads as atmospheric haze |
| 4 | **Foliage** | High-freq, self-similar, semi-transparent, wind-moving; no reliable correspondence | **CONCEDE** (114 chop *tails*, never hard cuts; scattered foliage ghosting) | Never a straight cut — dissolve into translucent multi-tap ghost; organic texture absorbs it |
| 5 | **Nadir / zenith** | Sphere poles — extreme distortion, minimal overlap, rig in frame; stabilizer ignores them | **CONCEDE by convention** (patched/cropped, not stitched) | Logo cap, patched disc, or black crop reads as intentional framing |
| 6 | **Exposure / colour** | Independent metering → brightness/colour step at seams under vignette | **SOLVE** (no visible step) | Nothing hidden — solved with gain+vignette solve |
| 7 | **Lens residual** | Polynomial lens model never fits perfectly; few px residual | **SOLVE (absorbed)** into offset/angle solve | — |
| 8 | **Camera sync / sub-frame** | Non-genlocked cameras fire μs–frame apart | **SOLVE** (no integer TC error; worst ≤0.22 frame) | — |
| 9 | **Stabilization** | Rig shake swims the horizon | **SOLVE** (global rotation on Output Camera, decoupled from seams) | — |
| 10 | **Low-texture** | Sky/wall/water → correlation locks onto luminance/vignette gradient, returns fake 14–66 px displacements | **SOLVE by not trusting it** | — |
| 11 | **Occlusion boundaries** | Near silhouette crosses seam; one camera sees behind, the other doesn't | **SOLVE where verifiable / CONCEDE where not** | Route seam along the occluder, single-source; dissolve where flow has no correspondence |
| 12 | **Rolling shutter** | Row-by-row exposure; adjacent scan phases differ → local tearing | **SOLVE (subsumed)** under parallax on this rig | — |

**The two irreducible concessions pros disguise rather than fix:** (A) **Shape-class mismatch** — the *same* structure rendered at different blur/tilt/curvature by two tiers, which *no displacement field can reconcile* (hidden as a smooth cross-dissolve into a soft double — this is the technique behind the whole 4.5 px ceiling); (B) **Fast near-field sweeps** — a near limb accelerating through the seam faster than hysteresis can track (hidden as a symmetric soft double across the sweep). The honest headline: a pro stitch is *not* artifact-free (114 foliage tails, 2,323 sub-4.5 px steps per `pro_summary.json`); the craft is disguising the two irreducibles below a 4.5 px hard-break ceiling.

---

## 4. Tools available within our tool (stitchlab)

Root: `meridian_public_site/pipeline/stitch/stitchlab/`. Fully batch (`__main__.py` exposes only `gate, stitch, stitch9, ghostbase, report, approve, promote` — no operator loop, no UI). (Note: a lexicographic round-runner exists as a separate module entrypoint, `python -m stitchlab.structure round`, used for evaluation, not shipping.)

**Calibration parsing.** `pts.load_pts` / `pts.PtsProject` — parses real PTGui Pro 12 `project_v33` JSON (per-image YPR, focal-mm + sensor diagonal, PanoTools distortion `a/b/c`, normalized shift). `Camera.f_px()` derives focal pixels only from PTGui-solved values, no nominal lens specs (gate-enforced).

**Remap/warp geometry.** `geometry.rotation` (camera→world `R=Ry·Rx·Rz`), `geometry.camera_maps` (rotation + focal + shift principal point + PanoTools `distort_forward` → `cv2.remap` maps + validity mask, with an explicit **phantom-halo guard** rejecting radii where the distortion quartic folds back — `geometry.py:103`), `undistort_point`, `rotate_equirect`.

**Ring-first compositing.** `ringstitch.RingStitcher` — baked LUTs, circular yaw order, six frozen seams; `_build_weights` per-column ±feather ramps. `ninestitch.NineStitcher._freeze_coverage_edge_seam` — sky-ring seam = ring coverage edge (`argmax(ring_cov)`), circular-median-smoothed then clamped; `_build_alpha` ±`EDGE_FEATHER` (8 px) sky-ownership ramp.

**Photometric lock.** `ringstitch.to_linear/from_linear` (γ=2.4, all math in linear light); `ringstitch.solve_gains` (per-cam scalar gains, log-domain LS over adjacent overlap means, anchor A=1.0, normalized max-gain=1.0).

**Frozen seams.** `ringstitch.seam_cost_curve` + `calibrate` — seam column minimizing mean |linear diff| in the interior-60% window; `_phase_correlate` records far-field residual as a diagnostic.

**Temporal sub-frame correction.** `temporal.cmd_activity` / `_activity_xcorr` — the **parallax-immune** shipped method (frame-difference "activity" waveform per cam, normalized cross-correlation, integer peak + parabolic sub-frame vertex); `solve_global` weighted-LS with loop-closure check; `TemporalResampler` — integer frame offset + fractional part synthesized by per-cam bidirectional-DIS MC interpolation (`_interp`, fb-consistency confidence, nearer-source occlusion fallback). (The older residual/τ `measure_pair_at` method is retained but declared **parallax-contaminated and superseded** — in the module's activity-method comment block and CLI help, `temporal.py:946–960`, not the function's own docstring.)

**Sky refinement.** `ninestitch.SkyRefiner` (re-solves each sky-cam YPR against the gain-locked ring — different shoot day — coarse then fine coordinate descent, structure-weighted objective); `ninestitch.PhasePolish` (damped Gauss-Newton over 9 sky params minimizing QC phase displacements, weights = response × temporal repeatability, run in a 3-pass re-freeze loop).

**Sky photometry.** `_solve_sky_photometry` (joint log-domain LS for 3 sky gains + per-cam radial vignette `exp(v2·r²+v4·r⁴)`, ring-anchored, ridge-regularized); `_solve_sky_flatfield` (second-stage smooth multiplicative flat-field).

**Flow-morph parallax correction.** `parallax.ParallaxCorrector` — **OpenCV `DISOpticalFlow` PRESET_MEDIUM** (`parallax.py:648`), variational iters raised to 10 (round-2 lever), **bidirectional**, **fb-gated** confidence, `FLOW_MAX_PX=80` cap, temporal EMA; each cam morphed toward the other so the meeting point sits at the seam, deltas added with frozen weights (out-of-band pixels bit-identical). Classical, **not learned**.

**Verified rigid profiles.** `_verified_profile` (`parallax.py:745`) — per-row rigid (dx,dy) fallback where flow is gated out; candidates include luma-PC, **gradient-PC** (thin wires carry FFT energy only in their gradient image), strongest-structure-window PC, last-accepted, structure-weighted median; accepted *only* if it beats zero-shift photometric residual by `PROF_ACCEPT_REL=0.80` — **no acceptance → zero, never junk**. `_residual_demote` catches DIS returning fb-consistent zero-flow on a thin wire.

**SharpSelect.** Disagreement-gated sharpness-weighted blend-share shift (`parallax.py:540`, round-4 lever, rescaled round-5); winner-take-all single-sourcing on protected-and-still-disagreeing structure with temporal hysteresis.

**Protected-structure detection.** `structure.segment` / `strip_protection_mask` — sky-vs-structure segmentation (`OPEN_K=9` opening drops anything thinner than ~9 px — wires cannot qualify as structure), silhouette chains, jump/offset/chop classification vs `DISP_BAR=1.5`.

**Per-frame seam routing.** `structure.BoundaryGuard.correct` — sky-ring handoff via silhouette-step closed loop + photometric grid search producing a **verified rigid shift** (translation + bounded shear, caps `BG_SHIFT_MAX=45`, `BG_DY_MAX=18`, `BG_SHEAR_MAX=0.046`; strict `BG_SIL_OK_MAX=4.0`); EMA/rate-limit between verified frames only (stale-hold abolished in r2-1). `structure.RingSeamRouter.route` — six ring seams get per-frame min-cost DP path, protected structure feather-dilated in cost, accepted only if ≤`RT_ACCEPT_REL=0.92`× frozen cost.

**Cross-dissolve concession.** `BoundaryGuard` (r2-2) — unverifiable crossings get a whole-interval symmetric 50/50 dissolve with onset/attack/release envelope (the pro's near-field concession). `_hard_break_sweep` (`structure.py:988`) — runs the **rank-1 detector on a provisional route-only composite** and adds any column still stepping >`BG_HARD_CEIL=4.5` to the dissolve mask.

**Metrics.** `structure.rank1_summary` (jump/offset vs `DISP_BAR`), `structure.hardbreak_summary` (boundary rigid breaks >4.5 px = FAIL vs ghost-dissolve = concession), `structure.rank2_stability` (per-seam rolling |Δ|); lexicographic (structure > stability). `parallax.GhostAccumulator` (structure-gradient-weighted residual, `worst_sites` auto-discovery).

**Validation gate.** `gate.Gate.run` — 8 M0 checks (`check1`–`check8`: parser-proof, intrinsics provenance + banned-constant grep, rig geometry 55–65° yaw gaps, warp-non-identity, control-point RMS, gold-image high-passed NCC vs PTGui's own render, hard-mask seams, coverage).

**Review/promote.** `report.cmd_report` (HTML sign-off), `report.cmd_approve`, `promote.cmd_promote` (crop, grade, watermark, x264 preview), `QcAccumulator` + `_absolute_regression` gate vs the 1.0 baseline.

---

## 5. Techniques available to our tool to stitch

Automated analogues of the operator's moves, each grounded in code:

- **Operator "re-solve control points for the new day" → automated** `SkyRefiner` coarse+fine coordinate descent → `PhasePolish` Gauss-Newton on QC phase displacements, in a 3-pass outer re-freeze loop.
- **Operator exposure/vignette match → automated** log-domain gain LS + joint radial-vignette solve + smooth flat-field, all in linear light, frozen across the clip.
- **Operator hand-drags a seam around a mast → automated** `RingSeamRouter` DP routing + `BoundaryGuard` verified rigid re-registration, both temporally hysteresis-damped so the automated "hand" doesn't jitter.
- **Operator paints/warps a ghost into alignment → automated** flow-morph with fb-gating + rigid-profile fallback + SharpSelect single-sourcing; explicitly *forbidden* on protected structure (rigid-only), mirroring a careful operator who shifts rather than smears rigid geometry.
- **Operator concedes fast near-field crossers → automated** whole-interval symmetric cross-dissolve with attack/release, triggered by the same rank-1 detector the reviewer uses (`_hard_break_sweep` closes the loop by optimizing the exact metric the judge measures — with the metric-overfit caveat noted below).
- **Genlock the rig → automated** MC sub-frame resample from measured per-cam activity offsets.
- **Loop/agent-driven refinement** — the codebase is an explicit round-by-round optimization against measured objectives (ghost-energy + rank-1 hard-break + rank-2 stability), benchmarked per-defect-class against Drew's anchor in its final rounds; negative results (morph-target bias, `BG_HOLD` stale-shift, residual/τ temporal method) frozen into comments so they aren't retried.

**What we demonstrably lack (technique + tool):** no interactive operator / keyframe UI / manual patch-paint-clone-roto; **no depth model** (the "cdepth" field is a misnomer — a per-row rigid profile, not depth); **no learned flow / learned segmentation** (classical DIS + morphology); **thin wires unprotected by construction** (`OPEN_K=9`); **no nadir camera, no nadir/zenith patch tool**; **no stabilization / horizon / IMU** (orientation is whatever PTGui + sky-refine produce; `rotate_equirect` exists but is used only in the gate); **the sky-ring transition band itself is uncorrected by flow** (rigid-shift-or-dissolve only); **verified shifts are affine-only and capped** (rigid + bounded shear, no homography); **heavy single-clip tuning** (hardcoded `SEAMS_CLIP04`, frame-specific constants — no cross-scene transfer demonstrated) with **metric-overfit risk** (`_hard_break_sweep` optimizes the same metric the judge scores); **no per-clip control-point re-solve at render resolution** (intrinsics/distortion trusted verbatim).

---

## 6. The delta for each factor

Legend for **gap type**: **T** = tool gap (we lack a capability), **Tech** = technique gap (we have the tool but apply it worse), **H** = human-judgment gap (needs semantic/perceptual judgment no metric fully captures). **Severity** is relative to the pro's *actual* shipped bar (soft-ghost concession is parity, not failure), not to theoretical perfection.

| # | Problem area | Mistika + operator approach | Our (stitchlab) approach | Gap severity | Gap type |
|---|---|---|---|---|---|
| 1 | **Near-field parallax** | Optical Flow + Edge Points route seam off near object; concede nearest metres to soft double | `ParallaxCorrector` flow-morph (fb-gated) + `_verified_profile` rigid fallback + symmetric dissolve concession; drove target-site ghost energy −81% to same soft double (A-B f283) | **None (at parity)** | — |
| 2 | **Moving subjects across seam** | Dynamic seam + flow steers around subject; Edge Points keep seam off it | Structure-first router single-sources moving rigid bodies with verified shift; car/tower sites clean (E-F f1486, target-site evidence) | **None (at parity)** | — |
| 3 | **Thin structures / wires** | Optical Flow + hand-placed Edge Points; accept faint wire ghost | Wires *unprotected by construction* (`OPEN_K=9`); `_residual_demote` + gradient-PC candidate mitigate but concede faint double | **Low** (both concede; ours by construction not choice — pro *can* hand-place an edge point, we cannot) | Tech |
| 4 | **Foliage** | Seam-through canopy + soft dissolve where flow fails | `_verified_profile` applies nothing on unverifiable foliage; dissolve concession (f1356: 38 px hard boundary → soft ghost). 53 tails vs pro's 114 | **None (at/above parity)** | — |
| 5 | **Nadir / zenith** | Edge Points + patch/clone/logo cap (Boutique/Mocha) | **No nadir camera, no patch/clone tool at all**; zenith cap excluded from optimization | **High** | **T** |
| 6 | **Exposure / colour** | Color Match (×2) + Temperature/Tint + CDL; operator picks reference lens | Log-domain gain LS + joint vignette + flat-field, ring-anchored (sky-sky MAD 0.003–0.008) | **None (at parity)** | — |
| 7 | **Lens residual** | Autocalibrate + Improve Offsets (repeat) | Absorbed into `SkyRefiner`/`PhasePolish` orientation solve; **not** re-solved (distortion trusted verbatim) | **Low** | Tech |
| 8 | **Camera sync / sub-frame** | Hardware genlock expected; match motion at seam | `_activity_xcorr` (parallax-immune) + `TemporalResampler` MC fractional resample; proved no TC error, worst cam D ≤0.22 frame | **None (arguably above** — measured a defect an operator can't perceive) | — |
| 9 | **Stabilization** | One-click + gyro metadata + Bake horizon | **None** (`rotate_equirect` exists but only for the gate check) | **Medium** (orthogonal; not this rig's pain, matters for less-controlled captures) | **T** |
| 10 | **Low-texture** | Larger correlation patches; operator ignores junk | Response-gating: never *score* low-confidence as real, never hard-gate a repeatable reading | **None (at parity, by not trusting it)** | — |
| 11 | **Occlusion boundary** | Dynamic seam along occluder + Edge Points single-source | `BoundaryGuard` verified rigid shift + route-below-crest; one residual f492 c3248 = 22.6 px (>4.5 bar); plus a "comb-tooth" taper class that scores 0.0 in the detector (detector-invisible; r2-1 around-route taper, e.g. c3439 f508–520) | **Medium** (one honest un-hidden offset + a self-created artifact class) | Tech + **H** |
| 12 | **Rolling shutter** | Interleave capture + flow absorb | Subsumed under parallax; below the parallax floor here | **None** | — |
| A | **Shape-class mismatch** (irreducible) | Smooth cross-dissolve into soft double — the technique behind the 4.5 px ceiling | Same symmetric dissolve; per-pixel/per-row morph retargeting proved *catastrophically worse* (up to 177 LSB regression — documented negative result) | **Low at concession-parity; High if measured vs "solve"** | **T** (needs depth-warp NVS to truly solve) |
| B | **Fast near-field sweep** (irreducible) | Same dissolve; raw hard cut converted to translucent trailing ghost | c2494 arch-limb 43.9 px hard cut → symmetric soft double; pp-2 took the deciding class from 101 records / 44.21 px → 1 record / 22.62 px | **Low (at concession-parity)** | **T** |
| — | **Interactive keyframe / patch-paint** | Edge Points, keyframe animation, Boutique paint/roto | Batch-only; no human-in-the-loop, no pixel synthesis | **High** | **T + H** |
| — | **Semantic salience** | Operator protects face/logo/hero over background tree | Segmentation is brightness/size-based (`OPEN_K=9`), ranks by silhouette continuity not *importance* | **High** | **H** |
| — | **Cross-scene generalization** | Operator adapts by eye to any rig/scene | Hardcoded `SEAMS_CLIP04` + frame-specific constants; no transfer demonstrated; metric-overfit risk in `_hard_break_sweep` | **High (product risk)** | Tech (engineering/robustness) |

**Reading the delta:** on the *alignment craft* (1, 2, 4, 6, 8, 10, 12 — seven classes) we are at or above parity; on the wire class (3) and the two irreducibles (A, B) we are at the pro's *concession* parity. The real gaps cluster into four buckets: **pixel synthesis we lack entirely** (nadir/zenith #5, patch-paint), **one physics wall** (shape-class mismatch A / fast sweep B — currently conceded at parity, "solvable" only with depth-warp NVS), **human judgment** (semantic salience, predictive concession, occlusion residual #11), and **generalization** (single-clip tuning). Almost nothing left is an *alignment* gap.

---

## 7. A plan to close the gap (prioritized, concrete, dependency-ordered)

Prioritization is by **severity × tractability × how much it leans on what we already have**. Effort tiers: **S** (days, wire into existing interfaces), **M** (weeks, new module + validation), **L** (months / research-grade). *Note: the external components below (LaMa, SEA-RAFT, Video Depth Anything, Surround360, SAM2) are proposals — none is in the codebase today; the ordering and honest ceilings are what matter, and each carries a runtime/licensing/determinism obligation before it can ship.*

### Tier 0 — Ship-blockers we already have the machinery for

**P0.1 — Nadir/zenith patch via single-frame inpainting. Effort S. (Closes #5, severity High.)**
The rig footprint is at a *known, static image location* — no detection needed. Drop **LaMa** (Fourier-conv, large-mask, deterministic given fixed weights) as a fixed-region fill on the nadir disc and the zenith crop-edge artifact (the same class of artifact `pro_summary.json` had to *exclude* from the pro anchor — its persistent col~1950 zenith crop-edge cluster). Deterministic and out of primary gaze. *Depends on:* nothing. Wire into `promote.py` as a post-crop pass.

**P0.2 — Metric-ranked human-review triage surface. Effort S. (Closes the interactive-UI/judgment gap pragmatically.)**
We already built the confidence map: `structure._hard_break_sweep` runs the exact operator the judge uses on the final composite and separates boundary hard-breaks (fail) from ghost/dissolve (concession) from other-family residuals. Extend `report.py`/`promote.py` with a ranked flag list + a minimal patch action (confirm-concession / approve-inpaint / paint-nadir). pp-2 shows this is a *short* list — 1 genuine jump + a handful of mis-scored ghost-edge records across 142 frames. This converts "operator per shot" into "operator on the flagged few." *Depends on:* the triage surface itself is independent; only its **inpaint patch action** reuses P0.1's tool.

### Tier 1 — Raise the alignment floor with drop-in learned components

**P1.1 — SEA-RAFT learned flow as a `--quality max` backend. Effort M. (Improves #3, #11.)**
Swap classical DIS for **SEA-RAFT** (ECCV 2024, SOTA on Spring, strong zero-shot generalization) behind the existing `parallax.py`/`temporal.py` interfaces. Directly attacks the ledger's "DIS returns fb-consistent zero-flow on a thin wire" failure — better flow → fewer confidently-wrong fields → cleaner `_verified_profile` acceptance. ~10× DIS cost, minutes/clip more, tolerable offline. **Honest ceiling: raises the floor, does not touch the shape-class root cause.** *Depends on:* MPS/CoreML runtime + deterministic-weights policy.

**P1.2 — Rig-anchored metric depth. Effort M. (Closes #10 no-signal fill; enables P2.1.)**
**Video Depth Anything** (CVPR 2025, temporally-consistent, Temporal-Gradient-Matching loss, offline windowed mode) gives dense edge-aware geometry where photometric signal is absent (featureless sky, thin-wire-vs-sky). **Do not trust monocular scale** — anchor it to the rig's own multi-view disparity: per-frame scale+shift LS against the flow-measured disparity in the overlaps (the parallax module already empirically solved wire depth to ~28–34 px = known 4 m via `_verified_profile`'s constant-depth solve). The metric anchor can use the *existing classical* flow disparity, so this is **not hard-blocked by P1.1** — P1.1 only sharpens the anchor. Licensing: use the **Apache-2.0 Small** model, or license Large (CC-BY-NC). *Depends on:* flow disparity (classical suffices; P1.1 optional).

### Tier 2 — The strategic R&D bet: attack the physics wall

**P2.1 — Local depth-warp novel-view synthesis at the sky-ring boundary. Effort L. (The only path that *solves* A/B rather than conceding.)**
This is the successor to `BoundaryGuard`'s rigid-shift. Reimplement **Surround360's α-warp `NovelView`** (proven, archived — treat as reference pseudocode) upgraded from 2D-flow to **depth-warp**: build a small rig-anchored metric depth surface (P1.2) *just* for the arch limb/pole crossing the seam, reproject *both* tiers' pixels to the boundary's common virtual viewpoint. Because both sources become the *same shape by construction*, this is the only family that can close the fast-near-field shape-class mismatch (the round-5 diagnosis: "no displacement field can reconcile two different shapes"). Apply *surgically* where the detector says 2D failed — not full-scene. **Honest ceiling: introduces its own failure mode (depth error at occlusion → geometry error, a "melted smear" now in 3D); gate behind the P0.2 review.** *Depends on:* P1.2 (and P1.1 for its sharpest input). Full-scene feed-forward 3DGS (DrivingForward/IDSplat) is a **watch-list item, not a 2026 dependency** — fragile at 10–15 cm baselines.

### Tier 3 — Robustness & optional capability

**P3.1 — Cross-scene generalization harness. Effort M. (Closes the product-risk gap.)** Parameterize `SEAMS_CLIP04` and the frame-specific constants; validate the parameter set transfers to a second scene; add a guard against `_hard_break_sweep` metric-overfitting (hold-out perceptual check). *Depends on:* a second labeled clip.

**P3.2 — IMU/flow stabilization + horizon lock. Effort S. (Closes #9 if IMU present.)** Integrate gyro → rotation trace → low-pass → inverse global rotation in `geometry.rotation` composition (pure sphere rotation, no reprojection error). ~100 lines. **Orthogonal — fixes rotation, not translation parallax.** Only if the pipeline ingests less-controlled captures. *Depends on:* per-clip IMU data.

**P3.3 — Semantic salience via SAM2. Effort M. (Partially closes the salience gap.)** SAM2 open-vocab/prompted masks to tag face/logo/hero regions so the lexicographic metric can spend seam budget by *importance*, not just silhouette size. Approximates, does not replace, operator intent. *Depends on:* P0.2 (masks feed the review surface); gate behind human confirm.

**P3.4 — Per-clip distortion re-solve at render resolution. Effort M.** Section 8 (row 7) claims we can *beat* the pro on lens residual by re-solving distortion per clip at render res rather than trusting the `.pts` verbatim. That capability is **not built and not otherwise scheduled** — logging it here so the "beat" in §8 is backed by a real work item, not an assertion. *Depends on:* per-clip control points.

**Dependency graph:** P0.1 → P0.2 (only the inpaint action is shared; the triage surface is independent). P1.1 → (sharpens) P1.2 → P2.1 (the strategic chain; P1.2's metric anchor works on classical flow, so P1.1 is a quality input, not a hard gate). P3.x are independent add-ons. Ship P0 first (immediate parity on nadir + a usable human fallback), then P1 (floor-raising, low-risk), then commit R&D to P2.1 as the one bet that moves the last class from *concede* to *solve*.

---

## 8. A plan to equal or EXCEED the operator/Mistika pair at each problem point

The honest bar is **what pros actually ship** — a stitch carrying 114 foliage tails and 2,323 sub-4.5 px steps, with the two irreducibles *disguised*, not fixed (`pro_summary.json`). "Exceed" is defined against that, not against perfection. Per problem area: the automated approach that reaches parity, where automation can plausibly *beat* the operator, and where a human-assist fallback is the honest answer.

| # | Problem area | Automated approach to parity | Where automation can BEAT the operator | Honest human-assist fallback |
|---|---|---|---|---|
| 1 | **Near-field parallax** | Flow-morph + verified-profile + symmetric dissolve (already at parity, −81% ghost energy) | **Per-frame** morph on every frame (operator keyframes a few and interpolates) → **temporal consistency** the operator can't match by hand | Only the rare frame where dissolve is coarser than a hand-tuned one |
| 2 | **Moving subjects** | Structure-first single-source with verified shift (at parity) | **Determinism + no fatigue** across the clip; every frame gets a verified decision | — |
| 3 | **Thin wires** | SEA-RAFT flow (P1.1) + gradient-PC + `_residual_demote` | Marginal — both concede; better flow narrows the doubling | Faint wire ghost is the accepted answer for both; leave it |
| 4 | **Foliage** | Dissolve concession (already **above** parity: 53 tails vs pro 114) | **Consistency** — same dissolve policy every frame, no operator-mood variance | — |
| 5 | **Nadir/zenith** | LaMa static fill (P0.1) → reaches parity (pro also patches, doesn't stitch) | **Determinism** — pixel-identical patch every frame vs an operator's per-shot paint | Dynamic unwanted object (crew, unwanted car): SAM2+ProPainter is *semi*-automatic by nature — **human flags what to remove** |
| 6 | **Exposure/colour** | Gain+vignette+flat-field solve (at parity, MAD 0.003–0.008) | **Beats** — joint radiometric solve is more repeatable than eyeballing a reference lens | Operator's aesthetic grade choice (not a stitch defect) |
| 7 | **Lens residual** | Absorbed in orientation solve (at parity) | Add per-clip distortion re-solve at render res (**P3.4, unbuilt**) → would **beat** "trust the .pts verbatim" | — |
| 8 | **Camera sync** | `_activity_xcorr` + MC resample (already **above** parity) | **Beats decisively** — measured a sub-frame defect (worst cam D +0.22) the operator cannot perceive, let alone correct | — |
| 9 | **Stabilization** | Gyro→inverse-rotation (P3.2) reaches parity | **Beats** — deterministic per-frame trace, no manual keyframing | — |
| 10 | **Low-texture** | Response-gating (at parity, by not trusting junk) | **Beats** — honest measurement never mints a false correction an operator might chase | — |
| 11 | **Occlusion boundary** | Verified rigid shift + route-below (at parity where verifiable) | **Per-frame verified routing** beats a keyframed Edge Point where geometry is verifiable | The f492 c3248 22.6 px residual + comb-tooth taper: **honest human-assist** — one confirmed concession or Edge Point via the P0.2 surface |
| 12 | **Rolling shutter** | Subsumed under parallax (at parity) | — | — |
| A | **Shape-class mismatch** | Symmetric cross-dissolve = **the pro's own technique** → concession-parity today; **P2.1 depth-warp NVS** to actually *solve* by re-projecting to a common shape | If P2.1 lands: **exceeds** — pro *concedes* this class to a soft double; a validated depth-warp would render it *sharp*, which no operator does | Until P2.1 validates: the dissolve is the honest answer; a per-pixel morph makes it *worse* (proven 177 LSB regression) |
| B | **Fast near-field sweep** | Symmetric soft double (already at parity: c2494 arch-limb, pp-2 44.21 → 22.62 px) | Same P2.1 depth-warp opportunity to exceed | The handful of frames where our dissolve is coarser: P0.2 review |

**The three genuinely-human residuals, and the honest posture on each:**

1. **Predictive concession.** The operator *knows* a 1-metre pole crossing the seam will never align and pre-emptively dissolves *before* a solver smears it. We concede *reactively* (`_verified_profile` "no acceptance → zero"; `_hard_break_sweep` folds undetected breaks into dissolve). Parity is reachable — `around-route` + single-source-on-sky is predictive — but the ledger notes it "traded holds for detector-invisible artifacts" (comb-teeth taper, r2-1). **Honest answer: reactive detect-and-dissolve at parity, with the P0.2 review catching the coarse residual. This is a judgment gap, not a tooling gap.**

2. **Detector-invisible artifacts.** The ledger's recurring nightmare — a change scoring 0.0 in the scanner that still looks wrong (comb-teeth, 1-frame pop, straight source-cut). Every automated pipeline optimizes a *proxy*; the operator optimizes *the glance*. `_hard_break_sweep` narrows this by scoring with the exact operator the judge uses, but it still cannot see the ghost-double class the pro anchor itself is blind to (`detector_blindspot`). **A human eye is the only known complete detector. Honest answer: the P0.2 metric-ranked review is the eye, applied only to the flagged short list.**

3. **Semantic salience.** A 9 px-opening geometric detector cannot tell "guardrail" from "actor." **P3.3 SAM2 *approximates* it; nothing yet replaces operator intent. Honest answer: automate salience as a prior, gate the priority call behind human confirm.**

**Bottom line.** A fully-automated pipeline already **equals** the cinema operator on the calibration-and-alignment craft (calibration, photometry, sub-frame sync, rigid handoff, seam routing — seven of the twelve classes at or above the anchor's measured ceiling) and already **beats** the operator on determinism, temporal consistency, per-frame coverage, and no-fatigue — measured, not asserted (pp-2: 101 records / 44.21 px → 1 record / 22.62 px; sub-frame sync the operator can't perceive; foliage 53 tails vs 114). It reaches the operator's *concession* on near-field parallax, foliage, wires, and fast sweeps by adopting the operator's own disguise — the symmetric cross-dissolve below a 4.5 px ceiling. It cannot yet **independently** (a) *solve* (vs concede) the fast-near-field shape-class mismatch — that needs **P2.1 depth-warp NVS**, the one R&D bet that could push automation *past* the pro, who only ever concedes this class; (b) catch detector-invisible artifacts — that needs an eye; or (c) synthesize pixels for nadir/dynamic removal — **P0.1 LaMa** closes the static case immediately. It also carries two genuine *capability* gaps the pro does not: no nadir/zenith patch tool at all (the pro concedes by patching; we cannot patch), and no stabilization (latent on this controlled plate, real off it). The reliable route to cinema grade in 2026 is therefore **automation to pro-concession parity + a metric-ranked lightweight human review-and-patch fallback (P0.2)**, with **rig-anchored local depth-warp NVS (P2.1)** as the research track that would move the last irreducible class from *disguise* to *solve* — the only place we can honestly claim to exceed the pro rather than match his concession.