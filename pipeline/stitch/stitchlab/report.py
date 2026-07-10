"""Stitch review report — the human sign-off surface.

Consumes a completed `stitch --full` run dir and produces a self-contained
`index.html`: side-by-side candidate vs baseline videos, a wipe slider over
matched frames, per-seam zoom crops, and the metrics/provenance table.
The baseline is a TC-aligned naive hconcat of the same six cameras (what the
site's fake pano would look like with the same alignment), rendered here so
the comparison is like-for-like: same frames, same scale, no grade on either.

A run is 'approved' by `python -m stitchlab approve <run-dir> --by <name>`,
which writes approved.json next to metrics.json; the ingest stage will only
promote approved runs.
"""

from __future__ import annotations

import base64
import html
import json
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

from .clip import RingClip, COLOR_FILTER


def _baseline_hconcat(clip: RingClip, out_mp4: Path, width: int = 2880) -> None:
    """TC-aligned naive hconcat of the ring in yaw order (E F A B C D)."""
    order = ["E", "F", "A", "B", "C", "D"]
    tile_w = width // len(order)
    tile_h = int(round(tile_w * clip.height / clip.width / 2) * 2)
    inputs, filters = [], []
    for k, letter in enumerate(order):
        cam = clip.cams[letter]
        inputs += ["-i", str(cam.path)]
        filters.append(
            f"[{k}:v]select='gte(n,{cam.offset})',setpts=N/FRAME_RATE/TB,"
            f"scale={tile_w}:{tile_h}:flags=accurate_rnd+full_chroma_int[t{k}]"
        )
    layout = "|".join(f"{i * tile_w}_0" for i in range(len(order)))
    graph = (
        ";".join(filters)
        + ";"
        + "".join(f"[t{k}]" for k in range(len(order)))
        + f"xstack=inputs={len(order)}:layout={layout},"
        + "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited[out]"
    )
    argv = [
        "ffmpeg", "-v", "error", "-nostdin", "-y",
        *inputs,
        "-filter_complex", graph, "-map", "[out]",
        "-frames:v", str(clip.usable_frames),
        "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(out_mp4),
    ]
    subprocess.run(argv, check=True, capture_output=True)


def _grab_frame(video: Path, index: int, fps: float) -> np.ndarray:
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video),
         "-vf", f"select='eq(n,{index})'", "-frames:v", "1",
         "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
        capture_output=True, check=True,
    ).stdout
    img = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"could not grab frame {index} from {video}")
    return img


