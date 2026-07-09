"""PTGui v33 project (.pts) parser.

Parses the REAL PTGui Pro 12 JSON schema (project_v33), the one the old Swift
importer could never read: rotations live in project.imagegroups[i].position.params,
lens focal is millimetres in project.globallenses[k].lens.params with a sensor
diagonal, and shift is normalized fractions in globallenses[k].shift.params.

Intrinsics provenance rule (M0 check 2): focal pixels are derived ONLY from the
PTGui-solved focal length and the PTGui-solved sensor diagonal. No nominal lens
specs, no hardcoded sensor widths.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Lens:
    index: int
    projection: str
    focal_mm: float
    sensor_diag_mm: float
    a: float
    b: float
    c: float
    shift_long: float  # fraction of long side, +right
    shift_short: float  # fraction of short side, +down


@dataclass
class Camera:
    letter: str
    group_index: int
    yaw: float  # degrees, PTGui convention (matches Ry(yaw)Rx(pitch)Rz(roll), y-down world)
    pitch: float
    roll: float
    width: int  # calibration resolution
    height: int
    lens: Lens
    filename: str = ""

    @property
    def sensor_width_mm(self) -> float:
        d = self.lens.sensor_diag_mm
        return d * self.width / math.hypot(self.width, self.height)

    def f_px(self, at_width: int | None = None) -> float:
        """Focal in pixels at the given image width (defaults to calibration width)."""
        w = self.width if at_width is None else at_width
        return self.lens.focal_mm / self.sensor_width_mm * w

    @property
    def hfov_deg(self) -> float:
        return 2 * math.degrees(math.atan(self.width / (2 * self.f_px())))

    def principal(self, at_width: int, at_height: int) -> tuple[float, float]:
        """Principal point at a given resolution: center + PTGui shift.

        PTGui shift.params.longside/shortside are fractions; for landscape
        frames long side = width, short side = height.
        """
        cx = at_width / 2.0 + self.lens.shift_long * at_width
        cy = at_height / 2.0 + self.lens.shift_short * at_height
        return cx, cy


@dataclass
class ControlPoint:
    img0: int
    x0: float
    y0: float
    img1: int
    x1: float
    y1: float
    kind: int  # t: 0 = normal


@dataclass
class PtsProject:
    path: str
    cameras: list[Camera]
    lenses: list[Lens]
    control_points: list[ControlPoint]
    pano_projection: str
    pano_hfov: float
    by_letter: dict[str, Camera] = field(default_factory=dict)

    def __post_init__(self):
        self.by_letter = {c.letter: c for c in self.cameras}

    RING = "ABCDEF"
    SKY = "GHJ"

    @property
    def ring(self) -> list[Camera]:
        return [self.by_letter[x] for x in self.RING if x in self.by_letter]


def load_pts(path: str | Path) -> PtsProject:
    doc = json.loads(Path(path).read_text())
    proj = doc["project"]

    lenses = []
    for i, entry in enumerate(proj["globallenses"]):
        lp = entry["lens"]["params"]
        sh = entry["shift"]["params"]
        lenses.append(
            Lens(
                index=i,
                projection=str(lp.get("projection", "")),
                focal_mm=float(lp["focallength"]),
                sensor_diag_mm=float(lp["sensordiagonal"]),
                a=float(lp["a"]),
                b=float(lp["b"]),
                c=float(lp["c"]),
                shift_long=float(sh["longside"]),
                shift_short=float(sh["shortside"]),
            )
        )

    cameras = []
    for gi, g in enumerate(proj["imagegroups"]):
        pos = g["position"]["params"]
        w, h = g["size"]
        fn = g["images"][0]["filename"]
        cameras.append(
            Camera(
                letter=fn[0].upper(),
                group_index=gi,
                yaw=float(pos["yaw"]),
                pitch=float(pos["pitch"]),
                roll=float(pos["roll"]),
                width=int(w),
                height=int(h),
                lens=lenses[int(g["globallens"])],
                filename=fn,
            )
        )

    cps = []
    for cp in proj.get("controlpoints", []):
        i0, _, x0, y0 = cp["0"]
        i1, _, x1, y1 = cp["1"]
        cps.append(ControlPoint(int(i0), float(x0), float(y0), int(i1), float(x1), float(y1), int(cp.get("t", 0))))

    pano = proj.get("panoramaparams", {})
    return PtsProject(
        path=str(path),
        cameras=cameras,
        lenses=lenses,
        control_points=cps,
        pano_projection=str(pano.get("projection", "")),
        pano_hfov=float(pano.get("hfov", 360.0)),
    )
