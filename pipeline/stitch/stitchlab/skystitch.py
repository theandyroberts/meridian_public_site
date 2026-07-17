"""Sky-tier-only stitch — the overhead dome element, delivered separately.

WHY THIS EXISTS (Andy, 2026-07-13): volumetric stages are built as two surfaces —
a 360 LED cylinder carrying the horizontal band, and a separate overhead/flat LED
carrying the sky for reflections and top-light. So the two elements are CONSUMED
separately, and there is no reason to composite them into one sphere.

Not compositing them also dissolves the entire class of defects that killed the
ALL-9 candidates: the doubled arch crowns, comb rectangles, and flank steps were
all sky-vs-ring BOUNDARY artifacts — the boundary ran straight through the most
prominent structure in frame. With no boundary, the ring keeps its own clean
pixels (RING 1.0, already approved) and the sky dome is stitched from G/H/J alone.

The only seams here are sky-sky (G-H, H-J, J-G). Coverage from the Mercy01 sky
tier (Laowa 9mm, pitch ~52, hfov ~107.6, yaws ~0/125/-117) is roughly elevation
+16 deg to near-zenith, tiling the upper hemisphere on its own.

Outputs:
  equirect  — upper-hemisphere band (lat_min..90), the archival/master form
  fisheye   — angular projection looking straight up: the natural form for a
              flat overhead LED panel
"""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import cv2
import numpy as np

from . import geometry as G
from .clip import RingClip
from .pts import load_pts

SKY = "GHJ"
GAMMA = 2.4


def to_linear(img: np.ndarray) -> np.ndarray:
    return np.power(img.astype(np.float32) / 255.0, GAMMA)


def from_linear(lin: np.ndarray) -> np.ndarray:
    return (np.power(np.clip(lin, 0.0, 1.0), 1.0 / GAMMA) * 255.0).astype(np.uint8)


def sky_cameras(pts_path: str, offsets_path: str | None):
    """Sky cams with per-clip refined ypr offsets applied."""
    proj = load_pts(pts_path)
    offs = {}
    if offsets_path and Path(offsets_path).exists():
        offs = json.loads(Path(offsets_path).read_text())
    cams = {}
    for letter in SKY:
        cam = copy.deepcopy(proj.by_letter[letter])
        d = offs.get(letter, {})
        cam.yaw += float(d.get("yaw", 0.0))
        cam.pitch += float(d.get("pitch", 0.0))
        cam.roll += float(d.get("roll", 0.0))
        cams[letter] = cam
    return cams


def bake_maps(cams, eq_w: int, eq_h: int, src_w: int, src_h: int):
    rays = G.equirect_rays(eq_w, eq_h)
    out = {}
    for letter, cam in cams.items():
        out[letter] = G.camera_maps(cam, eq_w, eq_h, src_w, src_h, rays=rays)
    return out


def solve_gains(frames_list, maps, anchor: str = "G") -> dict[str, float]:
    """Per-camera scalar gain in linear light, least-squares over sky-sky overlaps,
    normalized so max gain == 1.0 (never clip highlights)."""
    import itertools

    sums: dict[tuple[str, str], list[float]] = {}
    for frames in frames_list:
        warped = {}
        for letter in SKY:
            mx, my, valid = maps[letter]
            warped[letter] = (to_linear(G.warp(frames[letter], mx, my)).mean(axis=2), valid)
        for a, b in itertools.combinations(SKY, 2):
            both = warped[a][1] & warped[b][1]
            if both.sum() < 2000:
                continue
            ma, mb = warped[a][0][both].mean(), warped[b][0][both].mean()
            if ma > 1e-5 and mb > 1e-5:
                sums.setdefault((a, b), []).append(mb / ma)
    gains = {l: 1.0 for l in SKY}
    for _ in range(20):  # simple iterative balance
        for (a, b), ratios in sums.items():
            r = float(np.median(ratios))
            adjust = math.sqrt(r * gains[a] / max(gains[b], 1e-6))
            gains[b] *= adjust ** 0.3
            gains[a] /= adjust ** 0.3
    gmax = max(gains.values())
    return {l: v / gmax for l, v in gains.items()}


