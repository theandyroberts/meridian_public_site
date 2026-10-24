import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../exec.js";
import { CAMERA_IDS } from "@platelab/shared";
import { probe, type ProbeResult } from "./probe.js";
import { resolveCalibration, type CalibrationSelection } from "./calibration.js";
import type { Drop } from "./discover.js";

const STITCH_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../stitch",
);

export interface PreparedMaster {
  path: string;
  probe: ProbeResult;
  source: "supplied-full-sphere" | "calibrated-nine-camera-stitch";
  calibration?: CalibrationSelection;
  metricsPath?: string;
}

export function isFullSphere(probed: Pick<ProbeResult, "width" | "height">): boolean {
  return probed.height > 0 && Math.abs(probed.width / probed.height - 2) <= 0.03;
}

function pythonExecutable(): string {
  const configured = process.env.STITCHLAB_PYTHON?.trim();
  if (configured) return configured;
  const bundled = path.join(STITCH_ROOT, ".venv", "bin", "python");
  return fs.existsSync(bundled) ? bundled : "python3";
}

interface StitchMetrics {
  metrics?: {
    success_criterion?: { pass?: boolean };
    absolute_regression?: { available?: boolean; pass?: boolean };
  };
}

function assertQcPassed(metricsPath: string): void {
  if (!fs.existsSync(metricsPath)) {
    throw new Error(`stitch completed without QC metrics: ${metricsPath}`);
  }
  const doc = JSON.parse(fs.readFileSync(metricsPath, "utf8")) as StitchMetrics;
  const criterion = doc.metrics?.success_criterion;
  const regression = doc.metrics?.absolute_regression;
  if (criterion?.pass !== true) {
    throw new Error(`stitch QC failed: ${metricsPath}`);
  }
  if (regression?.available && regression.pass !== true) {
    throw new Error(`stitch regressed against the approved baseline: ${metricsPath}`);
  }
}

function buildStitchInput(drop: Drop, inputDir: string): void {
  fs.mkdirSync(inputDir, { recursive: true });
  for (const id of CAMERA_IDS) {
    const source = drop.cameraFiles[id];
    if (!source) throw new Error(`${drop.dir}: missing camera ${id}`);
    const extension = path.extname(source).toLowerCase() || ".mov";
    const link = path.join(inputDir, `cam_${id}${extension}`);
    fs.rmSync(link, { force: true });
    fs.symlinkSync(path.resolve(source), link);
  }
}

/**
 * Return a verified full-sphere source for catalog previews. A ring grid is
 * never a master: nine-camera drops are sent through stitchlab, and its
 * quantitative QC result is a hard publication gate.
 */
export async function prepareFullSphereMaster(drop: Drop): Promise<PreparedMaster> {
  if (drop.stitchedMaster) {
    const suppliedProbe = await probe(drop.stitchedMaster);
    const trusted = drop.meta.trustedStitchedMaster || process.env.PLATELAB_TRUST_SUPPLIED_MASTER === "true";
    if (isFullSphere(suppliedProbe) && trusted) {
      return {
        path: drop.stitchedMaster,
        probe: suppliedProbe,
        source: "supplied-full-sphere",
      };
    }
    if (Object.keys(drop.cameraFiles).length !== 9) {
      throw new Error(
        isFullSphere(suppliedProbe)
          ? `${drop.stitchedMaster}: 2:1 master has no stitchlab QC; set ` +
              "meta.trustedStitchedMaster only after operator review"
          : `${drop.stitchedMaster}: supplied stitch is ${suppliedProbe.width}x${suppliedProbe.height}, ` +
              "not a 2:1 full sphere, and nine camera sources are unavailable",
      );
    }
  }

  if (Object.keys(drop.cameraFiles).length !== 9) {
    throw new Error(`${drop.dir}: a full sphere requires all nine camera sources`);
  }
  const calibration = resolveCalibration(drop);
  if (!calibration) {
    throw new Error(
      `${drop.dir}: no calibration is registered for rig ${drop.meta.rig}; ` +
        "add a .pts file or set meta.calibrationProfile before ingest",
    );
  }

  const outDir = path.join(drop.dir, ".platelab", "stitch9", calibration.id);
  // Adapted MMM handoffs keep the nine files under assets/ with role-based
  // names. Give stitchlab its stable cam_A…cam_J contract through symlinks;
  // originals remain untouched and are never copied into scratch storage.
  const inputDir = path.join(outDir, "source");
  buildStitchInput(drop, inputDir);
  const masterPath = path.join(outDir, "source_nineband_prores.mov");
  const metricsPath = path.join(outDir, "metrics.json");
  if (!(fs.existsSync(masterPath) && fs.existsSync(metricsPath))) {
    fs.mkdirSync(outDir, { recursive: true });
    await run(
      pythonExecutable(),
      [
        "-m", "stitchlab", "stitch9",
        "--drop", inputDir,
        "--pts", calibration.path,
        "--out", outDir,
        "--refine",
        "--full",
      ],
      { cwd: STITCH_ROOT, maxBuffer: 128 * 1024 * 1024 },
    );
  }
  assertQcPassed(metricsPath);
  const stitchedProbe = await probe(masterPath);
  if (!isFullSphere(stitchedProbe)) {
    throw new Error(
      `stitchlab output is not a 2:1 full sphere: ${stitchedProbe.width}x${stitchedProbe.height}`,
    );
  }
  return {
    path: masterPath,
    probe: stitchedProbe,
    source: "calibrated-nine-camera-stitch",
    calibration,
    metricsPath,
  };
}
