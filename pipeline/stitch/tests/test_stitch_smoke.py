"""Smoke tests for TC parsing/alignment, gain solve, and seam choice.

No video IO — pure synthetic arrays. Runs under pytest, or standalone:
    pipeline/stitch/.venv/bin/python pipeline/stitch/tests/test_stitch_smoke.py
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from stitchlab.clip import align_offsets, parse_timecode  # noqa: E402
from stitchlab.ninestitch import (  # noqa: E402
    _fill_internal_coverage_holes,
    _full_equirect_frame,
    _internal_coverage_holes,
)
from stitchlab.ringstitch import seam_cost_curve, solve_gains  # noqa: E402


def test_parse_timecode():
    assert parse_timecode("00:00:00:00", 24) == 0
    assert parse_timecode("00:00:01:00", 24) == 24
    assert parse_timecode("07:00:43:02", 24) == ((7 * 60 + 0) * 60 + 43) * 24 + 2
    assert parse_timecode("01:02:03:05", 25) == ((1 * 60 + 2) * 60 + 3) * 25 + 5
    for bad in ("01:02:03;04", "01:02:03", "00:00:00:24"):
        try:
            parse_timecode(bad, 24)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected ValueError for {bad!r}")


def test_align_offsets():
    tcf = {"A": 102, "B": 100, "C": 101, "D": 101, "E": 101, "F": 102}
    off = align_offsets(tcf)
    assert off == {"A": 0, "B": 2, "C": 1, "D": 1, "E": 1, "F": 0}
    # spread > 12 must raise loudly
    try:
        align_offsets({"A": 0, "B": 20})
    except ValueError as e:
        assert "spread" in str(e)
    else:
        raise AssertionError("expected ValueError for 20-frame TC spread")


def test_solve_gains():
    letters = list("ABCDEF")
    true_gains = {"A": 1.0, "B": 1.10, "C": 0.85, "D": 1.02, "E": 0.95, "F": 1.25}
    pairs = [("E", "F"), ("F", "A"), ("A", "B"), ("B", "C"), ("C", "D"), ("D", "E")]
    rng = np.random.default_rng(7)
    frame_means = []
    for _ in range(8):
        means = {}
        for li, lj in pairs:
            scene = rng.uniform(0.05, 0.6)  # true linear radiance in the overlap
            means[(li, lj)] = (scene / true_gains[li], scene / true_gains[lj])
        frame_means.append(means)
    gains = solve_gains(frame_means, letters, anchor="A")
    assert abs(gains["A"] - 1.0) < 1e-12
    for l in letters:
        assert abs(gains[l] - true_gains[l]) < 1e-6, (l, gains[l], true_gains[l])


def test_seam_cost_curve_picks_engineered_column():
    h, w = 120, 200
    rng = np.random.default_rng(3)
    base = rng.uniform(0.1, 0.5, size=(h, w)).astype(np.float32)
    target = 137
    blocks_i, blocks_j = [], []
    for _ in range(4):
        bi = base + rng.normal(0, 0.002, size=(h, w)).astype(np.float32)
        bj = base + 0.05  # constant photometric mismatch everywhere...
        bj = bj.astype(np.float32).copy()
        bj[:, target] = bi[:, target]  # ...except a perfect-match column
        blocks_i.append(bi)
        blocks_j.append(bj)
    valid = np.ones((h, w), bool)
    valid[: h // 2, :10] = False  # some invalid pixels must not break masking
    cost = seam_cost_curve(blocks_i, blocks_j, valid, 1.0, 1.0)
    assert cost.shape == (w,)
    assert int(np.argmin(cost)) == target
    # fully-invalid columns are excluded via +inf
    valid2 = valid.copy()
    valid2[:, 5] = False
    cost2 = seam_cost_curve(blocks_i, blocks_j, valid2, 1.0, 1.0)
    assert np.isinf(cost2[5])


def test_full_equirect_frame_preserves_latitude_and_2_to_1_shape():
    nine = SimpleNamespace(eq_w=8, eq_h=4, r0_9=0, r1_9=3, band_h=3)
    band = np.full((3, 8, 3), 127, dtype=np.uint8)
    frame = _full_equirect_frame(nine, band)
    assert frame.shape == (4, 8, 3)
    assert np.array_equal(frame[:3], band)
    assert np.count_nonzero(frame[3]) == 0


def test_internal_coverage_holes_excludes_nadir_and_edge_gaps():
    covered = np.ones((20, 30), dtype=bool)
    covered[5:8, 10:13] = False   # enclosed calibration sliver: fill
    covered[15:, :] = False       # nadir/lower crop: preserve
    covered[2:4, :2] = False      # edge-connected missing coverage: preserve
    mask, boxes = _internal_coverage_holes(covered)
    assert len(boxes) == 1
    assert np.all(mask[5:8, 10:13] == 255)
    assert np.count_nonzero(mask[15:]) == 0
    assert np.count_nonzero(mask[2:4, :2]) == 0

    frame = np.full((20, 30, 3), 80, dtype=np.uint8)
    frame[5:8, 10:13] = 0
    repaired = _fill_internal_coverage_holes(frame, mask, boxes)
    assert np.all(repaired[5:8, 10:13] > 0)
    assert np.array_equal(repaired[0], frame[0])


if __name__ == "__main__":
    for fn in (test_parse_timecode, test_align_offsets, test_solve_gains,
               test_seam_cost_curve_picks_engineered_column,
               test_full_equirect_frame_preserves_latitude_and_2_to_1_shape,
               test_internal_coverage_holes_excludes_nadir_and_edge_gaps):
        fn()
        print(f"ok  {fn.__name__}")
    print("all smoke tests passed")