def build_weights(cams, maps, eq_w: int, eq_h: int, gains, feather_deg: float = 8.0):
    """Per-camera blend weights: nearest-yaw ownership with an angular feather.

    Sky cams converge at zenith, so weighting on angular distance to each
    camera's optical axis (not column distance) keeps the blend sane all the
    way up the dome.
    """
    rays = G.equirect_rays(eq_w, eq_h)
    axis_dist = {}
    for letter, cam in cams.items():
        R = G.rotation(cam.yaw, cam.pitch, cam.roll)
        axis = R @ np.array([0.0, 0.0, 1.0])  # camera forward in world
        dot = np.clip(
            axis[0] * rays[0] + axis[1] * rays[1] + axis[2] * rays[2], -1.0, 1.0
        )
        axis_dist[letter] = np.degrees(np.arccos(dot))

    stack = np.stack([axis_dist[l] for l in SKY])  # (3, H, W)
    best = stack.min(axis=0)
    weights = {}
    for k, letter in enumerate(SKY):
        valid = maps[letter][2]
        # 1 where this cam is closest to its axis; ramp out over `feather_deg`
        w = np.clip(1.0 - (stack[k] - best) / max(feather_deg, 1e-3), 0.0, 1.0)
        w = np.where(valid, w, 0.0).astype(np.float32)
        weights[letter] = w * gains[letter]
    total = sum(weights.values()) + 1e-6
    for letter in SKY:
        weights[letter] = (weights[letter] / total).astype(np.float32)
    coverage = np.zeros((eq_h, eq_w), bool)
    for letter in SKY:
        coverage |= maps[letter][2]
    return weights, coverage


def compose(frames, maps, weights, eq_w: int, eq_h: int, bands: int = 0) -> np.ndarray:
    """Blend the sky cams in linear light.

    bands=0 -> flat alpha blend (every frequency blended over the same feather).
    bands>0 -> Laplacian multi-band: low frequencies blended over a very wide
    band, high frequencies over a narrow one.

    Multi-band exists here for a photometric reason, not a geometric one. A
    single scalar gain per camera cannot absorb lens vignetting, so the three
    cameras disagree on low-frequency brightness where they converge at the
    zenith, showing as a faint tonal pinwheel. Blending the low frequencies
    over a wide support spreads that disagreement out below visibility. It
    cannot help parallax: high frequencies still blend narrowly, which is the
    point — wires stay sharp.
    """
    warped = {}
    for letter in SKY:
        mx, my, _ = maps[letter]
        warped[letter] = to_linear(G.warp(frames[letter], mx, my))
    if bands <= 0:
        acc = np.zeros((eq_h, eq_w, 3), np.float32)
        for letter in SKY:
            acc += warped[letter] * weights[letter][..., None]
        return from_linear(acc)
    return from_linear(_multiband(warped, weights, bands))


def _wrap_pad(a: np.ndarray, pad: int) -> np.ndarray:
    """Equirect wraps in longitude; pyramid ops do not. Pad in x by wrapping so
    the lon=+/-180 meridian is not treated as an image border."""
    return np.concatenate([a[:, -pad:], a, a[:, :pad]], axis=1)


