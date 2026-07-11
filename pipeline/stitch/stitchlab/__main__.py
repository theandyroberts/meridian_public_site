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

    r = sub.add_parser("report", help="build the human sign-off review report for a --full run")
    r.add_argument("--run", required=True, help="run dir containing metrics.json + master + preview")

    a = sub.add_parser("approve", help="mark a run approved for site promotion")
    a.add_argument("run", help="run dir")
    a.add_argument("--by", required=True, help="approver name")

    p2 = sub.add_parser("promote", help="crop master to full coverage + grade + watermark for the site")
    p2.add_argument("--run", required=True)
    p2.add_argument("--pts", required=True)
    p2.add_argument("--sku", required=True)
    p2.add_argument("--label", default="RING STITCH 1.0")
    p2.add_argument("--width", type=int, default=2880)

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
    if args.cmd == "report":
        from .report import cmd_report

        return cmd_report(args)
    if args.cmd == "approve":
        from .report import cmd_approve

        return cmd_approve(args)
    if args.cmd == "promote":
        from .promote import cmd_promote

        return cmd_promote(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
