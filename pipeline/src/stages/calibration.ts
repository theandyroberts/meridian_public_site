import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Drop } from "./discover.js";

const STITCH_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../stitch",
);
const BUNDLED_PROFILES: Record<string, string> = {
  "mercy01-v1": path.join(STITCH_ROOT, "calibration", "mercy01-v1.json"),
  "legacy-xl-ga-dtla-2024-v1": path.join(
    STITCH_ROOT,
    "calibration",
    "legacy-xl-ga-dtla-2024-v1.json",
  ),
};

export interface CalibrationSelection {
  id: string;
  path: string;
  source: "drop" | "environment" | "metadata" | "bundled-default";
  assumed: boolean;
}

export function resolveCalibration(drop: Drop): CalibrationSelection | undefined {
  if (drop.calibrationPath) {
    return {
      id: path.basename(drop.calibrationPath, path.extname(drop.calibrationPath)),
      path: drop.calibrationPath,
      source: "drop",
      assumed: false,
    };
  }

  const environmentPath = process.env.PLATELAB_CALIBRATION_PATH?.trim();
  if (environmentPath) {
    const resolved = path.resolve(environmentPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`PLATELAB_CALIBRATION_PATH does not exist: ${resolved}`);
    }
    return {
      id: process.env.PLATELAB_CALIBRATION_PROFILE?.trim() || path.basename(resolved),
      path: resolved,
      source: "environment",
      assumed: false,
    };
  }

  const explicitId = drop.meta.calibrationProfile;
  if (explicitId) {
    const profilePath = BUNDLED_PROFILES[explicitId];
    if (!profilePath) {
      throw new Error(
        `Unknown calibration profile ${explicitId}; available profiles: ${Object.keys(BUNDLED_PROFILES).join(", ")}`,
      );
    }
    return { id: explicitId, path: profilePath, source: "metadata", assumed: false };
  }

  // The bundled profile is a standing calibration for the Mercy01 rig only.
  // A legacy/unknown rig must name a profile (or bring its own .pts) rather
  // than silently receiving camera geometry that may be physically wrong.
  if (!/^mercy\s*0?1$/i.test(drop.meta.rig.trim())) return undefined;

  const defaultPath = BUNDLED_PROFILES["mercy01-v1"];
  return fs.existsSync(defaultPath)
    ? {
        id: "mercy01-v1",
        path: defaultPath,
        source: "bundled-default",
        assumed: true,
      }
    : undefined;
}

export function bundledCalibrationProfiles(): string[] {
  return Object.keys(BUNDLED_PROFILES);
}
