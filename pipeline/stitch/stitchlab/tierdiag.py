"""RING-vs-SKY tier registration diagnostic — is the 9-camera sphere reachable?

THE QUESTION. Every ALL-9 candidate was rejected for defects at the sky-ring
boundary. Blend tuning never fixed them, because the real question was never
asked: are the two tiers REGISTERED TO EACH OTHER at all?

There are only two ways they can disagree, and they have opposite prognoses:

  ROTATION ERROR  — a fixed angular offset between the tiers' calibration.
                    Disparity is CONSTANT regardless of how far away the
                    subject is. Fixable by solving one offset. Sphere is days.

  PARALLAX        — the tiers sit at different physical points on the rig
                    (10-15 cm baselines), so near things shift more than far
                    things. Disparity scales as 1/depth. No calibration touches
                    it; needs depth-based view synthesis. Weeks-to-months.

THE DISCRIMINATOR is therefore disparity-vs-depth, not disparity magnitude.
This is exactly the test that cracked the tunnel: four agents called the
doubled lights "parallax" from their size; the disparity turned out FLAT with
elevation where parallax demanded a 2.5x growth, and it was a 1.9 deg yaw error.

WHERE WE MEASURE. The tiers overlap between elev 24.5 (sky's full-360 floor)
and 40.7 (ring's raw top) — rows 699..525 of a 3840x1920 equirect. Honest
caveat: that is the ring's top EDGE and the sky's bottom EDGE, i.e. the weakest
part of both. A noisy result is a real possible outcome.

DIRECTION. We refine SKY -> RING, never sky-to-sky. The ring is the anchor: it
is built on the .pts calibration that passed the M0 gate against PTGui's own
ground-truth render, and it is the approved 1.0. Aligning the tiers to each
other would make the seam look perfect while rotating the whole dome relative
to the world -- a render that looks right and is wrong on the volume.

NO NUMBER WITHOUT A CONTROL. Two detectors this week passed their own sanity
checks and failed a known-broken positive control. `control()` injects a known
rotation and asserts the measurement recovers it before any real result is
trusted.
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
from .ringstitch import RingStitcher
from .skystitch import bake_maps, build_weights, compose, solve_gains, SKY

EQ_W, EQ_H = 3840, 1920


def elev_to_row(e: float) -> int:
    return int(round((90.0 - e) / 180.0 * EQ_H))


def row_to_elev(r: float) -> float:
    return 90.0 - (r + 0.5) / EQ_H * 180.0


def sky_cams_with(pts_path: str, offsets: dict | None):
    proj = load_pts(pts_path)
    out = {}
    for letter in SKY:
        cam = copy.deepcopy(proj.by_letter[letter])
        d = (offsets or {}).get(letter, {})
        cam.yaw += float(d.get("yaw", 0.0))
        cam.pitch += float(d.get("pitch", 0.0))
        cam.roll += float(d.get("roll", 0.0))
        out[letter] = cam
    return out


# --------------------------------------------------------------- detector

def patch_disparity(a: np.ndarray, b: np.ndarray, min_tex: float = 0.0012):
    """Sub-pixel shift that maps b onto a, or None if the patch is featureless.

    TEXTURE GATE, NOT RESPONSE GATE. A flat patch phase-correlates to exactly
    (0,0) with a HIGH response — response is anti-correlated with signal here,
    so gating on it selects precisely the useless patches. This was measured on
    the tunnel footage: 33% of raw patches were such fake zeros. Gate on
    variance instead.
    """
    if a.shape != b.shape:
        return None
    af = a.astype(np.float32) / 255.0
    bf = b.astype(np.float32) / 255.0
    if af.std() < math.sqrt(min_tex) or bf.std() < math.sqrt(min_tex):
        return None
    win = cv2.createHanningWindow((af.shape[1], af.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(af * win, bf * win)
    return float(dx), float(dy), float(resp)


def control(verbose: bool = True) -> dict:
    """POSITIVE CONTROL. Inject known shifts into a real textured patch and
    confirm recovery. Resamples the real image at offset coordinates -- warpAffine
    would invent border content and corrupt the correlation (that harness bug
    produced a bogus verdict on the tunnel run).
    """
    rng = np.random.default_rng(7)
    base = rng.normal(0.5, 0.16, (256, 256)).astype(np.float32)
    base = cv2.GaussianBlur(base, (0, 0), 2.0)
    base = np.clip(base * 255, 0, 255).astype(np.uint8)
    out = []
    for truth in (0.5, 1.0, 2.0, 4.0, 8.0, 13.0):
        yy, xx = np.mgrid[0:256, 0:256].astype(np.float32)
        shifted = cv2.remap(base, xx + truth, yy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        r = patch_disparity(base, shifted)
        got = abs(r[0]) if r else float("nan")
        out.append({"truth_px": truth, "measured_px": round(got, 3),
                    "err_px": round(abs(got - truth), 3)})
        if verbose:
            print(f"   inject {truth:5.1f} px -> measured {got:6.3f} px  (err {abs(got-truth):.3f})")
    worst = max(o["err_px"] for o in out)
    ok = worst < 0.5
    # negative control: a patch against itself must read exactly zero
    z = patch_disparity(base, base.copy())
    zero_ok = z is not None and abs(z[0]) < 0.02 and abs(z[1]) < 0.02
    # flat patch must be REJECTED, not silently returned as (0,0)
    flat = np.full((256, 256), 128, np.uint8)
    flat_rejected = patch_disparity(flat, flat) is None
    if verbose:
        print(f"   negative control (self vs self): {'PASS' if zero_ok else 'FAIL'}")
        print(f"   flat patch rejected by texture gate: {'PASS' if flat_rejected else 'FAIL'}")
        print(f"   worst error {worst:.3f} px -> detector {'USABLE' if ok else 'NOT USABLE'}")
    return {"injections": out, "worst_err_px": worst, "usable": bool(ok and zero_ok and flat_rejected),
            "negative_control_ok": bool(zero_ok), "flat_rejected": bool(flat_rejected)}


# --------------------------------------------------------------- measurement

def measure_frame(ring_ov: np.ndarray, sky_ov: np.ndarray, cov_ov: np.ndarray,
                  row0: int, patch: int = 96, step: int = 64) -> list[dict]:
    """Disparity between the two tiers over the overlap band, per patch."""
    rg = cv2.cvtColor(ring_ov, cv2.COLOR_BGR2GRAY)
    sk = cv2.cvtColor(sky_ov, cv2.COLOR_BGR2GRAY)
    h, w = rg.shape
    out = []
    for y in range(0, h - patch + 1, step):
        for x in range(0, w - patch + 1, step):
            cov = cov_ov[y:y + patch, x:x + patch]
            if cov.mean() < 0.995:
                continue
            a = rg[y:y + patch, x:x + patch]
            b = sk[y:y + patch, x:x + patch]
            if a.min() < 3 or b.min() < 3:      # touches an unrendered region
                continue
            r = patch_disparity(a, b)
            if r is None:
                continue
            dx, dy, resp = r
            # DEPTH PROXY: the arch/near structure is markedly darker than sky.
            # Not a metric depth, just a near/far separator, and it is checked
            # visually before use.
            dark = float(np.median(a))
            out.append({"row": row0 + y + patch // 2, "col": x + patch // 2,
                        "dx": dx, "dy": dy, "resp": resp,
                        "elev": round(row_to_elev(row0 + y + patch // 2), 2),
                        "luma": round(dark, 1),
                        "tex": round(float(a.astype(np.float32).std() / 255.0), 4)})
    return out
