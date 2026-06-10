import fs from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { DROPS_DIR } from "../paths.js";
import { findFont } from "../stages/renditions.js";
import { CAMERA_IDS, type CameraId } from "@platelab/shared";

/**
 * Synthesizes demo capture drops so the full pipeline → site path runs
 * without real footage: one "stitched master" per plate (1920x960 equirect
 * stand-in, distinct palette + motion + burned timecode) and nine camera
 * files cropped from it at each camera's yaw, so the 9-grid is genuinely
 * in sync with the stitched view.
 */

const W = 1920;
const H = 960;
const FPS = 24;

/** Yaw degrees per camera (from the Mercy01 array topology). */
const CAMERA_YAW: Record<CameraId, number> = {
  A: 0, B: 59.6, C: 120.8, D: 179.7, E: -120.8, F: -59.7,
  G: 0.4, H: 125.5, J: -117.5,
};
const SKY_CAMS = new Set<CameraId>(["G", "H", "J"]);

interface DemoPlate {
  slug: string;
  durationSec: number;
  sky: [string, string]; // gradient top, horizon glow
  ground: string;
  meta: Record<string, unknown>;
  gpsStart: { lat: number; lon: number };
  headingDeg: number;
  speedProfile: { base: number; swing: number }; // mph
  imu: boolean;
}

