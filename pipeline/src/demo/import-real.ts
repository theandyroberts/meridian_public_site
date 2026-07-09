import fs from "node:fs";
import path from "node:path";
import { DROPS_DIR } from "../paths.js";
import { CAMERA_IDS } from "@platelab/shared";

/**
 * Registers real Spheris capture folders as ingest drops without copying
 * media: per-camera MOVs are symlinked to cam_<id>.mov (camera = first
 * letter of the RED filename), and operator metadata + route telemetry
 * sidecars are written next to them.
 *
 * Telemetry note: these shoots predate the F9R logger integration, so the
 * route files here are reconstructed samples (marked as such in `source`),
 * shaped to each scene's real driving behavior.
 */

// Footage source root. Override with PLATELAB_FOOTAGE_SRC (e.g. a mounted NAS
// share) or pass as argv[2]; falls back to the local working copy.
const SRC_ROOT =
  process.argv[2] ||
  process.env.PLATELAB_FOOTAGE_SRC ||
  "/Users/andrewroberts/Projects/spheris-smart-stitch";

interface RealClip {
  src: string;
  slug: string;
  gpsStart: { lat: number; lon: number };
  headingDeg: number;
  speed: { base: number; swing: number };
  imu: boolean;
  meta: Record<string, unknown>;
}

