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

    r = sub.add_parser("report", help="build the human sign-off review report for a --full run")
    r.add_argument("--run", required=True, help="run dir containing metrics.json + master + preview")

    a = sub.add_parser("approve", help="mark a run approved for site promotion")
    a.add_argument("run", help="run dir")
    a.add_argument("--by", required=True, help="approver name")

    args = ap.parse_args()
    if args.cmd == "gate":
        ok = Gate(args.pts, args.stills, args.gold, args.out).run()
        return 0 if ok else 1
    if args.cmd == "stitch":
        from .render import cmd_stitch

        return cmd_stitch(args)
    if args.cmd == "report":
        from .report import cmd_report

        return cmd_report(args)
    if args.cmd == "approve":
        from .report import cmd_approve

        return cmd_approve(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