def _multiband(warped: dict, weights: dict, bands: int) -> np.ndarray:
    pad = 64
    imgs = {l: _wrap_pad(warped[l], pad) for l in SKY}
    wts = {l: _wrap_pad(weights[l], pad) for l in SKY}

    # Normalized convolution. A plain pyramid of the warped image would pyrDown
    # the BLACK outside each camera's coverage into its valid pixels, and the
    # low-frequency levels would then carry that darkening straight into the
    # blend -- which measurably amplified the very zenith pinwheel this is meant
    # to remove. Carrying (image * weight) and (weight) down separately and
    # dividing means zero-coverage pixels contribute exactly nothing.
    eps = 1e-4
    gp_w = {l: [wts[l].astype(np.float32)] for l in SKY}
    gp_iw = {l: [imgs[l].astype(np.float32) * wts[l][..., None]] for l in SKY}
    for _ in range(bands):
        for l in SKY:
            gp_w[l].append(cv2.pyrDown(gp_w[l][-1]))
            gp_iw[l].append(cv2.pyrDown(gp_iw[l][-1]))
    # per-level, per-camera image with the coverage bias divided back out
    gi = {l: [gp_iw[l][k] / (gp_w[l][k] + eps)[..., None] for k in range(bands + 1)] for l in SKY}

    blended = []
    for lvl in range(bands + 1):
        if lvl == bands:
            lap = {l: gi[l][lvl] for l in SKY}  # residual low-pass
        else:
            lap = {}
            for l in SKY:
                up = cv2.pyrUp(gi[l][lvl + 1], dstsize=(gi[l][lvl].shape[1], gi[l][lvl].shape[0]))
                lap[l] = gi[l][lvl] - up
        wsum = sum(gp_w[l][lvl] for l in SKY) + eps
        acc = sum(lap[l] * (gp_w[l][lvl] / wsum)[..., None] for l in SKY)
        blended.append(acc)

    out = blended[-1]
    for lvl in range(bands - 1, -1, -1):
        out = cv2.pyrUp(out, dstsize=(blended[lvl].shape[1], blended[lvl].shape[0])) + blended[lvl]
    return np.clip(out[:, pad:-pad], 0.0, 1.0)


def zenith_hole_mask(coverage: np.ndarray, eq_h: int, min_elev_deg: float = 80.0) -> np.ndarray:
    """Uncovered pixels ABOVE `min_elev_deg` — the sub-zenith wedge the three
    9mm lenses leave short of the pole.

    Deliberately scoped to the top of the dome. The large uncovered band at the
    bottom is NOT a hole — that is the ring's territory, and filling it would be
    inventing footage we actually have from the ring tier.
    """
    lat = 90.0 - (np.arange(eq_h) + 0.5) / eq_h * 180.0
    above = (lat >= min_elev_deg)[:, None]
    return (~coverage) & above


def fill_zenith(eq: np.ndarray, hole: np.ndarray, radius: int = 6) -> np.ndarray:
    """Inpaint the sub-zenith wedge from the sky surrounding it.

    HONESTY NOTE: this is invention, not measurement — no camera saw these
    pixels. It is defensible here only because the wedge is small, fully
    enclosed by real sky, and sits at the zenith where content is smooth. If a
    clip has the sun, a hard cloud edge, or structure passing through the
    wedge, this will fabricate it plausibly and wrongly. `metrics.json` reports
    the patched area so the QC pass can catch that case.
    """
    if not hole.any():
        return eq
    return cv2.inpaint(eq, hole.astype(np.uint8) * 255, radius, cv2.INPAINT_TELEA)


def crop_to_rim(eq: np.ndarray, rim_deg: float) -> np.ndarray:
    """Cut the equirect master down to rim..90 — the band the element actually is.

    The uncropped dome reaches to ~10 deg elevation, but below the rim it carries
    known-broken geometry (see RIM below), so shipping it would be shipping a
    defect. The master is the band, exactly like the ring band.
    """
    eq_h = eq.shape[0]
    row = int(np.ceil((90.0 - rim_deg) / 180.0 * eq_h))
    return eq[:max(row, 1)]