def _b64_jpg(img: np.ndarray, q: int = 82) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def cmd_report(args) -> int:
    run_dir = Path(args.run)
    metrics = json.loads((run_dir / "metrics.json").read_text())
    master = next(run_dir.glob("*_ringband_prores.mov"))
    preview = run_dir / "preview_2880.mp4"
    drop = Path(metrics["drop"])

    baseline = run_dir / "baseline_hconcat_2880.mp4"
    if not baseline.exists():
        # only needs the source footage when the baseline hasn't been built yet
        _baseline_hconcat(RingClip(drop), baseline)

    # matched wipe frames: mid-clip and two spreads, candidate vs baseline
    fps = float(metrics.get("fps", 24.0))
    n = metrics["full_frames_rendered"]
    wipe_idx = [n // 5, n // 2, (4 * n) // 5]
    wipes = []
    for i in wipe_idx:
        cand = _grab_frame(preview, i, fps)
        base = _grab_frame(baseline, i, fps)
        h = min(cand.shape[0], base.shape[0])
        w = min(cand.shape[1], base.shape[1])
        wipes.append(
            {
                "index": i,
                "cand": _b64_jpg(cand[:h, :w]),
                "base": _b64_jpg(base[:h, :w]),
                "w": w,
                "h": h,
            }
        )

    # seam zoom crops from the full-res master, mid-clip frame
    mid = _grab_frame(master, n // 2, fps)
    band_h = mid.shape[0]
    crops = []
    for seam in metrics["seams"]:
        col = int(seam["seam_col"] * mid.shape[1] / metrics["eq"]["width"])
        half = 150
        x0 = max(0, col - half)
        x1 = min(mid.shape[1], col + half)
        crop = mid[:, x0:x1]
        crop = cv2.resize(crop, (crop.shape[1] * 2, crop.shape[0] * 2), interpolation=cv2.INTER_NEAREST)
        crops.append({"pair": seam["pair"], "col": seam["seam_col"],
                      "diff": seam["mean_abs_linear_diff"], "img": _b64_jpg(crop)})

    rows = "".join(
        f"<tr><td>{html.escape(str(k))}</td><td><code>{html.escape(json.dumps(v) if not isinstance(v, str) else v)}</code></td></tr>"
        for k, v in [
            ("drop", metrics["drop"]),
            ("frames rendered", metrics.get("full_frames_rendered")),
            ("fps achieved", round(metrics.get("achieved_fps_full", 0), 2)),
            ("band", metrics["band"]),
            ("gains", {k: round(v, 4) for k, v in metrics["gains"].items()}),
            ("TC offsets", {l: c["offset_frames"] for l, c in metrics["cams"].items()}),
            ("seam columns (lon deg)", {s["pair"]: s["seam_lon_deg"] for s in metrics["seams"]}),
            ("master color tags", metrics.get("master_color_tags")),
            ("pts sha256", metrics.get("pts_sha256", "")[:16]),
            ("stitchlab git", metrics.get("stitchlab_git_head")),
            ("ffmpeg", metrics["tool_versions"]["ffmpeg"].split("Copyright")[0].strip()),
        ]
    )

    wipe_html = ""
    for k, wp in enumerate(wipes):
        wipe_html += f"""
<div class="wipe" data-k="{k}" style="max-width:{wp['w']}px">
  <div class="frame" style="aspect-ratio:{wp['w']}/{wp['h']}">
    <img src="{wp['base']}" alt="baseline">
    <img src="{wp['cand']}" class="top" alt="candidate">
  </div>
  <input type="range" min="0" max="100" value="50" oninput="wipe(this)">
  <p class="mono">frame {wp['index']} — drag: left = TRUE STITCH, right = current hconcat</p>
</div>"""

    crops_html = "".join(
        f"""<figure><img src="{c['img']}"><figcaption class="mono">seam {c['pair']} @ lon {c['col']}° ·
        mean linear diff {c['diff']:.4f}</figcaption></figure>"""
        for c in crops
    )

    page = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Stitch review — {html.escape(drop.name)}</title>
<style>
 body{{background:#0e0e10;color:#f4f1ea;font:15px/1.5 -apple-system,sans-serif;margin:0;padding:32px}}
 h1,h2{{font-weight:600}} h1{{border-bottom:2px solid #c56b3e;padding-bottom:12px}}
 .mono{{font-family:ui-monospace,monospace;font-size:12px;color:#8a8780;letter-spacing:.04em}}
 video{{width:100%;display:block;background:#000}}
 .stack{{display:grid;gap:20px;max-width:1800px}}
 .wipe .frame{{position:relative;overflow:hidden}}
 .wipe img{{position:absolute;inset:0;width:100%}}
 .wipe img.top{{clip-path:inset(0 50% 0 0)}}
 .wipe input{{width:100%}}
 table{{border-collapse:collapse;width:100%;max-width:900px}}
 td{{border-bottom:1px solid #26262c;padding:6px 10px;vertical-align:top}}
 code{{color:#d59e7e}}
 figure{{margin:0 0 20px}} figure img{{max-width:100%;border:1px solid #26262c}}
 .approve{{border:1px solid #c56b3e;padding:16px 20px;margin:32px 0;max-width:900px}}
</style></head><body>
<h1>Stitch review — {html.escape(drop.name)}</h1>
<p class="mono">run: {html.escape(str(run_dir.resolve()))} · generated {time.strftime('%Y-%m-%d %H:%M')}</p>

<h2>Candidate (true stitch) vs current (hconcat)</h2>
<div class="stack">
  <div><video src="preview_2880.mp4" controls muted loop></video><p class="mono">ROW 1 — TRUE STITCH candidate</p></div>
  <div><video src="baseline_hconcat_2880.mp4" controls muted loop></video><p class="mono">ROW 2 — current site pano (TC-aligned hconcat)</p></div>
</div>
<p><button onclick="document.querySelectorAll('video').forEach(v=>{{v.currentTime=0;v.play()}})">▶ play both in sync</button></p>

<h2>Run metrics &amp; provenance</h2>
<table>{rows}</table>

<h2>Stitch details (wipe comparison)</h2>
{wipe_html}

<h3>Seam zoom crops (full-res master, 2x)</h3>
{crops_html}

<div class="approve">
<b>Approve this run:</b>
<pre class="mono">cd pipeline/stitch && ./.venv/bin/python -m stitchlab approve {html.escape(str(run_dir))} --by "Andy"</pre>
Nothing ships to the site until a run is approved; the current hconcat preview stays live meanwhile.
</div>
<script>
function wipe(r){{r.closest('.wipe').querySelector('.top').style.clipPath=`inset(0 ${{100-r.value}}% 0 0)`}}
</script>
</body></html>"""

    out = run_dir / "index.html"
    out.write_text(page)
    print(f"report: {out}")
    return 0


def cmd_approve(args) -> int:
    run_dir = Path(args.run)
    if not (run_dir / "metrics.json").exists():
        print(f"no metrics.json in {run_dir}")
        return 1
    (run_dir / "approved.json").write_text(
        json.dumps({"approvedBy": args.by, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}, indent=2)
    )
    print(f"approved by {args.by}")
    return 0