const PLATES: DemoPlate[] = [
  {
    slug: "fdr-dusk",
    durationSec: 68,
    sky: ["#22335c", "#d97b4f"],
    ground: "#14161c",
    gpsStart: { lat: 40.7061, lon: -74.0087 },
    headingDeg: 25,
    speedProfile: { base: 42, swing: 14 },
    imu: true,
    meta: {
      shootDate: "2026-06-10", rig: "Mercy01", timecode: "16:42:18:03",
      location: { name: "FDR Drive", city: "New York", region: "NY", country: "USA" },
      timeOfDay: "dusk", weather: "clear", season: "spring", shotType: "highway",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["river", "skyline", "overpass", "traffic", "high-rise", "water"],
    },
  },
  {
    slug: "sunset-night",
    durationSec: 12,
    sky: ["#0a0a18", "#3a1d5e"],
    ground: "#0b0b10",
    gpsStart: { lat: 34.09, lon: -118.3617 },
    headingDeg: 265,
    speedProfile: { base: 18, swing: 12 },
    imu: true,
    meta: {
      shootDate: "2026-06-10", rig: "Mercy01", timecode: "21:08:55:14",
      location: { name: "Sunset Blvd", city: "Los Angeles", region: "CA", country: "USA" },
      timeOfDay: "night", weather: "clear", season: "summer", shotType: "urban",
      stageCompat: ["led-volume", "projection"],
      sceneHints: ["palm trees", "neon signs", "storefronts", "traffic light", "billboards"],
    },
  },
  {
    slug: "mojave-day",
    durationSec: 94,
    sky: ["#7ec8e3", "#f4e8c1"],
    ground: "#c9a36a",
    gpsStart: { lat: 34.953, lon: -115.5631 },
    headingDeg: 78,
    speedProfile: { base: 71, swing: 6 },
    imu: false,
    meta: {
      shootDate: "2026-06-10", rig: "Mercy01", timecode: "11:21:40:00",
      location: { name: "Route 66, Mojave Desert", city: "Amboy", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "clear", season: "summer", shotType: "rural",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["desert", "mountains", "power lines", "open road", "heat shimmer"],
    },
  },
  {
    slug: "tunnel-run",
    durationSec: 45,
    sky: ["#1a1208", "#7a4d12"],
    ground: "#0e0a06",
    gpsStart: { lat: 34.0535, lon: -118.248 },
    headingDeg: 245,
    speedProfile: { base: 31, swing: 5 },
    imu: true,
    meta: {
      shootDate: "2026-06-10", rig: "Mercy01", timecode: "23:50:02:11",
      location: { name: "2nd Street Tunnel", city: "Los Angeles", region: "CA", country: "USA" },
      timeOfDay: "night", weather: "clear", season: "winter", shotType: "tunnel",
      stageCompat: ["led-volume", "projection"],
      sceneHints: ["tunnel lights", "concrete", "lane lines", "reflections"],
    },
  },
  {
    slug: "pch-coastal",
    durationSec: 121,
    sky: ["#5aa9d6", "#cfe8f0"],
    ground: "#3d5a66",
    gpsStart: { lat: 34.0375, lon: -118.6786 },
    headingDeg: 300,
    speedProfile: { base: 48, swing: 10 },
    imu: true,
    meta: {
      shootDate: "2026-06-10", rig: "Mercy01", timecode: "09:15:33:20",
      location: { name: "Pacific Coast Highway", city: "Malibu", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "clear", season: "spring", shotType: "coastal",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["ocean", "cliffs", "beach", "guardrail", "surf"],
    },
  },
  {
    slug: "seattle-rain",
    durationSec: 30,
    sky: ["#5a6770", "#9aa5ad"],
    ground: "#2a2f33",
    gpsStart: { lat: 47.6097, lon: -122.3331 },
    headingDeg: 180,
    speedProfile: { base: 14, swing: 9 },
    imu: true,
    meta: {
      shootDate: "2026-06-10", rig: "Mercy01", timecode: "14:02:17:08",
      location: { name: "Pike Street", city: "Seattle", region: "WA", country: "USA" },
      timeOfDay: "day", weather: "rain", season: "fall", shotType: "urban",
      stageCompat: ["led-volume", "green-screen"],
      sceneHints: ["rain", "wet pavement", "umbrellas", "storefronts", "crosswalk"],
    },
  },
];

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function renderStitched(p: DemoPlate, out: string, font: string): Promise<void> {
  const tc = String((p.meta as any).timecode).replace(/:/g, "\\:");
  const horizonY = Math.round(H * 0.64);
  const loc = (p.meta as any).location;
  const filter =
    `gradients=s=${W}x${H}:r=${FPS}:d=${p.durationSec}:c0=${p.sky[0]}:c1=${p.sky[1]}` +
    `:x0=${W / 2}:y0=0:x1=${W / 2}:y1=${horizonY}:speed=0.008[sky];` +
    `testsrc2=s=${W}x${H}:r=${FPS}:d=${p.durationSec},scroll=horizontal=0.015,format=rgba,colorchannelmixer=aa=0.16[motion];` +
    `[sky][motion]overlay,` +
    `drawbox=y=${horizonY}:h=${H - horizonY}:t=fill:color=${p.ground}@0.88,` +
    `drawbox=y=${horizonY - 2}:h=3:t=fill:color=white@0.28,` +
    `drawtext=fontfile=${font}:text='${esc(loc.name.toUpperCase() + " · " + loc.city.toUpperCase())}':fontsize=44:fontcolor=white@0.7:x=48:y=44,` +
    `drawtext=fontfile=${font}:text='SPHERIS MERCY01 · 360×180 MASTER':fontsize=26:fontcolor=white@0.5:x=w-text_w-48:y=48,` +
    `drawtext=fontfile=${font}:timecode='${tc}':timecode_rate=${FPS}:text='TC ':fontsize=30:fontcolor=white@0.8:x=w-text_w-48:y=h-text_h-40`;

  await run("ffmpeg", [
    "-v", "error", "-filter_complex", filter,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
    "-pix_fmt", "yuv420p", "-y", out,
  ]);
}

async function renderCamera(stitched: string, id: CameraId, out: string): Promise<void> {
  const yaw = CAMERA_YAW[id];
  const xCenter = (((W / 2 + (yaw / 360) * W) % W) + W) % W;
  const x = Math.max(0, Math.min(W - 480, Math.round(xCenter - 240)));
  const y = SKY_CAMS.has(id) ? 60 : 430;
  await run("ffmpeg", [
    "-v", "error", "-i", stitched,
    "-vf", `crop=480:270:${x}:${y}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
    "-pix_fmt", "yuv420p", "-an", "-y", out,
  ]);
}

function writeTelemetry(p: DemoPlate, file: string): void {
  const samples = [];
  let { lat, lon } = p.gpsStart;
  const headingRad = (p.headingDeg * Math.PI) / 180;
  for (let t = 0; t <= Math.round(p.durationSec); t++) {
    // Deterministic speed wobble; degrees per mile ≈ 1/69.
    const speedMph = Math.max(
      0,
      p.speedProfile.base + p.speedProfile.swing * Math.sin(t / 7) +
        2 * Math.sin(t * 1.3),
    );
    samples.push({
      t,
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      speedMph: Math.round(speedMph * 10) / 10,
    });
    const milesPerSec = speedMph / 3600;
    lat += (milesPerSec / 69) * Math.cos(headingRad);
    lon += (milesPerSec / (69 * Math.cos((lat * Math.PI) / 180))) * Math.sin(headingRad);
  }
  const telemetry = {
    source: "u-blox F9R RTK",
    imu: p.imu
      ? { collected: true, source: "F9R ESF-INS", rateHz: 100 }
      : { collected: false },
    samples,
  };
  fs.writeFileSync(file, JSON.stringify(telemetry, null, 2));
}

async function main() {
  const font = findFont();
  for (const p of PLATES) {
    const dir = path.join(DROPS_DIR, p.slug);
    const mediaDir = path.join(dir, "media");
    fs.mkdirSync(mediaDir, { recursive: true });

    console.log(`generating ${p.slug} (${p.durationSec}s)…`);
    const stitched = path.join(mediaDir, "stitched.mp4");
    await renderStitched(p, stitched, font);
    for (const id of CAMERA_IDS) {
      await renderCamera(stitched, id, path.join(mediaDir, `cam_${id}.mp4`));
    }
    writeTelemetry(p, path.join(mediaDir, "telemetry.json"));
    fs.writeFileSync(path.join(mediaDir, "meta.json"), JSON.stringify(p.meta, null, 2));
    // Drop layout expects everything in one directory.
    for (const f of fs.readdirSync(mediaDir)) {
      fs.renameSync(path.join(mediaDir, f), path.join(dir, f));
    }
    fs.rmdirSync(mediaDir);
  }
  console.log(`✓ ${PLATES.length} demo drops in ${DROPS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
