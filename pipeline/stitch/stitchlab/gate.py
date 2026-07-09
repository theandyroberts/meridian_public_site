"""M0 validation gate — prove the warp implementation against PTGui ground truth.

Eight checks, all must pass before any blending/stitching code is trusted.
Each check exists because a specific historical failure mode would have been
caught by it (see docs/research/2026-07-09-stitch-autopsy-verdict.md).

Thresholds marked [analytic] are derived from geometry rather than copied
from the audit notes, so the gate cannot inherit a transcription error.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import geometry as G
from .pts import PtsProject, load_pts

EQ_W, EQ_H = 3840, 1920
PX_PER_DEG = EQ_W / 360.0


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: dict = field(default_factory=dict)


class Gate:
    def __init__(self, pts_path: str, stills_dir: str, gold_jpg: str, out_dir: str):
        self.proj: PtsProject = load_pts(pts_path)
        self.stills_dir = Path(stills_dir)
        self.gold_jpg = Path(gold_jpg)
        self.out = Path(out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.results: list[CheckResult] = []
        self._rays = None
        self._still_cache: dict[str, np.ndarray] = {}
        self._map_cache: dict[str, tuple] = {}

    # ---------- helpers ----------

    def rays(self):
        if self._rays is None:
            self._rays = G.equirect_rays(EQ_W, EQ_H)
        return self._rays

    def still(self, letter: str) -> np.ndarray:
        if letter not in self._still_cache:
            cam = self.proj.by_letter[letter]
            path = self.stills_dir / cam.filename
            img = cv2.imread(str(path))
            if img is None:
                raise FileNotFoundError(path)
            self._still_cache[letter] = img
        return self._still_cache[letter]

    def maps(self, letter: str):
        if letter not in self._map_cache:
            cam = self.proj.by_letter[letter]
            img = self.still(letter)
            h, w = img.shape[:2]
            self._map_cache[letter] = G.camera_maps(cam, EQ_W, EQ_H, w, h, rays=self.rays())
        return self._map_cache[letter]

    def add(self, name: str, passed: bool, **detail):
        self.results.append(CheckResult(name, bool(passed), detail))
        state = "PASS" if passed else "FAIL"
        print(f"[{state}] {name}")
        for k, v in detail.items():
            print(f"        {k}: {v}")

    # ---------- checks ----------

    def check1_parser(self):
        p = self.proj
        ok = (
            len(p.cameras) == 9
            and abs(p.lenses[0].focal_mm - 13.0222) < 0.05
            and abs(p.lenses[1].focal_mm - 9.885) < 0.05
            and all(abs(l.a) + abs(l.b) + abs(l.c) > 1e-6 for l in p.lenses)
            and abs(p.lenses[0].shift_long - 0.012146) < 5e-4
            and len(p.control_points) >= 100
        )
        self.add(
            "1 parser-proof",
            ok,
            cameras=len(p.cameras),
            lens_focals_mm=[round(l.focal_mm, 4) for l in p.lenses],
            distortion_nonzero=[bool(abs(l.a) + abs(l.b) + abs(l.c) > 1e-6) for l in p.lenses],
            shift_long=p.lenses[0].shift_long,
            control_points=len(p.control_points),
        )

    def check2_intrinsics_provenance(self):
        cam_a = self.proj.by_letter["A"]
        f6144 = cam_a.f_px()
        hfov = cam_a.hfov_deg
        f_ok = abs(f6144 - 2959.8) / 2959.8 < 0.01 and abs(hfov - 92.13) < 0.25
        banned = re.compile(r"22\.56|SENSOR_WIDTH_MM|lens_library")
        offenders = []
        for f in Path(__file__).parent.glob("*.py"):
            if banned.search(f.read_text()) and f.name != "gate.py":
                offenders.append(f.name)
        self.add(
            "2 intrinsics-provenance",
            f_ok and not offenders,
            f_px_at_6144=round(f6144, 1),
            hfov_deg=round(hfov, 2),
            banned_constant_offenders=offenders or "none",
        )

    def check3_rig_geometry(self):
        ring = self.proj.ring
        yaws = sorted(c.yaw for c in ring)
        gaps = [(yaws[(i + 1) % 6] - yaws[i]) % 360 for i in range(6)]
        hfov = ring[0].hfov_deg
        ok = (
            abs(sum(gaps) - 360.0) < 0.1
            and all(55.0 <= g <= 65.0 for g in gaps)
            and all(g <= hfov - 5.0 for g in gaps)
        )
        self.add(
            "3 rig-geometry",
            ok,
            ring_yaw_gaps=[round(g, 2) for g in gaps],
            gaps_sum=round(sum(gaps), 3),
            hfov=round(hfov, 2),
        )

    def check4_warp_non_identity(self):
        cam = self.proj.by_letter["A"]
        img = self.still("A")
        h, w = img.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        cell = max(50, w // 20)
        checker = (((xx // cell) + (yy // cell)) % 2).astype(np.float32)
        src = (img.astype(np.float32) * 0.55 + checker[..., None] * 115).clip(0, 255).astype(np.uint8)
        src[(yy % cell < 3) | (xx % cell < 3)] = (0, 255, 0)

        map_x, map_y, mask = self.maps("A")
        warped = G.warp(src, map_x, map_y)
        cv2.imwrite(str(self.out / "check4_checker_warped.png"), warped)

        m = mask.astype(np.uint8)
        # [analytic] width at the optical-axis row must match the full-model
        # angular span between the left/right frame edges at the principal row
        # (point math through undistort — independent of the map code under test)
        cx, cy = cam.principal(w, h)
        _, axis_eq_y = G.lonlat_to_eq(*G.pixel_to_lonlat(cx, cy, cam, w, h), EQ_W, EQ_H)
        axis_row = int(round(axis_eq_y))
        width_at_axis = int(m[axis_row].sum())
        lon_l, _ = G.pixel_to_lonlat(1.0, cy, cam, w, h)
        lon_r, _ = G.pixel_to_lonlat(w - 2.0, cy, cam, w, h)
        span = math.degrees((lon_r - lon_l) % (2 * math.pi))
        expected = span * PX_PER_DEG
        width_ok = abs(width_at_axis - expected) / expected < 0.02

        # bowtie: edge-column height well below center-column height
        cols = np.where(m.any(axis=0))[0]
        heights = m.sum(axis=0)
        center_h = float(heights[cols].max())
        edge_h = float(min(heights[cols[10]], heights[cols[-10]]))
        bowtie_ok = edge_h <= 0.70 * center_h

        # mask-edge bow (curvature of the top boundary)
        tops = np.array([np.argmax(m[:, c] > 0) for c in cols])
        bow = float(tops[len(tops) // 2] - min(tops[10], tops[-10]))
        bow_ok = abs(bow) >= 20

        # identity detector: 1.5x focal must shrink the tile by >15%
        import copy

        f_real = cam.f_px(at_width=w)
        fake = copy.deepcopy(cam)
        fake.lens = copy.deepcopy(cam.lens)
        fake.lens.focal_mm = cam.lens.focal_mm * 1.5
        fx_map, fy_map, fmask = G.camera_maps(fake, EQ_W, EQ_H, w, h, rays=self.rays())
        width_fake = int(fmask.astype(np.uint8)[axis_row].sum())
        distinct_ok = width_fake < 0.85 * width_at_axis

        self.add(
            "4 warp-non-identity",
            width_ok and bowtie_ok and bow_ok and distinct_ok,
            width_at_axis_px=width_at_axis,
            expected_px=round(expected, 1),
            f_px=round(f_real, 1),
            edge_vs_center_height=f"{edge_h:.0f}/{center_h:.0f}",
            top_edge_bow_px=bow,
            width_with_1p5x_focal=width_fake,
            evidence="check4_checker_warped.png",
        )

    def _cp_errors(self, flip_pitch=False, flip_shift=False) -> np.ndarray:
        p = self.proj
        errs = []
        pair_kinds = []
        for cp in p.control_points:
            if cp.kind != 0:
                continue
            cams = []
            pts = []
            for idx, x, y in ((cp.img0, cp.x0, cp.y0), (cp.img1, cp.x1, cp.y1)):
                cam = p.cameras[idx]
                if flip_pitch or flip_shift:
                    import copy

                    cam = copy.deepcopy(cam)
                    if flip_pitch:
                        cam.pitch = -cam.pitch
                    if flip_shift:
                        cam.lens = copy.deepcopy(cam.lens)
                        cam.lens.shift_long = -cam.lens.shift_long
                        cam.lens.shift_short = -cam.lens.shift_short
                cams.append(cam)
                pts.append((x, y))
            e0 = G.lonlat_to_eq(*G.pixel_to_lonlat(*pts[0], cams[0], cams[0].width, cams[0].height), EQ_W, EQ_H)
            e1 = G.lonlat_to_eq(*G.pixel_to_lonlat(*pts[1], cams[1], cams[1].width, cams[1].height), EQ_W, EQ_H)
            dx = e0[0] - e1[0]
            if dx > EQ_W / 2:
                dx -= EQ_W
            if dx < -EQ_W / 2:
                dx += EQ_W
            errs.append(math.hypot(dx, e0[1] - e1[1]))
            pair_kinds.append(
                "hh" if cams[0].letter in "ABCDEF" and cams[1].letter in "ABCDEF" else "sky"
            )
        return np.array(errs), pair_kinds

    def check5_control_points(self):
        errs, kinds = self._cp_errors()
        hh = np.array([e for e, k in zip(errs, kinds) if k == "hh"])
        sky = np.array([e for e, k in zip(errs, kinds) if k == "sky"])
        rms = float(np.sqrt((errs**2).mean()))
        hh_rms = float(np.sqrt((hh**2).mean())) if hh.size else 0.0
        hh_max = float(hh.max()) if hh.size else 0.0
        sky_rms = float(np.sqrt((sky**2).mean())) if sky.size else 0.0

        flip_p, _ = self._cp_errors(flip_pitch=True)
        flip_s, _ = self._cp_errors(flip_shift=True)
        rms_fp = float(np.sqrt((flip_p**2).mean()))
        rms_fs = float(np.sqrt((flip_s**2).mean()))
        # sentinels: flipping a convention must clearly degrade the model,
        # else that convention isn't actually being exercised
        sentinel_ok = rms_fp > 3 * rms and rms_fs > 1.5 * rms

        # Ring pairs gate the ring-stitch phase strictly. Sky-pair residual is
        # genuine physical parallax, not model error: sky-to-ring baseline
        # (~10-15cm) against ~4m calibration-room content predicts 15-23px of
        # unresolvable equirect displacement; measured 17.2px sits in-band, and
        # the alternative radius-normalization convention was tested and did
        # not improve it (17.18 vs 17.76). Bound 25px, revisit at 9-cam phase
        # where driving content (>=10m) shrinks it ~5x.
        ok = hh_rms <= 2.5 and hh_max <= 10.0 and sky_rms <= 25.0 and sentinel_ok
        self.add(
            "5 control-point-reprojection",
            ok,
            n=len(errs),
            all_rms_px=round(rms, 2),
            ring_ring_rms_px=round(hh_rms, 2),
            ring_ring_max_px=round(hh_max, 2),
            sky_pairs_rms_px=round(sky_rms, 2),
            sky_note="provisional bound; revisit at 9-cam phase",
            rms_pitch_flipped=round(rms_fp, 1),
            rms_shift_flipped=round(rms_fs, 1),
        )

    def check6_gold_image(self):
        """Compare our cam-A render against PTGui's own render of the project.

        mercy01.jpg was rendered with a different pano leveling than the ypr
        stored in the .pts (no global-orientation field exists in v33), so a
        global rotation is a legitimate free parameter: we search for it, then
        score structural agreement (high-passed NCC kills grade differences).
        """
        gold = cv2.imread(str(self.gold_jpg))
        if gold is None:
            self.add("6 gold-image-diff", False, error=f"cannot read {self.gold_jpg}")
            return
        gold_r = cv2.resize(gold, (EQ_W, EQ_H), interpolation=cv2.INTER_AREA)

        cam_a = self.proj.by_letter["A"]
        # anti-aliased render: warp from a pyramid level close to the output
        # minification, so fine-detail statistics match the area-resized gold
        still_a = self.still("A")
        small = cv2.pyrDown(still_a)
        sh, sw = small.shape[:2]
        map_x, map_y, mask = G.camera_maps(cam_a, EQ_W, EQ_H, sw, sh, rays=self.rays())
        ours = G.warp(small, map_x, map_y)
        m8 = cv2.erode(mask.astype(np.uint8) * 255, np.ones((25, 25), np.uint8))
        # restrict to A's EXCLUSIVE zone: beyond +-(gap - hfov/2) the gold pano
        # blends in neighbor cameras (with their parallax), so it is not pure A
        ring = self.proj.ring
        yaws = sorted(c.yaw for c in ring)
        a_yaw = cam_a.yaw
        gap = min((y - a_yaw) % 360 for y in yaws if abs((y - a_yaw) % 360) > 1)
        hfov = cam_a.hfov_deg
        exclusive_half = max(6.0, gap - hfov / 2.0 - 1.0)  # deg, with 1deg margin
        lon_axis = ((np.arange(EQ_W) + 0.5) / EQ_W - 0.5) * 360.0
        excl_cols = np.abs((lon_axis - a_yaw + 180) % 360 - 180) <= exclusive_half
        m8[:, ~excl_cols] = 0
        sel_full = m8 > 0

        def highpass_gray(img):
            g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
            g = cv2.GaussianBlur(g, (0, 0), 1.0)  # suppress resampling-kernel diffs
            return g - cv2.GaussianBlur(g, (0, 0), 16)

        a_full = highpass_gray(ours)

        def masked_ncc(b_img, sel):
            a_v = a_full[sel]
            b_v = highpass_gray(b_img)[sel]
            a_n = (a_v - a_v.mean()) / (a_v.std() + 1e-6)
            b_n = (b_v - b_v.mean()) / (b_v.std() + 1e-6)
            return float((a_n * b_n).mean())

        # coarse-to-fine search for the global orientation of the gold render
        small_gold = cv2.resize(gold_r, (960, 480), interpolation=cv2.INTER_AREA)
        sel_small = cv2.resize(m8, (960, 480), interpolation=cv2.INTER_NEAREST) > 0
        a_small = cv2.resize(ours, (960, 480), interpolation=cv2.INTER_AREA)
        a_small_hp = highpass_gray(a_small)

        def score_small(yaw, pitch, roll):
            rot = G.rotate_equirect(small_gold, yaw, pitch, roll)
            b_v = highpass_gray(rot)[sel_small]
            a_v = a_small_hp[sel_small]
            a_n = (a_v - a_v.mean()) / (a_v.std() + 1e-6)
            b_n = (b_v - b_v.mean()) / (b_v.std() + 1e-6)
            return float((a_n * b_n).mean())

        best = (0.0, 0.0, 0.0)
        best_s = score_small(*best)
        for yaw in range(-10, 11, 2):
            for pitch in range(-30, 31, 2):
                s = score_small(yaw, pitch, 0.0)
                if s > best_s:
                    best_s, best = s, (float(yaw), float(pitch), 0.0)
        y0, p0, _ = best
        for dy in np.arange(-1.5, 1.6, 0.5):
            for dp in np.arange(-1.5, 1.6, 0.5):
                for dr in np.arange(-1.0, 1.1, 0.5):
                    s = score_small(y0 + dy, p0 + dp, dr)
                    if s > best_s:
                        best_s, best = s, (y0 + dy, p0 + dp, dr)

        # refine with phase correlation: translation in equirect px == small
        # yaw/pitch rotation; iterate to sub-0.1deg
        win = np.zeros((EQ_H, EQ_W), np.float32)
        win[sel_full] = 1.0
        yaw_f, pitch_f, roll_f = best
        shift_mag = 99.0
        for _ in range(4):
            gold_aligned = G.rotate_equirect(gold_r, yaw_f, pitch_f, roll_f)
            shift, _ = cv2.phaseCorrelate(a_full * win, highpass_gray(gold_aligned) * win)
            shift_mag = float(math.hypot(*shift))
            if shift_mag < 0.3:
                break
            yaw_f += shift[0] / PX_PER_DEG
            pitch_f -= shift[1] / (EQ_H / 180.0)
        best = (yaw_f, pitch_f, roll_f)
        gold_aligned = G.rotate_equirect(gold_r, *best)
        ncc = masked_ncc(gold_aligned, sel_full)

        side = np.vstack([ours, gold_aligned])
        cv2.imwrite(str(self.out / "check6_ours_vs_gold_aligned.jpg"), side, [cv2.IMWRITE_JPEG_QUALITY, 85])
        blend = cv2.addWeighted(ours, 0.5, gold_aligned, 0.5, 0)
        blend[~sel_full] //= 3
        cv2.imwrite(str(self.out / "check6_50pct_blend.jpg"), blend, [cv2.IMWRITE_JPEG_QUALITY, 88])

        ok = ncc >= 0.85 and shift_mag < 3.0
        self.add(
            "6 gold-image-diff",
            ok,
            structural_ncc=round(ncc, 4),
            phase_shift_px=round(shift_mag, 2),
            gold_global_orientation=f"yaw={best[0]:.1f} pitch={best[1]:.1f} roll={best[2]:.1f}",
            evidence="check6_ours_vs_gold_aligned.jpg, check6_50pct_blend.jpg",
        )

    def check7_hard_mask_seams(self):
        """Composite the six ring cameras with binary nearest-yaw masks and
        measure geometric misregistration camera-vs-camera in each overlap."""
        ring = self.proj.ring
        letters = [c.letter for c in ring]
        warped = {}
        masks = {}
        for c in ring:
            mx, my, m = self.maps(c.letter)
            warped[c.letter] = G.warp(self.still(c.letter), mx, my)
            masks[c.letter] = m

        # binary composite by nearest yaw distance
        lon = ((np.arange(EQ_W) + 0.5) / EQ_W - 0.5) * 360.0
        owner = np.full(EQ_W, -1)
        for i, c in enumerate(ring):
            d = np.abs((lon - c.yaw + 180) % 360 - 180)
            if i == 0:
                best = d
                owner[:] = 0
            else:
                take = d < best
                owner[take] = i
                best = np.minimum(best, d)
        comp = np.zeros((EQ_H, EQ_W, 3), np.uint8)
        for i, c in enumerate(ring):
            colsel = owner == i
            comp[:, colsel] = warped[c.letter][:, colsel]
        cv2.imwrite(str(self.out / "check7_hardmask_composite.jpg"), comp, [cv2.IMWRITE_JPEG_QUALITY, 88])

        # misregistration per adjacent pair via phase correlation in shared overlap
        order = np.argsort([c.yaw for c in ring])
        pair_disp = {}
        worst = 0.0
        for k in range(6):
            c0, c1 = ring[order[k]], ring[order[(k + 1) % 6]]
            both = masks[c0.letter] & masks[c1.letter]
            im0, im1 = warped[c0.letter], warped[c1.letter]
            ys_all, xs_all = np.where(both)
            if xs_all.size and xs_all.max() - xs_all.min() > EQ_W / 2:
                # overlap wraps +-180: roll everything by half the canvas
                both = np.roll(both, EQ_W // 2, axis=1)
                im0 = np.roll(im0, EQ_W // 2, axis=1)
                im1 = np.roll(im1, EQ_W // 2, axis=1)
            # far-field band: horizon and above (rows where lat in [0, 25] deg)
            r0 = int((0.5 - 25 / 180) * EQ_H)
            r1 = int(0.5 * EQ_H)
            band = np.zeros_like(both)
            band[r0:r1] = both[r0:r1]
            if band.sum() < 4000:
                pair_disp[f"{c0.letter}-{c1.letter}"] = None
                continue
            ys, xs = np.where(band)
            x0, x1 = xs.min(), xs.max()
            g0 = cv2.cvtColor(im0[r0:r1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
            g1 = cv2.cvtColor(im1[r0:r1, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
            w2 = band[r0:r1, x0:x1].astype(np.float32)
            shift, resp = cv2.phaseCorrelate(g0 * w2, g1 * w2)
            mag = float(math.hypot(*shift))
            pair_disp[f"{c0.letter}-{c1.letter}"] = round(mag, 2)
            worst = max(worst, mag)

        ok = (
            len(pair_disp) == 6
            and all(v is not None for v in pair_disp.values())
            and worst <= 4.0
        )
        self.add(
            "7 hard-mask-seams",
            ok,
            pair_misregistration_px=pair_disp,
            worst_px=round(worst, 2),
            evidence="check7_hardmask_composite.jpg",
        )

    def check8_coverage(self):
        union = np.zeros((EQ_H, EQ_W), bool)
        for c in self.proj.ring:
            union |= self.maps(c.letter)[2]
        eq_row = union[EQ_H // 2]
        holes = int((~eq_row).sum())
        # explicit look at the +-180 wrap column region
        wrap_ok = bool(eq_row[:64].all() and eq_row[-64:].all())
        rows = np.where(union.any(axis=1))[0]
        lat_top = 90 - rows.min() / EQ_H * 180
        lat_bot = 90 - rows.max() / EQ_H * 180
        strip = (union[:: EQ_H // 192].astype(np.uint8)) * 255
        cv2.imwrite(str(self.out / "check8_coverage.png"), strip)
        ok = holes == 0 and wrap_ok
        self.add(
            "8 coverage",
            ok,
            equator_hole_px=holes,
            wrap_at_180_covered=wrap_ok,
            lat_range=f"{lat_bot:.1f}..{lat_top:.1f} deg",
            evidence="check8_coverage.png",
        )

    # ---------- run ----------

    def run(self) -> bool:
        self.check1_parser()
        self.check2_intrinsics_provenance()
        self.check3_rig_geometry()
        self.check4_warp_non_identity()
        self.check5_control_points()
        self.check6_gold_image()
        self.check7_hard_mask_seams()
        self.check8_coverage()

        passed = all(r.passed for r in self.results)
        summary = {
            "gate": "M0",
            "passed": passed,
            "pts": self.proj.path,
            "checks": [{"name": r.name, "passed": r.passed, **r.detail} for r in self.results],
        }
        (self.out / "gate-results.json").write_text(json.dumps(summary, indent=2, default=str))
        print(f"\nM0 GATE: {'PASS' if passed else 'FAIL'}  ({sum(r.passed for r in self.results)}/8)")
        print(f"results: {self.out}/gate-results.json")
        return passed
