import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CAMERA_IDS, type CameraId } from "@platelab/shared";

/**
 * A "drop" is one clip's worth of capture-day output:
 *   stitched.mov|mp4        equirect master from MLS recording
 *   cam_<A..J>.mov|mp4      per-camera media (proxy or original)
 *   telemetry.json          F9R GPS/IMU sidecar (exported from capture)
 *   meta.json               operator-entered shoot metadata
 *   *.pts                   PTGui calibration used for the stitch (optional)
 */

export const dropMetaSchema = z.object({
  shootDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rig: z.string(),
  timecode: z.string().optional(),
  location: z.object({
    name: z.string(),
    city: z.string(),
    region: z.string(),
    country: z.string(),
  }),
  timeOfDay: z.enum(["dawn", "day", "dusk", "night"]),
  weather: z.enum(["clear", "cloudy", "rain", "fog", "snow"]),
  season: z.enum(["spring", "summer", "fall", "winter"]),
  shotType: z.enum([
    "highway", "urban", "residential", "tunnel", "bridge", "coastal", "rural",
  ]),
  stageCompat: z.array(z.enum(["led-volume", "green-screen", "projection"])),
  /** Operator scene notes; also feed the offline labeler stub. */
  sceneHints: z.array(z.string()).default([]),
  /** 'log' masters get the preview viewing grade; 'graded' masters are web-ready. */
  colorState: z.enum(["log", "graded"]).default("log"),
});

export type DropMeta = z.infer<typeof dropMetaSchema>;

export interface Drop {
  dir: string;
  /** Absent when MLS recording wasn't running — preview pano is built from the ring. */
  stitchedMaster?: string;
  /** Partial when the drop is stitched-only (MMM live-stitch fallback). */
  cameraFiles: Partial<Record<CameraId, string>>;
  telemetryPath?: string;
  calibrationPath?: string;
  meta: DropMeta;
}

function findOne(dir: string, candidates: string[]): string | undefined {
  for (const name of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function discover(dir: string): Drop {
  if (!fs.existsSync(dir)) throw new Error(`drop dir not found: ${dir}`);

  const stitchedMaster = findOne(dir, ["stitched.mov", "stitched.mp4"]);

  const entries = fs.readdirSync(dir);
  const cameraFiles: Partial<Record<CameraId, string>> = {};
  const missing: string[] = [];
  for (const id of CAMERA_IDS) {
    // Explicit cam_<id> name, else the Spheris/RED convention: the clip's
    // camera is the first letter of the filename (A001_A004_0323U7.mov).
    const explicit = findOne(dir, [`cam_${id}.mov`, `cam_${id}.mp4`]);
    const byConvention = entries.find(
      (f) => f.startsWith(id) && /\.(mov|mp4)$/i.test(f) && /^[A-J]\d{3}_/.test(f),
    );
    const file = explicit ?? (byConvention ? path.join(dir, byConvention) : undefined);
    if (file) cameraFiles[id] = file;
    else missing.push(id);
  }

  // A drop is ingestible with all 9 cameras, or with a stitched master alone
  // (MMM captured_live_stitch fallback — no per-camera previews).
  if (missing.length > 0 && Object.keys(cameraFiles).length > 0 && !stitchedMaster) {
    throw new Error(`${dir}: missing cameras ${missing.join(",")}`);
  }
  if (missing.length === CAMERA_IDS.length && !stitchedMaster) {
    throw new Error(`${dir}: no media — need 9 cameras or a stitched master`);
  }

  const telemetryPath = findOne(dir, ["telemetry.json"]);

  const metaPath = findOne(dir, ["meta.json"]);
  if (!metaPath) throw new Error(`${dir}: missing meta.json`);
  const meta = dropMetaSchema.parse(JSON.parse(fs.readFileSync(metaPath, "utf8")));

  const calibrationPath = fs.readdirSync(dir).find((f) => f.endsWith(".pts"));

  return {
    dir,
    stitchedMaster,
    cameraFiles,
    telemetryPath,
    calibrationPath: calibrationPath ? path.join(dir, calibrationPath) : undefined,
    meta,
  };
}
