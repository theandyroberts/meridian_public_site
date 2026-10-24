import fs from "node:fs";
import path from "node:path";
import { ffprobeJson } from "../exec.js";
import { DROPS_DIR } from "../paths.js";
import { ingestDrop } from "../ingest.js";
import { CAMERA_IDS, type CameraId } from "@platelab/shared";

const DEFAULT_ROOT =
  "/Volumes/SMB/01042024_GA_DTLA/MMM_LEGACY_SORT/SPH-STK-LEGACY-20260803-GA-DTLA-DTLA-DAY01";
const DEFAULT_CLIP = "CLIP-0010";

const CAMERA_NUMBER_TO_ID: Record<string, CameraId> = {
  "01": "A",
  "02": "B",
  "03": "C",
  "04": "D",
  "05": "E",
  "06": "F",
  "07": "G",
  "08": "H",
  "09": "J",
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseShootDate(value: unknown): string {
  const s = String(value ?? "");
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const fromId = /-(\d{8})-/.exec(s);
  if (fromId) return parseShootDate(fromId[1]);
  return "2026-08-03";
}

function framesToTc(frames: number, fps = 24): string {
  const totalSeconds = Math.floor(frames / fps);
  const ff = frames % fps;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const r = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function telemetrySourceLabel(source: unknown): string {
  if (typeof source === "string" && source.trim()) return source;
  if (source && typeof source === "object") {
    const s = source as { kind?: unknown; file_count?: unknown; sample_count?: unknown };
    const kind = typeof s.kind === "string" ? s.kind : "legacy GPS/IMU";
    const details = [
      typeof s.file_count === "number" ? `${s.file_count} files` : undefined,
      typeof s.sample_count === "number" ? `${s.sample_count} samples` : undefined,
    ].filter(Boolean);
    return details.length ? `${kind} (${details.join(", ")})` : kind;
  }
  return "Legacy Android LTC GPS/IMU";
}

function convertGpsImu(src: string, dst: string, durationSec: number): void {
  const legacy = JSON.parse(fs.readFileSync(src, "utf8"));
  const gps = legacy.samples?.gps ?? [];
  const imu = legacy.samples?.imu ?? [];
  if (gps.length < 2) throw new Error(`${src}: expected at least two GPS samples`);
  fs.copyFileSync(src, path.join(path.dirname(dst), "gps_imu.source.json"));

  const firstFrame = Number(gps[0].tc_frames ?? 0);
  const keyframes = [];
  let nextSecond = 0;
  for (const sample of gps) {
    const t = (Number(sample.tc_frames ?? firstFrame) - firstFrame) / 24;
    if (t + 0.001 < nextSecond) continue;
    keyframes.push({
      t: Math.round(t * 1000) / 1000,
      lat: Number(sample.latitude),
      lon: Number(sample.longitude),
    });
    nextSecond += 1;
  }
  const lastGps = gps[gps.length - 1];
  const lastT = (Number(lastGps.tc_frames ?? firstFrame) - firstFrame) / 24;
  const lastKeyframe = keyframes[keyframes.length - 1];
  if (!lastKeyframe || lastT - lastKeyframe.t > 0.5) {
    keyframes.push({
      t: Math.round(lastT * 1000) / 1000,
      lat: Number(lastGps.latitude),
      lon: Number(lastGps.longitude),
    });
  }
  if (keyframes.length < 2) {
    const last = gps[gps.length - 1];
    keyframes.push({
      t: Math.max(1, Math.round(durationSec * 1000) / 1000),
      lat: Number(last.latitude),
      lon: Number(last.longitude),
    });
  }

  const speeds = keyframes.map((sample, index) => {
    const prev = keyframes[Math.max(0, index - 1)];
    const next = keyframes[Math.min(keyframes.length - 1, index + 1)];
    const dt = Math.max(0.001, next.t - prev.t);
    const mph = (milesBetween(
      { latitude: prev.lat, longitude: prev.lon },
      { latitude: next.lat, longitude: next.lon },
    ) / dt) * 3600;
    return Math.round(Math.max(0, Math.min(90, mph)) * 10) / 10;
  });

  let keyframeIndex = 0;
  const samples = gps.map((sample) => {
    const t = (Number(sample.tc_frames ?? firstFrame) - firstFrame) / 24;
    while (keyframeIndex < keyframes.length - 2 && keyframes[keyframeIndex + 1].t <= t) {
      keyframeIndex += 1;
    }
    return {
      t: Math.round(t * 1000) / 1000,
      lat: Number(sample.latitude),
      lon: Number(sample.longitude),
      speedMph: speeds[keyframeIndex],
    };
  });

  fs.writeFileSync(
    dst,
    JSON.stringify(
      {
        source: telemetrySourceLabel(legacy.source),
        imu: legacy.availability?.imu_available
          ? {
              collected: true,
              source: "Legacy Android LTC IMU",
              rateHz: Math.round((imu.length / Math.max(durationSec, 1)) * 10) / 10,
            }
          : { collected: false },
        samples,
      },
      null,
      2,
    ),
  );
}

function findClip(root: string, selector: string): string {
  const clipsDir = path.join(root, "clips");
  const matches = fs.readdirSync(clipsDir).filter((d) => d.includes(selector));
  if (matches.length !== 1) {
    throw new Error(`expected one clip matching "${selector}", found ${matches.length}`);
  }
  return path.join(clipsDir, matches[0]);
}

async function prepareDrop(root: string, selector: string, slugArg?: string): Promise<{ dropDir: string; stockClipId: string }> {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "website_manifest.json"), "utf8"));
  const clipDir = findClip(root, selector);
  const clipName = path.basename(clipDir);
  const stockClipId = clipName.split("__")[0];
  const slug = slugArg ?? slugify(stockClipId);
  const dropDir = path.join(DROPS_DIR, slug);
  fs.rmSync(dropDir, { recursive: true, force: true });
  fs.mkdirSync(dropDir, { recursive: true });

  const proxiesDir = path.join(clipDir, "assets", "proxies");
  for (const [num, id] of Object.entries(CAMERA_NUMBER_TO_ID)) {
    const src = path.join(proxiesDir, `CAM_${num}_2048x1080_proxy.mov`);
    if (!fs.existsSync(src)) throw new Error(`${clipName}: missing proxy ${src}`);
    fs.symlinkSync(src, path.join(dropDir, `cam_${id}.mov`));
  }

  const probe = await ffprobeJson(path.join(dropDir, "cam_A.mov"));
  const durationSec = Number(probe.format?.duration ?? 0);
  const firstGps = JSON.parse(fs.readFileSync(path.join(clipDir, "gps_imu", "gps_imu.json"), "utf8"))
    .samples?.gps?.[0];

  convertGpsImu(
    path.join(clipDir, "gps_imu", "gps_imu.json"),
    path.join(dropDir, "telemetry.json"),
    durationSec,
  );

  const shootDate = parseShootDate(manifest.shoot_date ?? manifest.job_id);
  fs.writeFileSync(
    path.join(dropDir, "meta.json"),
    JSON.stringify(
      {
        shootDate,
        rig: "Spheris XL",
        ...(firstGps?.tc_frames != null ? { timecode: framesToTc(Number(firstGps.tc_frames)) } : {}),
        location: { name: "GA DTLA", city: "Los Angeles", region: "CA", country: "USA" },
        timeOfDay: "day",
        weather: "clear",
        season: "summer",
        shotType: "urban",
        stageCompat: ["led-volume", "green-screen", "projection"],
        sceneHints: [
          "downtown los angeles",
          "urban streets",
          "traffic",
          "high rises",
          "intersections",
          "day exterior",
        ],
        colorState: "graded",
      },
      null,
      2,
    ),
  );

  return { dropDir, stockClipId };
}

async function main() {
  const root = process.argv[2] ?? process.env.PLATELAB_LEGACY_MMM_ROOT ?? DEFAULT_ROOT;
  const selector = process.argv[3] ?? DEFAULT_CLIP;
  const slug = process.argv[4];
  const { dropDir, stockClipId } = await prepareDrop(root, selector, slug);
  const plate = await ingestDrop(dropDir, { status: "draft", stockClipId });
  console.log(`✓ ${plate.sku} ${plate.title}`);
  console.log(`drop: ${dropDir}`);
  console.log(`stockClipId: ${stockClipId}`);
  console.log(`gps samples: ${plate.gps?.path.length ?? 0}, imu: ${plate.imu.collected ? "yes" : "no"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
