import path from "node:path";
import { CAMERA_IDS } from "@platelab/shared";
import { discover } from "./stages/discover.js";
import { resolveCalibration } from "./stages/calibration.js";
import { isFullSphere } from "./stages/master.js";
import { probe, type ProbeResult } from "./stages/probe.js";
import { loadTelemetry } from "./stages/telemetry.js";

export type PreflightLevel = "pass" | "warning" | "blocker";

export interface PreflightCheck {
  level: PreflightLevel;
  check: string;
  detail: string;
}

export interface PreflightResult {
  dropDir: string;
  ready: boolean;
  checks: PreflightCheck[];
}

function sameWithin(values: number[], tolerance: number): boolean {
  if (values.length < 2) return true;
  return Math.max(...values) - Math.min(...values) <= tolerance;
}

function summary(probed: ProbeResult): string {
  return `${probed.width}x${probed.height}, ${probed.fps} fps, ${probed.durationSec.toFixed(2)}s, ${probed.codec}`;
}

/** Read-only readiness check for one drop. It never creates media or catalog rows. */
export async function preflightDrop(dropDir: string): Promise<PreflightResult> {
  const resolved = path.resolve(dropDir);
  const checks: PreflightCheck[] = [];
  let drop;
  try {
    drop = discover(resolved);
    checks.push({ level: "pass", check: "drop", detail: "metadata and media layout parsed" });
  } catch (error) {
    return {
      dropDir: resolved,
      ready: false,
      checks: [{
        level: "blocker",
        check: "drop",
        detail: error instanceof Error ? error.message : "drop discovery failed",
      }],
    };
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    checks.push({ level: "pass", check: "AI metadata", detail: "OpenAI API key is available" });
  } else {
    checks.push({
      level: "blocker",
      check: "AI metadata",
      detail: "OPENAI_API_KEY is required for visual labels and catalog copy",
    });
  }

  let suppliedFullSphere = false;
  if (drop.stitchedMaster) {
    try {
      const masterProbe = await probe(drop.stitchedMaster);
      const isSphere = isFullSphere(masterProbe);
      const trusted = drop.meta.trustedStitchedMaster || process.env.PLATELAB_TRUST_SUPPLIED_MASTER === "true";
      suppliedFullSphere = isSphere && trusted;
      const hasNineSources = Object.keys(drop.cameraFiles).length === CAMERA_IDS.length;
      checks.push({
        level: suppliedFullSphere ? "pass" : isSphere && !hasNineSources ? "blocker" : "warning",
        check: "supplied master",
        detail:
          `${summary(masterProbe)}; ` +
          (suppliedFullSphere
            ? "verified 2:1 full sphere and explicitly trusted"
            : isSphere
              ? "2:1 geometry but no stitchlab QC/operator trust; nine-camera sources will be rebuilt when available"
              : "not a 2:1 full sphere"),
      });
    } catch (error) {
      checks.push({
        level: "blocker",
        check: "supplied master",
        detail: error instanceof Error ? error.message : "could not probe master",
      });
    }
  }

  const present = CAMERA_IDS.filter((id) => Boolean(drop.cameraFiles[id]));
  if (!suppliedFullSphere) {
    if (present.length !== CAMERA_IDS.length) {
      checks.push({
        level: "blocker",
        check: "camera set",
        detail: `full-sphere stitching needs 9 cameras; found ${present.length} (${present.join(", ") || "none"})`,
      });
    } else {
      checks.push({ level: "pass", check: "camera set", detail: "all 9 ring and sky cameras found" });
      const cameraProbes = await Promise.all(
        CAMERA_IDS.map(async (id) => ({ id, probed: await probe(drop.cameraFiles[id]!) })),
      ).catch((error) => {
        checks.push({
          level: "blocker",
          check: "camera probe",
          detail: error instanceof Error ? error.message : "could not probe camera sources",
        });
        return [] as Array<{ id: (typeof CAMERA_IDS)[number]; probed: ProbeResult }>;
      });
      if (cameraProbes.length) {
        const dimensions = new Set(cameraProbes.map(({ probed }) => `${probed.width}x${probed.height}`));
        const fps = cameraProbes.map(({ probed }) => probed.fps);
        const durations = cameraProbes.map(({ probed }) => probed.durationSec);
        const consistent = dimensions.size === 1 && sameWithin(fps, 0.02) && sameWithin(durations, 1);
        checks.push({
          level: consistent ? "pass" : "blocker",
          check: "camera consistency",
          detail: consistent
            ? `${[...dimensions][0]}, ${fps[0]} fps; durations align within 1 second`
            : `dimensions=${[...dimensions].join(", ")}; fps=${fps.join(", ")}; duration range=${Math.min(...durations).toFixed(2)}–${Math.max(...durations).toFixed(2)}s`,
        });
      }
    }

    try {
      const calibration = resolveCalibration(drop);
      if (!calibration) {
        checks.push({
          level: "blocker",
          check: "calibration",
          detail: `no calibration registered for rig ${drop.meta.rig}`,
        });
      } else {
        checks.push({
          level: calibration.assumed ? "warning" : "pass",
          check: "calibration",
          detail: `${calibration.id} (${calibration.source})${calibration.assumed ? "; confirm this rig before batch ingest" : ""}`,
        });
      }
    } catch (error) {
      checks.push({
        level: "blocker",
        check: "calibration",
        detail: error instanceof Error ? error.message : "calibration selection failed",
      });
    }
  }

  if (drop.telemetryPath) {
    try {
      const telemetry = loadTelemetry(drop.telemetryPath);
      checks.push({
        level: "pass",
        check: "telemetry",
        detail: `${telemetry.gps.path.length} route points; ${telemetry.gps.avgSpeedMph} mph average; IMU ${telemetry.imu.collected ? "present" : "absent"}`,
      });
    } catch (error) {
      checks.push({
        level: "blocker",
        check: "telemetry",
        detail: error instanceof Error ? error.message : "telemetry could not be parsed",
      });
    }
  } else {
    checks.push({ level: "warning", check: "telemetry", detail: "no telemetry sidecar; map and route names will be unavailable" });
  }

  return {
    dropDir: resolved,
    ready: !checks.some((check) => check.level === "blocker"),
    checks,
  };
}

export function printPreflight(result: PreflightResult): void {
  const icon: Record<PreflightLevel, string> = { pass: "✓", warning: "!", blocker: "✗" };
  console.log(`\n${result.ready ? "READY" : "BLOCKED"}  ${result.dropDir}`);
  for (const check of result.checks) {
    console.log(`  ${icon[check.level]} ${check.check}: ${check.detail}`);
  }
}