def to_fisheye(equirect: np.ndarray, size: int, max_elev_deg: float) -> np.ndarray:
    """Angular fisheye looking straight up — the overhead-LED deliverable.

    Zenith at centre; the rim is `max_elev_deg` above the horizon.

    RIM (why there is no default): the rim is a per-clip decision and a wrong one
    ships a visibly broken plate, so it must be stated explicitly.

    Two independent things force it upward, and only the second is about quality:

    1. SEAM BREAKS. Sky-sky overlap collapses at low elevation. On the viaduct
       clip, G and J overlap by only ~28% of the window at elev ~23, with pixels
       seen by NEITHER camera, so the feather has nothing to blend across and
       ownership hands off abruptly — the arch is guillotined at the J-G seam.
       Measured on Roll01_Clip04: every seam crossing at <=23 deg breaks, every
       crossing at >=24.9 deg is clean. Single-camera renders prove the source is
       undamaged; the seam is the defect.
    2. TIER OWNERSHIP. Structure that the RING element already carries should not
       also appear here. Two elements light a volumetric stage — a 360 cylinder
       and a flat overhead panel — so the same concrete arriving on both surfaces
       at slightly different geometry is worse on stage than any stitch artifact.
       This is what actually sets the viaduct clip's rim: the arch crowns at 54.3
       deg, so the rim is 59 (Andy, 2026-07-15), well above it.

    Take the rim from whichever of the two is higher for the clip.
    """
    eq_h, eq_w = equirect.shape[:2]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = (size - 1) / 2.0
    dx = (xx - cx) / cx
    dy = (yy - cy) / cy
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.arctan2(dy, dx)  # azimuth on the panel
    # r=0 -> zenith (90 deg elev); r=1 -> max_elev_deg
    elev = np.radians(90.0 - r * (90.0 - max_elev_deg))
    lon = theta
    lat = elev
    map_x = ((lon / (2 * np.pi) + 0.5) * eq_w).astype(np.float32)
    map_y = ((0.5 - lat / np.pi) * eq_h).astype(np.float32)
    out = cv2.remap(equirect, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
    out[r > 1.0] = 0
    return out


def _encoder_argv(w: int, h: int, fps: float, out_mov: Path) -> list[str]:
    # Mirrors render._encoder_argv. The -color_* codec flags are silently ignored
    # by ffmpeg 8 on this path, so colorimetry is tagged via setparams in the
    # filter chain and asserted after the encode.
    return [
        "ffmpeg", "-hide_banner", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}", "-r", f"{fps}",
        "-i", "-",
        "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
        "-c:v", "prores_ks", "-profile:v", "3",
        str(out_mov),
    ]


def _preview_argv(in_mov: Path, out_mp4: Path) -> list[str]:
    return [
        "ffmpeg", "-hide_banner", "-y", "-i", str(in_mov),
        "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
        "-c:v", "libx264", "-crf", "20", "-preset", "medium",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(out_mp4),
    ]


def render_full(args, clip, maps, weights, hole, rim, report) -> dict:
    """Render every frame to a ProRes master + an mp4 preview.

    The FISHEYE is the master here, not the equirect band: the deliverable is a
    flat overhead LED panel, and the fisheye is the form that maps onto it. The
    equirect band is kept as the archival/interchange form via the samples.
    """
    import subprocess
    import time

    out_dir = Path(args.out)
    size = args.fisheye
    mov = out_dir / f"{Path(args.drop).resolve().name}_skydome_prores.mov"
    argv = _encoder_argv(size, size, clip.fps, mov)
    report["ffmpeg_subprocess_argv"] = argv

    t0 = time.perf_counter()
    errf = open(out_dir / "encode.log", "wb")
    enc = subprocess.Popen(argv, stdin=subprocess.PIPE, stderr=errf)
    n = 0
    try:
        for i, frames in clip.read_frames(range(clip.usable_frames)):
            eq = compose(frames, maps, weights, args.eq[0], args.eq[1], bands=args.bands)
            if not args.no_patch:
                eq = fill_zenith(eq, hole)
            enc.stdin.write(to_fisheye(eq, size, rim).tobytes())
            n += 1
            if n % 200 == 0:
                print(f"  {n}/{clip.usable_frames} frames", flush=True)
    finally:
        enc.stdin.close()
        rc = enc.wait()
        errf.close()
    if rc != 0:
        raise RuntimeError(f"prores encode failed (rc={rc}) — see {out_dir}/encode.log")
    dt = time.perf_counter() - t0

    # F1 assertion, same as the ring: the master must carry explicit colr tags.
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=color_space,color_primaries,color_transfer,color_range",
         "-of", "json", str(mov)],
        capture_output=True, text=True,
    )
    tags = json.loads(probe.stdout)["streams"][0] if probe.returncode == 0 else {}
    report["master_color_tags"] = tags
    if tags.get("color_space") != "bt709" or tags.get("color_primaries") != "bt709":
        raise RuntimeError(f"master colorimetry tags wrong/missing: {tags}")

    prev = out_dir / "preview_2880.mp4"
    subprocess.run(_preview_argv(mov, prev), check=True, capture_output=True)

    report["full_frames_rendered"] = n
    report["achieved_fps_full"] = round(n / dt, 3) if dt else None
    report["outputs"] = {"master": str(mov), "preview": str(prev)}
    print(f"rendered {n} frames -> {mov.name} ({report['achieved_fps_full']} fps) + {prev.name}")
    return report


