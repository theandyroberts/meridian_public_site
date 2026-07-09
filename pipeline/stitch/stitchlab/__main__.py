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

    args = ap.parse_args()
    if args.cmd == "gate":
        ok = Gate(args.pts, args.stills, args.gold, args.out).run()
        return 0 if ok else 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
