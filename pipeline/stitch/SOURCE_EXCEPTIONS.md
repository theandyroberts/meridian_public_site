# Source exceptions

## PL-5042477 — Mateo signal

The archived `J001_J007_03235H.mov` camera source ends at approximately
100.29 seconds. Cameras A–H continue to approximately 147.75 seconds, and no
alternate J007 source was found in the mounted Spheris footage archive.

`build-stage-previews.sh` therefore extends J's final frame through the end of
the **watermarked staging previs only**. The affected backward-left sky sector
will be static for the final 47 seconds. This repair is suitable for navigating
and evaluating the plate on the virtual stage, but it is not production media.
Recover or replace the missing J-camera source before producing a licensed
full-sphere master.
