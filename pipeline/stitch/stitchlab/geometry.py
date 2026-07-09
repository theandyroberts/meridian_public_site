"""Equirect <-> camera geometry, verified against PTGui's own solution.

Conventions (empirically pinned by the 2026-07-09 forensic audit — see
docs/research/2026-07-09-stitch-autopsy-verdict.md):
  - world: +z forward (yaw 0), +x right (yaw +90 in equirect), +y DOWN (nadir);
    equirect row 0 = zenith.
  - camera-to-world R = Ry(yaw) @ Rx(pitch) @ Rz(roll); world-to-camera = R.T
  - PTGui distortion (PanoTools polynomial): r_src = r_ideal*(a r^3 + b r^2 + c r + d),
    d = 1-a-b-c, radius normalized to min(w,h)/2. Forward direction (ideal->source)
    is closed-form; source->ideal needs Newton (used only for control-point checks).
  - PTGui shift is added to the centered principal point.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from .pts import Camera


def rotation(yaw_deg: float, pitch_deg: float, roll_deg: float) -> np.ndarray:
    y, p, r = (math.radians(v) for v in (yaw_deg, pitch_deg, roll_deg))
    ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    return ry @ rx @ rz


def equirect_rays(eq_w: int, eq_h: int) -> np.ndarray:
    """(3, eq_h, eq_w) unit rays for every output pixel."""
    u = (np.arange(eq_w, dtype=np.float64) + 0.5) / eq_w
    v = (np.arange(eq_h, dtype=np.float64) + 0.5) / eq_h
    lon = (u - 0.5) * 2 * np.pi
    lat = (0.5 - v) * np.pi  # +lat = up (row 0 = zenith)
    lon_g, lat_g = np.meshgrid(lon, lat)
    cos_lat = np.cos(lat_g)
    return np.stack([cos_lat * np.sin(lon_g), -np.sin(lat_g), cos_lat * np.cos(lon_g)])


def distort_forward(xn: np.ndarray, yn: np.ndarray, cam: Camera, at_width: int, at_height: int):
    """Ideal pixel offsets from principal (px) -> distorted offsets (px).

    Operates in pixel space at the working resolution; radius normalized to
    min(w,h)/2 per the pinned PanoTools convention.
    """
    a, b, c = cam.lens.a, cam.lens.b, cam.lens.c
    d = 1.0 - a - b - c
    rn = min(at_width, at_height) / 2.0
    r = np.sqrt(xn * xn + yn * yn) / rn
    scale = a * r**3 + b * r**2 + c * r + d
    return xn * scale, yn * scale


def undistort_point(x: float, y: float, cam: Camera, at_width: int, at_height: int, iters: int = 30):
    """Distorted (measured) pixel -> ideal pixel, Newton inversion. Point-wise."""
    a, b, c = cam.lens.a, cam.lens.b, cam.lens.c
    d = 1.0 - a - b - c
    cx, cy = cam.principal(at_width, at_height)
    rn = min(at_width, at_height) / 2.0
    dx, dy = x - cx, y - cy
    rs = math.hypot(dx, dy) / rn
    if rs < 1e-9:
        return x, y
    r = rs
    for _ in range(iters):
        f = r * (a * r**3 + b * r**2 + c * r + d) - rs
        fp = 4 * a * r**3 + 3 * b * r**2 + 2 * c * r + d
        r -= f / fp
    s = r / rs
    return cx + dx * s, cy + dy * s


def camera_maps(
    cam: Camera,
    eq_w: int,
    eq_h: int,
    src_w: int,
    src_h: int,
    rays: np.ndarray | None = None,
    margin: float = 1.0,
):
    """float32 cv2.remap maps + validity mask for one camera.

    Full model: rotation, PTGui focal, shift-offset principal point, forward
    distortion. `src_w/src_h` is the working footage resolution (e.g. 2048x1080
    proxies, or 6144x3240 calibration stills).
    """
    if rays is None:
        rays = equirect_rays(eq_w, eq_h)
    r_wc = rotation(cam.yaw, cam.pitch, cam.roll).T  # world -> camera
    cam_rays = np.tensordot(r_wc, rays, axes=1)
    z = cam_rays[2]
    valid = z > 1e-4

    f = cam.f_px(at_width=src_w)
    cx, cy = cam.principal(src_w, src_h)
    with np.errstate(divide="ignore", invalid="ignore"):
        xn = np.where(valid, cam_rays[0] / z, 0.0) * f
        yn = np.where(valid, cam_rays[1] / z, 0.0) * f
    # The quartic r_src(r) folds back at large ideal radii, mapping directions far
    # outside the lens frame into apparently-valid source pixels (phantom halo).
    # Anything beyond the source corner radius cannot be a real image point.
    rn = min(src_w, src_h) / 2.0
    r_ideal = np.sqrt(xn * xn + yn * yn) / rn
    r_corner = math.hypot(src_w, src_h) / min(src_w, src_h)
    valid &= r_ideal <= r_corner * 1.02
    xd, yd = distort_forward(xn, yn, cam, src_w, src_h)
    px = cx + xd
    py = cy + yd

    in_bounds = valid & (px >= margin) & (px < src_w - margin) & (py >= margin) & (py < src_h - margin)
    map_x = np.where(in_bounds, px, -1).astype(np.float32)
    map_y = np.where(in_bounds, py, -1).astype(np.float32)
    return map_x, map_y, in_bounds


def warp(image: np.ndarray, map_x: np.ndarray, map_y: np.ndarray) -> np.ndarray:
    return cv2.remap(image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)


def pixel_to_lonlat(x: float, y: float, cam: Camera, src_w: int, src_h: int):
    """Measured source pixel -> pano lon/lat (radians), full model."""
    xi, yi = undistort_point(x, y, cam, src_w, src_h)
    cx, cy = cam.principal(src_w, src_h)
    f = cam.f_px(at_width=src_w)
    v = np.array([(xi - cx) / f, (yi - cy) / f, 1.0])
    v = rotation(cam.yaw, cam.pitch, cam.roll) @ v  # camera -> world
    v /= np.linalg.norm(v)
    lon = math.atan2(v[0], v[2])
    lat = math.asin(float(np.clip(-v[1], -1, 1)))
    return lon, lat


def lonlat_to_eq(lon: float, lat: float, eq_w: int, eq_h: int):
    return (lon / (2 * math.pi) + 0.5) * eq_w, (0.5 - lat / math.pi) * eq_h


def rotate_equirect(img: np.ndarray, yaw_deg: float, pitch_deg: float, roll_deg: float = 0.0) -> np.ndarray:
    """Re-render an equirect image under a global rotation (for aligning two
    panos that differ only in pano orientation)."""
    h, w = img.shape[:2]
    rays = equirect_rays(w, h)
    r = rotation(yaw_deg, pitch_deg, roll_deg)
    src = np.tensordot(r, rays, axes=1)
    lon = np.arctan2(src[0], src[2])
    lat = np.arcsin(np.clip(-src[1], -1, 1))
    map_x = ((lon / (2 * np.pi) + 0.5) * w).astype(np.float32)
    map_y = ((0.5 - lat / np.pi) * h).astype(np.float32)
    return cv2.remap(img, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)
