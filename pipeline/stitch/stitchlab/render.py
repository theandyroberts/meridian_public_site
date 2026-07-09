"""Render driver for the 'stitch' subcommand: sample PNGs or full ProRes band.

Encode color pinning mirrors the decode side (see clip.py): composed frames are
full-range bgr24; the ProRes encode converts back to LIMITED-range bt709
yuv422p10le with explicit scale options and colorimetry tags.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from .clip import RingClip
from .ringstitch import RingStitcher

CAL_FRAMES = 8  # frames used for gain lock + seam freeze


def _tool_versions() -> dict:
    ff = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout.splitlines()[0]
    return {
        "ffmpeg": ff,
        "cv2": cv2.__version__,
        "numpy": np.__version__,
        "python": sys.version.split()[0],
    }


def _spread_indices(usable: int, n: int) -> list[int]:
    return sorted(set(np.linspace(0, usable - 1, n).round().astype(int).tolist()))


def _encoder_argv(clip: RingClip, stitcher: RingStitcher, out_mov: Path) -> list[str]:
    return [
        "ffmpeg", "-v", "error", "-nostdin", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{stitcher.eq_w}x{stitcher.band_h}",
        "-r", f"{clip.fps:g}",
        "-i", "pipe:0",
        # Reviewer F1: the -color_* codec flags are ignored by ffmpeg 8.0 for
        # this path — tag via setparams frame properties instead (and F3:
        # accurate_rnd+full_chroma_int for exact levels). Verified by the
        # post-encode ffprobe assertion in cmd_stitch.
        "-vf",
        "scale=in_range=full:out_range=limited:out_color_matrix=bt709"
        ":flags=accurate_rnd+full_chroma_int,format=yuv422p10le,"
        "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
        "-c:v", "prores_ks", "-profile:v", "3",
        "-color_range", "tv", "-colorspace", "bt709",
        "-color_primaries", "bt709", "-color_trc", "bt709",
        str(out_mov),
    ]


def _preview_argv(in_mov: Path, out_mp4: Path) -> list[str]:
    return [
        "ffmpeg", "-v", "error", "-nostdin", "-y",
        "-i", str(in_mov),
        "-vf",
        "scale=2880:-2:flags=accurate_rnd+full_chroma_int,format=yuv420p,"
        "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
        "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        "-movflags", "+faststart",
        str(out_mp4),
    ]


def cmd_stitch(args) -> int:
    t_start = time.perf_counter()
    timings: dict[str, float] = {}
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    clip = RingClip(Path(args.drop))
    timings["probe_and_align_s"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    stitcher = RingStitcher(args.pts, src_w=clip.width, src_h=clip.height)
    timings["lut_bake_s"] = time.perf_counter() - t0

    cal_idx = _spread_indices(clip.usable_frames, CAL_FRAMES)
    t0 = time.perf_counter()
    stitcher.calibrate(clip.read_frames(cal_idx))
    timings["calibrate_s"] = time.perf_counter() - t0

    metrics = {
        "drop": str(Path(args.drop).resolve()),
        "pts": str(Path(args.pts).resolve()),
        "cams": {
            l: {
                "path": str(c.path),
                "real_path": str(c.real_path),
                "timecode": c.timecode,
                "tc_frame": c.tc_frame,
                "offset_frames": c.offset,
                "nb_frames": c.nb_frames,
                "fps": c.fps,
                "pix_fmt": c.pix_fmt,
                "color_range": c.color_range,
                "size_bytes": c.size_bytes,
                "sha256_first_1mb": c.sha256_first_1mb,
            }
            for l, c in clip.cams.items()
        },
        "usable_frames": clip.usable_frames,
        "fps": clip.fps,
        "src": {"width": clip.width, "height": clip.height},
        "calibration_frame_indices": cal_idx,
        **stitcher.report(),
        "tool_versions": _tool_versions(),
        # F8: full provenance — calibration file hash + stitchlab code version
        "pts_sha256": hashlib.sha256(open(args.pts, "rb").read()).hexdigest(),
        "stitchlab_git_head": subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=Path(__file__).parent,
        ).stdout.strip(),
    }

    outputs = []
    if args.full:
        mov_path = out_dir / f"{Path(args.drop).resolve().name}_ringband_prores.mov"
        enc_argv = _encoder_argv(clip, stitcher, mov_path)
        clip.ffmpeg_calls.append(enc_argv)
        t0 = time.perf_counter()
        n_done = 0
        # Reviewer F5/F7: spool encoder stderr to a file (no pipe deadlock) and
        # never let encoder-exit checking mask the primary render exception.
        errf = tempfile.NamedTemporaryFile(prefix="stitch-enc-", suffix=".stderr", delete=False)
        enc = subprocess.Popen(enc_argv, stdin=subprocess.PIPE, stderr=errf)
        errf.close()
        primary_exc = None
        try:
            for _, frames in clip.iter_frames():
                band = stitcher.compose_frame(frames)
                enc.stdin.write(band.tobytes())
                n_done += 1
        except BaseException as e:
            primary_exc = e
            raise
        finally:
            try:
                enc.stdin.close()
            except Exception:
                pass
            rc = enc.wait()
            err_txt = ""
            if os.path.exists(errf.name):
                err_txt = open(errf.name, "rb").read().decode(errors="replace")[-2000:]
                os.unlink(errf.name)
            if rc != 0 and primary_exc is None:
                raise RuntimeError(f"prores encode failed (rc={rc}): {err_txt}")
        # F1 assertion: the master must carry explicit colr tags
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
             "stream=color_space,color_range,color_transfer,color_primaries",
             "-of", "json", str(mov_path)],
            capture_output=True, text=True, check=True,
        )
        tags = json.loads(probe.stdout)["streams"][0]
        metrics["master_color_tags"] = tags
        if tags.get("color_space") != "bt709" or tags.get("color_range") != "tv":
            raise RuntimeError(f"master colorimetry tags wrong/missing: {tags}")
        timings["render_full_s"] = time.perf_counter() - t0
        metrics["achieved_fps_full"] = n_done / timings["render_full_s"]
        metrics["full_frames_rendered"] = n_done
        outputs.append(str(mov_path))

        prev_path = out_dir / "preview_2880.mp4"
        prev_argv = _preview_argv(mov_path, prev_path)
        clip.ffmpeg_calls.append(prev_argv)
        t0 = time.perf_counter()
        subprocess.run(prev_argv, check=True, capture_output=True)
        timings["preview_encode_s"] = time.perf_counter() - t0
        outputs.append(str(prev_path))
    else:
        samples_dir = out_dir / "samples"
        samples_dir.mkdir(parents=True, exist_ok=True)
        # F8: don't QC on the frames the seams were calibrated on — offset by half a stride
        cal_set = set(cal_idx)
        sample_idx = [
            min(clip.usable_frames - 1, i + max(1, clip.usable_frames // (2 * max(1, args.sample))))
            for i in _spread_indices(clip.usable_frames, args.sample)
        ]
        sample_idx = sorted(set(sample_idx))
        if set(sample_idx) & cal_set and len(sample_idx) > 1:
            sample_idx = [i for i in sample_idx if i not in cal_set] or sample_idx
        t0 = time.perf_counter()
        n_done = 0
        for i, frames in clip.read_frames(sample_idx):
            band = stitcher.compose_frame(frames)
            png = samples_dir / f"frame_{i:06d}.png"
            cv2.imwrite(str(png), band)
            outputs.append(str(png))
            n_done += 1
        timings["render_samples_s"] = time.perf_counter() - t0
        metrics["achieved_fps_samples"] = n_done / timings["render_samples_s"]
        metrics["sample_frame_indices"] = sample_idx

    timings["total_s"] = time.perf_counter() - t_start
    metrics["timings"] = {k: round(v, 3) for k, v in timings.items()}
    metrics["outputs"] = outputs
    metrics["ffmpeg_subprocess_argv"] = clip.ffmpeg_calls

    metrics_path = out_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2))
    print(f"wrote {metrics_path}")
    for o in outputs:
        print(f"wrote {o}")
    return 0
