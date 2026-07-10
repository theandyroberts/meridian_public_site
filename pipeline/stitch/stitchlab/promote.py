"""Promote an approved ring-stitch master into a site-ready preview.

Crops the equirect band to the largest full-width rectangle with NO black
(rows where all 3840 columns are covered by at least one camera), applies the
site's log viewing grade + watermark chain, and writes the drop-in replacement
for the plate's stitched_preview.mp4. The uncropped master is untouched.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

from . import geometry as G
from .pts import load_pts

# must mirror pipeline/src/stages/renditions.ts
PREVIEW_GRADE = "eq=contrast=1.22:saturation=1.45:gamma=1.06"
FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _watermark(font: str, sku: str, label: str) -> str:
    big = (
        f"drawtext=fontfile={font}:text='{_esc('PLATE LAB · PREVIEW')}'"
        f":fontsize=h/9:fontcolor=white@0.16:x=(w-text_w)/2:y=(h-text_h)/2"
    )
    corner = (
        f"drawtext=fontfile={font}:text='{_esc(f'{sku} · NOT FOR PRODUCTION')}'"
        f":fontsize=h/24:fontcolor=white@0.55:x=12:y=h-text_h-10"
    )
    tag = (
        f",drawtext=fontfile={font}:text='{_esc(label)}'"
        f":fontsize=h/16:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=8:x=12:y=10"
    )
    return f"{big},{corner}{tag}"


def full_coverage_rows(pts_path: str, src_w: int, src_h: int, eq_w: int, eq_h: int):
    """Rows of the equirect where the ring covers every column."""
    proj = load_pts(pts_path)
    rays = G.equirect_rays(eq_w, eq_h)
    union = np.zeros((eq_h, eq_w), bool)
    for cam in proj.ring:
        _, _, valid = G.camera_maps(cam, eq_w, eq_h, src_w, src_h, rays=rays)
        union |= valid
    full = union.all(axis=1)
    rows = np.where(full)[0]
    if rows.size == 0:
        raise ValueError("no full-coverage rows — check calibration")
    return int(rows.min()), int(rows.max())


def cmd_promote(args) -> int:
    run_dir = Path(args.run)
    metrics = json.loads((run_dir / "metrics.json").read_text())
    master = next(run_dir.glob("*_ringband_prores.mov"))
    src = metrics["src"]
    eq = metrics["eq"]
    band_r0 = metrics["band"]["r0"]

    top, bot = full_coverage_rows(args.pts, src["width"], src["height"], eq["width"], eq["height"])
    y0 = top - band_r0
    h = bot - top + 1
    h -= h % 2
    if y0 < 0:
        raise ValueError(f"full-coverage top {top} above band start {band_r0}")

    font = next(f for f in FONT_CANDIDATES if Path(f).exists())
    out = run_dir / "promoted_preview.mp4"
    vf = (
        f"crop={eq['width']}:{h}:0:{y0},"
        f"scale={args.width}:-2:flags=accurate_rnd+full_chroma_int,"
        f"{PREVIEW_GRADE},"
        f"{_watermark(font, args.sku, args.label)},"
        f"format=yuv420p,"
        f"setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited"
    )
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-nostdin", "-y",
            "-i", str(master),
            "-vf", vf,
            "-c:v", "libx264", "-crf", "24", "-preset", "medium",
            "-movflags", "+faststart", "-an", str(out),
        ],
        check=True,
    )
    result = {
        "promoted": str(out),
        "crop": {"y0_band": y0, "height": h, "rows_equirect": [top, bot]},
        "sku": args.sku,
        "label": args.label,
    }
    (run_dir / "promoted.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return 0
