import argparse
import sys

from .gate import Gate


def main() -> int:
    ap = argparse.ArgumentParser(prog="stitchlab")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gate", help="run the M0 validation gate against PTGui ground truth")
    g.add_argument("--pts", required=True, help="real PTGui v33 .pts project")
    g.add_argument("--stills", required=True, help="dir with the calibration full-res stills")
    g.add_argument("--gold", required=True, help="PTGui's own rendered pano (mercy01.jpg)")
    g.add_argument("--out", required=True, help="output dir for evidence + gate-results.json")

    s = sub.add_parser("stitch", help="TC-align a ring drop and render the stitched equirect band")
    s.add_argument("--drop", required=True, help="drop dir containing cam_A..F.mov")
    s.add_argument("--pts", required=True, help="PTGui v33 .pts calibration project")
    s.add_argument("--out", required=True, help="output dir (samples/, metrics.json, movs)")
    s.add_argument("--sample", type=int, default=8, help="render N spread sample frames as PNGs (default 8)")
    s.add_argument("--full", action="store_true", help="render every aligned frame to ProRes + preview mp4")
    s.add_argument("--fps-report", action="store_true", help="(fps is always reported in metrics.json)")

    s9 = sub.add_parser("stitch9", help="all-9 stitch: ring 1.0 band + refined sky cams G/H/J")
    s9.add_argument("--drop", required=True, help="drop dir containing cam_A..J.mov (nine cameras)")
    s9.add_argument("--pts", required=True, help="PTGui v33 .pts calibration project")
    s9.add_argument("--out", required=True, help="output dir (samples/, metrics.json, sky_refine.json)")
    s9.add_argument("--sample", type=int, default=6, help="QC sample frames, >=4 (default 6)")
    s9.add_argument("--refine", action="store_true", help="run per-clip sky ypr refinement (SkyRefiner)")
    s9.add_argument("--offsets", help="load sky ypr offsets from a prior sky_refine-style JSON")
    s9.add_argument("--eq", type=int, nargs=2, default=[3840, 1920], metavar=("W", "H"),
                    help="equirect canvas size (default 3840 1920)")
    s9.add_argument("--full", action="store_true", help="render every aligned frame to ProRes")
    s9.add_argument("--no-polish", action="store_true",
                    help="skip the phase-correlation sky polish stage (round 3)")
    s9.add_argument("--composite", choices=["ring-first", "seam-cost"], default="ring-first",
                    help="sky-ring boundary policy: ring-first = ring owns every valid pixel, "
                         "sky fills above its coverage edge (default); seam-cost = legacy "
                         "min-cost seam row inside the overlap (A/B only)")
    s9.add_argument("--scan-crossing", type=int, default=4, metavar="K",
                    help="scan 24 spread frames with the structure-crossing detector and fold "
                         "the K worst into the QC sample set (0 disables; default 4)")
    s9.add_argument("--temporal", default="auto", metavar="OFFSETS_JSON",
                    help="per-cam temporal offsets (frames) from stitchlab.temporal; "
                         "'auto' (default) uses <out>/../temporal/offsets.json when present, "
                         "'none' disables the motion-compensated resampling correction")
    s9.add_argument("--baseline-metrics", default="reports/clip04-full/metrics.json",
                    help="1.0 ring metrics.json for the absolute regression check")
    s9.add_argument("--no-temporal-qc", dest="temporal_qc", action="store_false", default=True,
                    help="skip the temporal QC video crops / film-strip montages")
    s9.add_argument("--seed-offsets", metavar="OFFSETS_JSON",
                    help="initialize sky ypr from a prior solution and let PhasePolish "
                         "own the final offsets (finds the wire-balanced basin "
                         "deterministically; unlike --offsets, polish still runs)")
    s9.add_argument("--parallax", choices=["off", "flow", "flow+cdepth", "auto"], default="auto",
                    help="parallax correction in the blend bands: flow = bidirectional "
                         "DIS flow-morph (fb-gated, midpoint, temporally smoothed); "
                         "flow+cdepth adds a constant-depth fallback on the sky-sky "
                         "seams where flow is gated out (wires vs flat sky). "
                         "'auto' (default) = flow+cdepth when the run is on frozen "
                         "offsets (--offsets) with temporal correction, else off")
    s9.add_argument("--frames", type=int, nargs="*", default=[],
                    help="extra QC frame indices forced into the QC set "
                         "(e.g. the parallax target-site frames)")
    s9.add_argument("--targets", default="[]",
                    help='JSON list of {"family","seam","frame","label"} parallax '
                         "target sites, scored before/after through a fixed window "
                         "and rendered as video/film-strip QC")
    s9.add_argument("--structure-first", dest="structure_first", action="store_true",
                    default=True,
                    help="rank-1 large-structure protection (DEFAULT ON): flow-morph "
                         "forbidden on protected structure (rigid verified shifts "
                         "only), single-sourcing of disagreeing structure, dynamic "
                         "sky-ring seam routing with hysteresis, frame warm-up")
    s9.add_argument("--no-structure-first", dest="structure_first", action="store_false",
                    help="disable the rank-1 structure protection (A/B / archaeology)")

    r = sub.add_parser("report", help="build the human sign-off review report for a --full run")
    r.add_argument("--run", required=True, help="run dir containing metrics.json + master + preview")

    a = sub.add_parser("approve", help="mark a run approved for site promotion")
    a.add_argument("run", help="run dir")
    a.add_argument("--by", required=True, help="approver name")

    sk = sub.add_parser("sky", help="sky-tier-only dome stitch (G/H/J) — the separate overhead element")
    sk.add_argument("--drop", required=True)
    sk.add_argument("--pts", required=True)
    sk.add_argument("--out", required=True)
    sk.add_argument("--offsets", default=None, help="per-clip sky ypr offsets json")
    sk.add_argument("--eq", type=int, nargs=2, default=[3840, 1920], metavar=("W", "H"))
    sk.add_argument("--sample", type=int, default=6)
    sk.add_argument("--feather", type=float, default=8.0, help="sky-sky blend feather in degrees")
    sk.add_argument("--fisheye", type=int, default=1600, help="fisheye deliverable size px")
    sk.add_argument("--rim", type=float, required=True,
                    help="REQUIRED, per-clip. Lower elevation bound of the sky element "
                         "(deg above horizon): the fisheye rim AND the equirect master's "
                         "bottom. No default on purpose — it must clear both the sky-sky "
                         "seam-break zone (<=~25 deg) and any structure the RING element "
                         "already owns. Roll01_Clip04 (6th St viaduct): 59 — the arch "
                         "crowns at 54.3 and belongs to the ring.")
    sk.add_argument("--patch-above", dest="patch_above", type=float, default=80.0,
                    help="inpaint uncovered pixels above this elevation (the sub-zenith "
                         "wedge the 9mm lenses leave short of the pole; default 80)")
    sk.add_argument("--no-patch", action="store_true",
                    help="leave the zenith wedge black (archival / QC)")
    sk.add_argument("--bands", type=int, default=5,
                    help="Laplacian multi-band blend levels; kills the zenith tonal "
                         "pinwheel left by per-lens vignetting (0 = flat alpha blend)")

    p2 = sub.add_parser("promote", help="crop master to full coverage + grade + watermark for the site")
    p2.add_argument("--run", required=True)
    p2.add_argument("--pts", required=True)
    p2.add_argument("--sku", required=True)
    p2.add_argument("--label", default="RING STITCH 1.0")
    p2.add_argument("--width", type=int, default=2880)

    gb = sub.add_parser("ghostbase", help="parallax loop: ghost-energy baseline over frozen seams")
    gb.add_argument("--drop", required=True, help="drop dir containing cam_A..J.mov")
    gb.add_argument("--pts", required=True, help="PTGui v33 .pts calibration project")
    gb.add_argument("--out", required=True, help="output dir (baseline.json, samples/)")
    gb.add_argument("--offsets", required=True, help="frozen sky ypr offsets JSON (verbatim)")
    gb.add_argument("--temporal", default="none", metavar="OFFSETS_JSON",
                    help="per-cam temporal offsets JSON ('none' disables)")
    gb.add_argument("--eq", type=int, nargs=2, default=[3840, 1920], metavar=("W", "H"))
    gb.add_argument("--qc-from", help="metrics.json whose qc_frame_indices to reuse")
    gb.add_argument("--frames", type=int, nargs="*", default=[],
                    help="extra QC frame indices (e.g. the target-site frames)")
    gb.add_argument("--targets", default="[]",
                    help='JSON list of {"family","seam","frame","label"} target sites')
    gb.add_argument("--no-filmstrips", dest="filmstrips", action="store_false", default=True,
                    help="skip the film-strip/video renders (metrics only)")

    args = ap.parse_args()
    if args.cmd == "gate":
        ok = Gate(args.pts, args.stills, args.gold, args.out).run()
        return 0 if ok else 1
    if args.cmd == "stitch":
        from .render import cmd_stitch

        return cmd_stitch(args)
    if args.cmd == "stitch9":
        from .ninestitch import cmd_stitch9

        return cmd_stitch9(args)
    if args.cmd == "ghostbase":
        from .parallax import cmd_ghost_baseline

        return cmd_ghost_baseline(args)
    if args.cmd == "report":
        from .report import cmd_report

        return cmd_report(args)
    if args.cmd == "approve":
        from .report import cmd_approve

        return cmd_approve(args)
    if args.cmd == "sky":
        from .skystitch import cmd_sky

        return cmd_sky(args)
    if args.cmd == "promote":
        from .promote import cmd_promote

        return cmd_promote(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