def cmd_sky(args) -> int:
    out_dir = Path(args.out)
    (out_dir / "samples").mkdir(parents=True, exist_ok=True)

    cams = sky_cameras(args.pts, args.offsets)
    clip = RingClip(Path(args.drop), letters=SKY)
    eq_w, eq_h = args.eq
    maps = bake_maps(cams, eq_w, eq_h, clip.width, clip.height)

    cal_idx = sorted(set(np.linspace(0, clip.usable_frames - 1, 6).round().astype(int).tolist()))
    cal_frames = [f for _, f in clip.read_frames(cal_idx)]
    gains = solve_gains(cal_frames, maps)
    weights, coverage = build_weights(cams, maps, eq_w, eq_h, gains, args.feather)

    rows = np.where(coverage.any(axis=1))[0]
    full_rows = np.where(coverage.all(axis=1))[0]
    lat_of = lambda row: 90.0 - (row + 0.5) / eq_h * 180.0
    report = {
        "drop": str(Path(args.drop).resolve()),
        "pts": str(Path(args.pts).resolve()),
        "offsets": args.offsets,
        "eq": {"width": eq_w, "height": eq_h},
        "gains": {k: round(v, 4) for k, v in gains.items()},
        "feather_deg": args.feather,
        "coverage": {
            "rows_any": [int(rows.min()), int(rows.max())],
            "elev_any_deg": [round(lat_of(rows.max()), 1), round(lat_of(rows.min()), 1)],
            "rows_full360": [int(full_rows.min()), int(full_rows.max())] if full_rows.size else None,
            "elev_full360_deg": (
                [round(lat_of(full_rows.max()), 1), round(lat_of(full_rows.min()), 1)]
                if full_rows.size else None
            ),
        },
        "usable_frames": clip.usable_frames,
        "tc_offsets": clip.offsets,
    }

    hole = zenith_hole_mask(coverage, eq_h, args.patch_above)
    rim = float(args.rim)
    report["rim"] = {
        "elev_deg": rim,
        "master_is": f"equirect band {rim}..90 deg",
        "why": "per-clip; must clear (a) the sky-sky seam-break zone and "
               "(b) any structure the RING element already owns",
    }
    report["blend"] = {"bands": args.bands, "mode": "multiband" if args.bands > 0 else "flat-alpha"}
    report["zenith_patch"] = {
        "enabled": not args.no_patch,
        "above_elev_deg": args.patch_above,
        "hole_px": int(hole.sum()),
        "hole_frac_of_dome": round(float(hole.sum()) / max(int(coverage.sum()), 1), 5),
        "note": "inpainted, not measured — no camera saw these pixels",
    }

    idx = sorted(set(np.linspace(0, clip.usable_frames - 1, args.sample).round().astype(int).tolist()))
    paths = []
    for i, frames in clip.read_frames(idx):
        eq = compose(frames, maps, weights, eq_w, eq_h, bands=args.bands)
        if not args.no_patch:
            eq = fill_zenith(eq, hole)
        # fisheye maps from the FULL-height equirect (its lat mapping assumes 180 deg);
        # the master is cropped after.
        fe = to_fisheye(eq, args.fisheye, rim)
        eq = crop_to_rim(eq, rim)
        p = out_dir / "samples" / f"sky_eq_{i:06d}.png"
        cv2.imwrite(str(p), eq)
        paths.append(str(p))
        pf = out_dir / "samples" / f"sky_fisheye_{i:06d}.png"
        cv2.imwrite(str(pf), fe)
        paths.append(str(pf))
    report["samples"] = paths
    # the gallery counts metrics["cams"] to label the run
    report["cams"] = {L: {"yaw": round(c.yaw, 4), "pitch": round(c.pitch, 4),
                          "roll": round(c.roll, 4)} for L, c in cams.items()}
    report["fps"] = clip.fps

    if getattr(args, "full", False):
        render_full(args, clip, maps, weights, hole, rim, report)

    (out_dir / "metrics.json").write_text(json.dumps(report, indent=2))
    if getattr(args, "full", False):
        write_sky_report(out_dir, report)
    print(json.dumps(report["coverage"], indent=1))
    print(f"gains: {report['gains']}")
    print(f"wrote {len(paths)} samples -> {out_dir}/samples")
    return 0


