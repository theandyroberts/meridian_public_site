# Ring↔Sky registration: why the 9-camera sphere needs depth, not calibration

**Date:** 2026-07-17
**Clip:** Roll01_Clip04 (6th Street Viaduct)
**Code:** `pipeline/stitch/stitchlab/tierdiag.py`
**Status:** measured, visually confirmed, detector validated against a positive control

## The question nobody had asked

Every ALL-9 candidate was rejected for defects at the ring↔sky boundary — doubled arch
crowns, chop-and-re-add, combing. Ten-plus revision rounds tuned blend parameters at that
seam and none fixed it. The reason: the real question was never asked — **are the two
camera tiers registered to each other at all?**

The ring (cameras A–F) and the sky tier (G/H/J) sit at different physical points on the
Spheris rig, with 10–15 cm baselines between them. Two things could make them disagree at
the boundary, and they have opposite prognoses:

- **Rotation error** — a fixed angular offset in calibration. Disparity is *constant*
  regardless of subject depth. Fixable by solving one offset. Days of work.
- **Parallax** — the tiers view from different points, so near things shift more than far.
  Disparity scales as 1/depth. No calibration touches it; needs depth-based view synthesis.
  Weeks-to-months, genuinely uncertain.

The discriminator is **disparity-vs-depth**, not disparity magnitude. (This is the same test
that cracked the tunnel sky the same week: four agents called its doubled lights "parallax"
from their size; the disparity was *flat* with elevation where parallax demands a 2.5×
growth, and it was a 1.9° yaw error — a rotation, fixed with one number.)

## Measurement

Both tiers rendered on the same TC-aligned frames, disparity measured by phase correlation in
their overlap band (elev 24.5–33°, the only elevations both tiers cover full-360). 785 patches
over 18 frames. Detector validated first: recovers injected shifts to **0.195 px** worst error
on real footage, rejects flat patches (texture gate, not response gate — flat sky
phase-correlates to a false (0,0) with high response).

**Result: parallax, not rotation.** Four independent lines agree:

| test | result | reads as |
|------|--------|----------|
| best rigid correction | 5.41 → 5.03 px (−7%) | a rotation would collapse to ~0 |
| depth split (luma proxy) | near 7.09 px vs far 4.55 px | near shifts 3.3× more than far |
| same angle, different frame | std 5.66 px ≈ signal size | offset follows the world, not the rig |
| implied depths (12 cm baseline) | arch 14.5 m, sky 47.6 m | different, physically sensible |

Relative tier yaw is essentially perfect (dx median −0.17 px). Nothing is miscalibrated. The
tiers disagree because they view from different points and the world has depth. Confirmed
visually: a red/cyan overlay of the two tiers at f504 shows the same arch rib in two places,
by a margin that varies across the frame.

## What it does and does NOT mean (a correction Andy made)

I first concluded "a calibration sphere lands in reject-territory by construction — 5 px
median, and Andy rejected a 6 px candidate." **That was wrong**, and Andy corrected it: he had
rejected that candidate because *the sky crop came down into the tall arches* — dark concrete
that doesn't line up — not because 5 px is globally unacceptable. The measurement supports
*his* reading: parallax is **7.09 px on the dark concrete, 4.55 px on open sky**. On
featureless overcast, 4.5 px is invisible — there is nothing there to misalign. The defect
only matters **where the boundary crosses structure.**

So the sphere is a **seam-placement** problem, not a global-accuracy problem.

## Why placement can't save it on this clip — the wall, not the fence

Andy's proposal: choose per-frame where the sky starts, above the main features, so the
boundary never lands on the arch. Exactly the right instinct. It fails here for a reason that
is geometry, not blending, and worth stating precisely:

1. **The boundary can only live in elev 24.5–33°** (sky full-360 floor → ring full-360
   ceiling). 8.5° of freedom.
2. **The ring physically ends at 40.7°.** The arch crowns at **53.95°** — 13° above anything
   cameras A–F ever captured. So "start the sky above the arch" is impossible on the tall-arch
   frames: it would need ring pixels at 54° that do not exist.
3. **The arch rib traverses the slot diagonally** — enters near the top at one azimuth, exits
   at the bottom at another. A boundary running 0–360° must get past it and cannot: above the
   rib and below the rib are clean sky but *topologically disconnected*. A path search confirms
   it — on the arch frames, **no continuous boundary exists at any slope**, even one allowed to
   jump half the slot per column (`/tmp/seampath.py`; slope 2→45 all fail). Zero blocked
   columns yet no path = a wall, not a fence.

A clean boundary exists on only **27% of frames** — exactly the frames where the arch is not
in the slot. On the other 73% the boundary is *forced* onto the concrete by geometry, and
that is where 5–7 px of parallax becomes the "dark concrete that doesn't line up" Andy will
not accept.

## Verdict

- **The two-element product (RING + SKY delivered separately) is the physically correct answer
  for this rig, now measured rather than argued.** No boundary → no wall to cross. It is not a
  workaround.
- **A 9-camera sphere needs depth-based view synthesis** — per-pixel depth, warp one tier into
  the other's viewpoint (SEA-RAFT / Video-Depth-Anything / depth-warp NVS). Weeks-to-months,
  uncertain. This is the part where a more capable model may genuinely matter, and it is now a
  well-posed research task instead of "one more bounded tweak."
- **No amount of seam routing or blend tuning fixes the arch frames**, because the obstacle is
  a connectivity wall in an 8.5° slot, not a placement error.

## Honest limits

785 patches, 18 frames, one clip. Measured at both tiers' weak edges — 8.5° of true full
overlap, not the 16.2° first claimed (the ring's coverage is only 2.6% at 40.7°, ramping to
100% by 33°). Luma is a crude near/far proxy, though the two strongest lines (rigid-fit
residual, temporal variance) don't depend on it. Detector validated to 0.195 px before any
number was trusted. Related: [[2026-07-15-sky-tier-overlap-collapse]] (the same 24.5° floor,
from the sky side).
