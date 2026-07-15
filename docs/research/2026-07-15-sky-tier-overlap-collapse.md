# Sky-tier overlap collapse — why the SKY element needs a per-clip rim

**Date:** 2026-07-15
**Clip:** Roll01_Clip04 (`viaduct-local9`, 6th Street Viaduct approach)
**Status:** measured, visually confirmed

## The finding

The sky cameras (G/H/J) stop overlapping near the bottom of their coverage. Measured on the
real rig at eq 3840×1920, from the actual baked coverage masks:

| elevation | ≥2 cameras cover | G–J pair overlap |
|-----------|------------------|------------------|
| 20°       | **0.0 %**        | 0.0 %            |
| 23°       | **1.4 %**        | 0.5 %            |
| 24.9°     | 3.9 %            | 1.5 %            |
| 30°       | 13.7 %           | 4.6 %            |
| 40°       | 39.8 %           | 12.9 %           |
| 50°       | 47.1 %           | 15.6 %  ← peak   |
| 59°       | 46.1 %           | 15.0 %           |
| 80°       | 37.7 %           | 10.2 %           |

Below ~25° there is effectively **no overlap to blend across**. The 8° feather has nothing to
work with, so ownership hands off abruptly and the seam becomes a butt-joint. Any structure
crossing it is guillotined: cut at a hard vertical edge and resumed at a different height.

## Evidence

Measured on the viaduct arch as it sweeps across azimuth (a driving plate, so it crosses seams
mid-clip). Slope-corrected step at the J–G seam, frames 400–1100:

- **BREAK** at frames 400, 450, 550, 850, 900, 950, 1000, 1050 — every crossing at **≤23°**
- **CLEAN** at frames 500, 650, 1100 — every crossing at **≥24.9°**

The split is exact and matches the overlap table. The G–H seam is clean throughout; J–G is the
offender because its pair overlap is the thinnest.

**The source is not at fault.** Re-rendering frame 400 from G alone and from J alone each yields
a continuous, undamaged arch rib. At elevation ~23° in that window G and J overlap by 27.6 %,
with 8,525 pixels seen by *neither* camera; at the one column where both see the rib, J puts its
top at row 716 and G at row 729 — a 13-row (~1.2°) disparity with no overlap in which to resolve
it. The defect is created by the seam, not present in the plate.

## Consequence for the product

This is the real reason the SKY element needs a rim, and it is **not** the reason originally
assumed (frame edges — see the correction below). Two independent constraints push the rim up:

1. **Overlap floor** — the rim must clear the butt-joint zone. Empirically ≥25°, comfortably ≥30°.
2. **Tier ownership** — the RING element already carries the horizontal band. Structure the ring
   owns must not also appear on the overhead panel, because a volumetric stage lights from both
   surfaces at once and the same concrete arriving on each at slightly different geometry is
   worse on stage than any stitch artifact.

For Roll01_Clip04 constraint 2 dominates: the arch crowns at **54.3°** (three independent
segmentations bracket it at 53.91 / 53.95 / 54.33 — take the softest edge as the floor), so the
rim is **59°** (Andy, 2026-07-15). That also lands the element at 46.1 % overlap, within 1 point
of the best the rig ever achieves.

`stitchlab sky --rim` is **required, with no default**. The previous `--max-elev 20.0` default
shipped both the bridge and the entire broken zone.

## Correction: the rim is not about "the absolute edges of their frames"

The sky lenses are **not fisheyes**. `mercy01.pts` says `projection=rectilinear`, focal 9.885 mm,
sensor diag 30.56 mm, hfov 107.638 — the 2048×1080 frame is fully filled and there is no image
circle. Therefore **the frame border IS the coverage border**.

The cameras are pitched up 51–54° in landscape, so the *top* border of each frame spans elevation
~40° to ~88–89° — squarely inside the dome. The zenith projects to pixel (991.98, 11.79) in H,
**11.8 px from H's top border**; G and J do not see the zenith at all. You cannot crop a sky dome
off these frames' top edge, because the top edge is where the sky is.

Raising the rim therefore does *not* lift the dome off the frame edge. The solid-angle-weighted
share of the delivered dome drawn from the outer 10 % of the frame border **rises** with the rim:
9.70 % at 24.47° → 13.50 % at 54° → 16.22 % at 60° → 23.96 % at 70°. What a high rim does kill
outright is the four **corners** and the bottom/side borders.

## What the rim does not solve

Tall structure near the zenith survives any usable rim. Measured and visually confirmed on this
clip:

| frame | what it is | max elev |
|-------|-----------|----------|
| 120   | streetlight/traffic-signal mast, cobra-head luminaire | 80.4° |
| 1476  | utility poles + transformer box | 80.5° |
| 1504  | dense tree canopy passing overhead (worst) | 84.4° |
| 1592  | palm tree crown | 80.5° |

Roughly frames 100–200 and 1400–1600. No rim below ~85° clears them, and an 85° rim leaves a 5°
cap — i.e. nothing. **"The sky element only needs to be sky" is false for those frames at any
rim.** Foliage is the class the professional stitch also concedes as soft; steel and concrete are
not.

## Measurement note — a detector trap

An early scan reported "thick rigid structure at 86°". It was wrong. In equirect, near-zenith
rows are stretched enormously in longitude: at 86° elevation a 3 px wire renders ~43 px wide, so
a morphological-opening thickness gate (9×9, and even 21×21/25×25) passes **wires** as rigid
structure. Any thickness test run in equirect must either compensate for the cos(latitude)
stretch or be run in a projection that does not have it. Real maximum rigid structure on this
clip is ~80–84°, not 86°.

## Rule for the remaining catalog clips

Rim = max( overlap floor ≈ 30° , tallest structure the RING element owns + ~5° margin ).

Derive per clip; do not reuse 59°. The other six drops (mateo-signal, pch-malibu,
pch-topanga-roll, santa-fe-underpass, second-street-tunnel, topanga-beach) have different
structure heights, and the two tunnel/underpass clips likely have overhead structure at
*all* elevations — for those the sky element may not be a meaningful deliverable at all.
