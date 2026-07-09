"""Ring clip discovery, timecode alignment, and color-pinned frame decoding.

COLOR PINNING (critical, historical trap)
-----------------------------------------
The drop footage is Apple ProRes, yuv422p10le, bt709 primaries/matrix/transfer,
LIMITED (video/tv) range. Every decode in this module goes through the exact
same explicit filter chain so the black/white points and the RGB matrix are
pinned and IDENTICAL for all cameras (never left to swscale auto-guessing):

    [select='eq(n,i0)+eq(n,i1)+...']                 (only when cherry-picking)
    scale=in_range=limited:out_range=full:in_color_matrix=bt709
    format=bgr24

i.e. limited->full range expansion + bt709 YUV->RGB matrix, decoded to 8-bit
BGR raw video on stdout (`-f rawvideo -pix_fmt bgr24`). `-fps_mode passthrough`
keeps ffmpeg from duplicating/dropping frames around the select filter.

Timecode alignment
------------------
Each camera's start timecode (from the video stream `timecode` tag, falling
back to format tags) is converted to an absolute frame number at the integer
frame rate. All cameras are aligned to the LATEST start: a camera that rolled
earlier skips (latest - own_start) frames. `usable_frames` is the minimum of
(nb_frames - skip) over the ring. A TC spread greater than `max_tc_spread`
frames aborts with a clear message (that indicates a slate/jam-sync problem,
not something to silently absorb).
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
from dataclasses import dataclass, field
from fractions import Fraction
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np

RING_LETTERS = "ABCDEF"

#: The pinned decode filter chain (see module docstring).
# accurate_rnd+full_chroma_int: without them swscale compresses levels ~0.8%
# (Y940 white decodes to RGB 253 instead of 255) — reviewer finding F3.
COLOR_FILTER = (
    "scale=in_range=limited:out_range=full:in_color_matrix=bt709"
    ":flags=accurate_rnd+full_chroma_int,format=bgr24"
)


def parse_timecode(tc: str, fps_int: int) -> int:
    """SMPTE timecode string -> absolute frame number at integer fps.

    Non-drop-frame only (24 fps footage). Drop-frame (';' separator) is
    rejected loudly rather than mis-counted.
    """
    if ";" in tc:
        raise ValueError(f"drop-frame timecode not supported: {tc!r}")
    parts = tc.strip().split(":")
    if len(parts) != 4:
        raise ValueError(f"unparseable timecode {tc!r}")
    hh, mm, ss, ff = (int(p) for p in parts)
    if ff >= fps_int:
        raise ValueError(f"timecode {tc!r} has frame field {ff} >= fps {fps_int}")
    return ((hh * 60 + mm) * 60 + ss) * fps_int + ff


def align_offsets(tc_frames: dict[str, int], max_tc_spread: int = 12) -> dict[str, int]:
    """Per-camera skip offsets aligning every camera to the LATEST start TC."""
    latest = max(tc_frames.values())
    spread = latest - min(tc_frames.values())
    if spread > max_tc_spread:
        detail = ", ".join(f"{k}={v}" for k, v in sorted(tc_frames.items()))
        raise ValueError(
            f"camera start-TC spread is {spread} frames (> {max_tc_spread}); "
            f"timecode jam-sync looks broken. Start frames: {detail}"
        )
    return {k: latest - v for k, v in tc_frames.items()}


@dataclass
class CamStream:
    letter: str
    path: Path  # the path as given (symlink preserved)
    real_path: Path
    timecode: str
    fps: float
    nb_frames: int
    duration: float
    width: int
    height: int
    pix_fmt: str
    color_range: str
    color_space: str = ""
    tc_frame: int = 0
    offset: int = 0
    size_bytes: int = 0
    sha256_first_1mb: str = ""


@dataclass
class RingClip:
    """Discover cam_<X>.mov in a drop dir, align by TC, decode pinned frames."""

    drop_dir: Path
    letters: str = RING_LETTERS
    max_tc_spread: int = 12
    cams: dict[str, CamStream] = field(default_factory=dict, init=False)
    ffmpeg_calls: list[list[str]] = field(default_factory=list, init=False)

    def __post_init__(self):
        self.drop_dir = Path(self.drop_dir)
        for letter in self.letters:
            path = self.drop_dir / f"cam_{letter}.mov"
            if not path.exists():
                raise FileNotFoundError(f"missing ring camera file: {path}")
            self.cams[letter] = self._probe(letter, path)

        fpss = {c.fps for c in self.cams.values()}
        if len(fpss) != 1:
            raise ValueError(f"mixed frame rates across ring cams: {fpss}")
        # Reviewer F2: the decode chain relies on the file's colr tag — an
        # untagged/re-transcoded source silently decodes bt601. Refuse it.
        bad_cs = {l: c.color_space for l, c in self.cams.items() if c.color_space != "bt709"}
        if bad_cs:
            raise ValueError(
                f"cams without bt709 color_space tag {bad_cs} — decode matrix would be "
                f"guessed (bt601 trap). Re-tag the source or extend COLOR_FILTER deliberately."
            )
        self.fps = fpss.pop()
        fps_int = round(self.fps)

        tc_frames = {}
        for letter, cam in self.cams.items():
            cam.tc_frame = parse_timecode(cam.timecode, fps_int)
            tc_frames[letter] = cam.tc_frame
        offsets = align_offsets(tc_frames, self.max_tc_spread)
        for letter, off in offsets.items():
            self.cams[letter].offset = off
        self.usable_frames = min(c.nb_frames - c.offset for c in self.cams.values())

        for cam in self.cams.values():
            cam.size_bytes = cam.real_path.stat().st_size
            with open(cam.real_path, "rb") as fh:
                cam.sha256_first_1mb = hashlib.sha256(fh.read(1024 * 1024)).hexdigest()

        self.width = self.cams[self.letters[0]].width
        self.height = self.cams[self.letters[0]].height

    @property
    def offsets(self) -> dict[str, int]:
        return {letter: cam.offset for letter, cam in self.cams.items()}

    # ------------------------------------------------------------- probing

    def _probe(self, letter: str, path: Path) -> CamStream:
        argv = ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]
        self.ffmpeg_calls.append(argv)
        out = subprocess.run(argv, capture_output=True, text=True, check=True).stdout
        doc = json.loads(out)
        video = next(s for s in doc["streams"] if s.get("codec_type") == "video")
        fmt = doc["format"]

        tc = video.get("tags", {}).get("timecode") or fmt.get("tags", {}).get("timecode")
        if not tc:  # fall back to a tmcd data stream tag
            for s in doc["streams"]:
                tc = s.get("tags", {}).get("timecode")
                if tc:
                    break
        if not tc:
            raise ValueError(f"{path}: no start timecode in stream or format tags")

        fps = float(Fraction(video["r_frame_rate"]))
        nb = int(video.get("nb_frames") or 0)
        duration = float(video.get("duration") or fmt.get("duration") or 0.0)
        if nb <= 0:
            nb = int(round(duration * fps))

        return CamStream(
            letter=letter,
            path=path,
            real_path=path.resolve(),
            timecode=tc,
            fps=fps,
            nb_frames=nb,
            duration=duration,
            width=int(video["width"]),
            height=int(video["height"]),
            pix_fmt=str(video.get("pix_fmt", "")),
            color_range=str(video.get("color_range", "")),
            color_space=str(video.get("color_space", "")),
        )

    # ------------------------------------------------------------ decoding

    def _spawn_decoder(self, letter: str, vf: str) -> subprocess.Popen:
        cam = self.cams[letter]
        argv = [
            "ffmpeg", "-v", "error", "-nostdin",
            "-i", str(cam.path),
            "-vf", vf,
            "-fps_mode", "passthrough",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "pipe:1",
        ]
        self.ffmpeg_calls.append(argv)
        # Reviewer F5: stderr piped-but-unread can deadlock a long render if a
        # decoder gets chatty; spool it to a temp file instead (read on error).
        errf = tempfile.NamedTemporaryFile(
            prefix=f"stitch-dec-{letter}-", suffix=".stderr", delete=False
        )
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=errf)
        proc._stderr_path = errf.name  # type: ignore[attr-defined]
        errf.close()
        return proc

    @staticmethod
    def _read_exact(proc: subprocess.Popen, n: int, label: str) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            chunk = proc.stdout.read(n - len(buf))
            if not chunk:
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
                err = ""
                err_path = getattr(proc, "_stderr_path", None)
                if err_path and os.path.exists(err_path):
                    err = open(err_path, "rb").read().decode(errors="replace")[-2000:]
                raise IOError(
                    f"short read from ffmpeg decoder for {label}: got {len(buf)}/{n} bytes. "
                    f"stderr: {err}"
                )
            buf.extend(chunk)
        return bytes(buf)

    def read_frames(self, indices: Iterable[int]) -> Iterator[tuple[int, dict[str, np.ndarray]]]:
        """Yield (aligned_index, {letter: BGR uint8 frame}) for the given
        aligned frame indices (must be ascending). One ffmpeg per camera with a
        select filter; frames are streamed, never more than one set in memory.
        """
        idx = sorted(set(int(i) for i in indices))
        if not idx:
            return
        if idx[0] < 0 or idx[-1] >= self.usable_frames:
            raise IndexError(f"aligned indices {idx[0]}..{idx[-1]} outside 0..{self.usable_frames - 1}")
        frame_bytes = self.width * self.height * 3
        procs = {}
        try:
            for letter in self.letters:
                off = self.cams[letter].offset
                expr = "+".join(f"eq(n,{off + i})" for i in idx)
                procs[letter] = self._spawn_decoder(letter, f"select='{expr}',{COLOR_FILTER}")
            for i in idx:
                frames = {}
                for letter in self.letters:
                    raw = self._read_exact(procs[letter], frame_bytes, f"cam_{letter} frame {i}")
                    frames[letter] = np.frombuffer(raw, np.uint8).reshape(self.height, self.width, 3)
                yield i, frames
        finally:
            for p in procs.values():
                if p.poll() is None:
                    p.kill()
                p.stdout.close()
                err_path = getattr(p, "_stderr_path", None)
                if err_path and os.path.exists(err_path):
                    os.unlink(err_path)

    def iter_frames(self, start: int = 0, count: int | None = None) -> Iterator[tuple[int, dict[str, np.ndarray]]]:
        """Sequentially stream every aligned frame from `start` (full reads)."""
        if count is None:
            count = self.usable_frames - start
        count = min(count, self.usable_frames - start)
        frame_bytes = self.width * self.height * 3
        procs = {}
        try:
            for letter in self.letters:
                off = self.cams[letter].offset
                procs[letter] = self._spawn_decoder(
                    letter, f"select='gte(n,{off + start})',{COLOR_FILTER}"
                )
            for i in range(start, start + count):
                frames = {}
                for letter in self.letters:
                    raw = self._read_exact(procs[letter], frame_bytes, f"cam_{letter} frame {i}")
                    frames[letter] = np.frombuffer(raw, np.uint8).reshape(self.height, self.width, 3)
                yield i, frames
        finally:
            for p in procs.values():
                if p.poll() is None:
                    p.kill()
                p.stdout.close()
                err_path = getattr(p, "_stderr_path", None)
                if err_path and os.path.exists(err_path):
                    os.unlink(err_path)