def write_sky_report(out_dir: Path, m: dict) -> None:
    """The human sign-off page for a sky run — the overhead element on its own."""
    rim = m["rim"]["elev_deg"]
    zp = m["zenith_patch"]
    cov = m["coverage"]
    gains = " / ".join(f"{k} {v}" for k, v in m["gains"].items())
    rows = "".join(
        f"<tr><td class=mono>{k}</td><td class=mono>{v}</td></tr>" for k, v in [
            ("rim (lower bound)", f"{rim}&deg; elevation"),
            ("master", "fisheye — zenith at centre, rim at the edge (the overhead-LED form)"),
            ("cameras", f"{len(m['cams'])} — sky tier only (G/H/J). The ring is a SEPARATE element."),
            ("frames", m.get("full_frames_rendered")),
            ("render fps", m.get("achieved_fps_full")),
            ("gains (linear)", gains),
            ("blend", f"{m['blend']['mode']} ({m['blend']['bands']} bands)"),
            ("sky-tier coverage", f"full 360 from {cov['elev_full360_deg'][0]}&deg; to "
                                  f"{cov['elev_full360_deg'][1]}&deg;"),
            ("zenith patch", f"{zp['hole_px']} px ({zp['hole_frac_of_dome']*100:.2f}% of dome) — "
                             f"<b>inpainted, not measured</b>"),
            ("colour", m.get("master_color_tags", {})),
        ])
    page = f"""<!doctype html><html><head><meta charset="utf-8">
<title>SKY DOME 1.0 — rim {rim}&deg;</title>
<style>
 body{{background:#111;color:#eee;font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:28px}}
 h1{{font-size:19px;margin:0 0 4px}} h2{{font-size:14px;color:#9ab;margin:26px 0 8px;font-weight:600}}
 .mono{{font-family:ui-monospace,Menlo,monospace;font-size:12px}}
 video{{width:100%;max-width:760px;background:#000;border:1px solid #333;border-radius:6px}}
 table{{border-collapse:collapse;margin-top:6px}} td{{padding:3px 14px 3px 0;vertical-align:top}}
 tr:nth-child(odd){{background:#181818}}
 .warn{{background:#2a1f0e;border-left:3px solid #b8860b;padding:10px 14px;margin:16px 0;max-width:760px}}
 .note{{color:#89a;max-width:760px}}
</style></head><body>
<h1>SKY DOME 1.0 &mdash; rim {rim}&deg;</h1>
<p class=mono>{Path(m['drop']).name}</p>

<div class=warn><b>This is the OVERHEAD element only.</b> It is stitched from the three sky
cameras (G/H/J) alone and is never composited with the ring. A volumetric stage is two surfaces
&mdash; a 360 LED cylinder for the horizontal band, and a separate overhead LED for the sky.
Judge this as the ceiling, not as a whole sphere.</div>

<h2>Master &mdash; fisheye, looking straight up</h2>
<video src="preview_2880.mp4" controls muted loop></video>
<p class=note>Zenith is at the centre; the rim is {rim}&deg; above the horizon. Everything below
the rim belongs to the RING element.</p>

<h2>Run</h2>
<table>{rows}</table>

<h2>Read this before approving</h2>
<ul class=note>
<li><b>The rim is the decision.</b> Below ~25&deg; the sky cameras stop overlapping (0% at 20&deg;),
so a seam there is a butt-joint and guillotines anything crossing it. This rim is {rim}&deg;.</li>
<li><b>The zenith wedge is invented.</b> {zp['hole_px']} px
({zp['hole_frac_of_dome']*100:.2f}% of the dome) were seen by no camera and are inpainted from the
surrounding sky. Honest on flat overcast; wrong if a clip has sun or a hard cloud edge there.</li>
<li><b>Look at full size before judging.</b> Metrics on this pipeline have repeatedly said "close"
about footage that was rejected on sight.</li>
</ul>
</body></html>"""
    (out_dir / "index.html").write_text(page)
    print(f"wrote {out_dir}/index.html")