const CLIPS: RealClip[] = [
  {
    src: "Roll01_Clip04",
    slug: "viaduct-approach",
    gpsStart: { lat: 34.0338, lon: -118.2305 },
    headingDeg: 62,
    speed: { base: 28, swing: 8 },
    imu: true,
    meta: {
      shootDate: "2026-05-03", rig: "Mercy01", timecode: "06:12:44:00",
      location: { name: "6th Street Viaduct", city: "Los Angeles", region: "CA", country: "USA" },
      timeOfDay: "dawn", weather: "cloudy", season: "spring", shotType: "bridge",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["bridge arches", "power lines", "industrial buildings", "graffiti", "street lights", "motorcycle", "guardrail"],
    },
  },
  {
    src: "Roll01_Clip07",
    slug: "mateo-signal",
    gpsStart: { lat: 34.0345, lon: -118.233 },
    headingDeg: 64,
    speed: { base: 7, swing: 7 },
    imu: true,
    meta: {
      shootDate: "2026-05-03", rig: "Mercy01", timecode: "06:31:02:12",
      location: { name: "Mateo St at 6th — Arts District", city: "Los Angeles", region: "CA", country: "USA" },
      timeOfDay: "dawn", weather: "cloudy", season: "spring", shotType: "urban",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["traffic light", "street signs", "speed limit sign", "bridge arches", "crosswalk", "power lines"],
    },
  },
  {
    src: "Roll02_Clip02",
    slug: "santa-fe-underpass",
    gpsStart: { lat: 34.0407, lon: -118.2468 },
    headingDeg: 195,
    speed: { base: 13, swing: 6 },
    imu: true,
    meta: {
      shootDate: "2026-05-17", rig: "Mercy01", timecode: "10:05:51:08",
      location: { name: "Freeway Underpass, Downtown", city: "Los Angeles", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "clear", season: "spring", shotType: "tunnel",
      stageCompat: ["led-volume", "projection"],
      sceneHints: ["freeway underpass", "concrete pillars", "overhead structure", "bus", "pedestrian", "city bus depot"],
    },
  },
  {
    src: "Roll02_Clip09",
    slug: "second-street-tunnel",
    gpsStart: { lat: 34.0535, lon: -118.248 },
    headingDeg: 245,
    speed: { base: 24, swing: 4 },
    imu: true,
    meta: {
      shootDate: "2026-05-17", rig: "Mercy01", timecode: "10:48:19:16",
      location: { name: "2nd Street Tunnel", city: "Los Angeles", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "clear", season: "spring", shotType: "tunnel",
      stageCompat: ["led-volume", "projection"],
      sceneHints: ["graffiti", "tunnel lights", "concrete walls", "tunnel portal", "lane markings"],
    },
  },
  {
    src: "Roll02_Clip13",
    slug: "pch-malibu",
    gpsStart: { lat: 34.0392, lon: -118.5814 },
    headingDeg: 285,
    speed: { base: 38, swing: 9 },
    imu: true,
    meta: {
      shootDate: "2026-05-17", rig: "Mercy01", timecode: "12:22:05:00",
      location: { name: "Pacific Coast Highway", city: "Malibu", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "clear", season: "spring", shotType: "coastal",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["ocean", "cliffs", "guardrail", "traffic", "lamp posts", "hillside homes"],
    },
  },
  {
    src: "Roll02_Clip020",
    slug: "topanga-beach",
    gpsStart: { lat: 34.0386, lon: -118.5827 },
    headingDeg: 0,
    speed: { base: 0, swing: 0 },
    imu: false,
    meta: {
      shootDate: "2026-05-17", rig: "Mercy01", timecode: "13:01:40:04",
      location: { name: "Topanga State Beach", city: "Malibu", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "clear", season: "spring", shotType: "coastal",
      stageCompat: ["led-volume", "green-screen", "projection"],
      sceneHints: ["ocean waves", "beach", "dune grass", "shoreline", "surf", "coastal houses"],
    },
  },
  {
    src: "Roll02_Take012",
    slug: "pch-topanga-roll",
    gpsStart: { lat: 34.039, lon: -118.5841 },
    headingDeg: 290,
    speed: { base: 9, swing: 6 },
    imu: false,
    meta: {
      shootDate: "2026-05-17", rig: "Mercy01", timecode: "12:48:58:20",
      location: { name: "PCH at Topanga", city: "Malibu", region: "CA", country: "USA" },
      timeOfDay: "day", weather: "cloudy", season: "spring", shotType: "coastal",
      stageCompat: ["led-volume", "green-screen"],
      sceneHints: ["ocean", "hillside", "road signs", "traffic", "cliff face", "coastal road"],
    },
  },
];

function writeTelemetry(clip: RealClip, file: string, durationSec: number): void {
  const samples = [];
  let { lat, lon } = clip.gpsStart;
  const headingRad = (clip.headingDeg * Math.PI) / 180;
  for (let t = 0; t <= Math.max(2, Math.round(durationSec)); t++) {
    const speedMph = Math.max(
      0,
      clip.speed.base +
        clip.speed.swing * Math.sin(t / 7) +
        (clip.speed.base > 0 ? 2 * Math.sin(t * 1.3) : 0),
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
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        source: "u-blox F9R RTK (sample route)",
        imu: clip.imu
          ? { collected: true, source: "F9R ESF-INS", rateHz: 100 }
          : { collected: false },
        samples,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const { ffprobeJson } = await import("../exec.js");
  for (const clip of CLIPS) {
    const srcDir = path.join(SRC_ROOT, clip.src);
    if (!fs.existsSync(srcDir)) {
      console.error(`✗ skipping ${clip.src} — not found`);
      continue;
    }
    const dropDir = path.join(DROPS_DIR, clip.slug);
    fs.rmSync(dropDir, { recursive: true, force: true });
    fs.mkdirSync(dropDir, { recursive: true });

    const files = fs.readdirSync(srcDir);
    let camA: string | undefined;
    for (const id of CAMERA_IDS) {
      const f = files.find(
        (n) => n.startsWith(id) && /\.mov$/i.test(n) && /^[A-J]\d{3}_/.test(n),
      );
      if (!f) throw new Error(`${clip.src}: no camera ${id} file`);
      const target = path.join(srcDir, f);
      fs.symlinkSync(target, path.join(dropDir, `cam_${id}.mov`));
      if (id === "A") camA = target;
    }

    const probed = await ffprobeJson(camA!);
    const durationSec = Number(probed.format?.duration ?? 60);

    writeTelemetry(clip, path.join(dropDir, "telemetry.json"), durationSec);
    fs.writeFileSync(
      path.join(dropDir, "meta.json"),
      JSON.stringify(clip.meta, null, 2),
    );
    console.log(`✓ ${clip.slug} ← ${clip.src} (${Math.round(durationSec)}s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
