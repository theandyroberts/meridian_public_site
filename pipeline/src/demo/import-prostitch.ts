import fs from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { DROPS_DIR } from "../paths.js";
import { CAMERA_IDS, type CameraId } from "@platelab/shared";

/**
 * Registers a PRO-STITCHED equirect deliverable as an ingest drop.
 *
 * Unlike raw capture drops (9 camera files, no stitch), a pro-stitch drop has
 * the finished 360 master and NO per-camera sources. We build the standard
 * drop layout from it: the stitched master (with any review slate burn-in
 * masked out of the nadir), plus nine VIRTUAL camera views re-projected from
 * the equirect with ffmpeg v360 at each Mercy01 camera's yaw/pitch — honest
 * reframes of the stitched world, so the site's 9-grid player works normally.
 *
 * First (and so far only) use: A001_A003 — DTLA Figueroa St, golden hour,
 * 16 s, delivered as 16K EXR master + graded 4K Rec709 review MOV.
 */

const SRC =
  process.argv[2] ||
  "/Users/andrewroberts/Projects/the_plate_lab/A001A033/A001A003_stitch_v01_4k_REC709_MP4.mov";
const SLUG = process.argv[3] || "dtla-figueroa";

/** Mercy01 camera angles (matches import-real.ts / the calibration). */
const CAMERA_ANGLES: Record<CameraId, { yaw: number; pitch: number; sky: boolean }> = {
  A: { yaw: 0, pitch: 10, sky: false },
  B: { yaw: 59.6, pitch: 10, sky: false },
  C: { yaw: 120.8, pitch: 10, sky: false },
  D: { yaw: 179.7, pitch: 10, sky: false },
  E: { yaw: -120.8, pitch: 10, sky: false },
  F: { yaw: -59.7, pitch: 10, sky: false },
  G: { yaw: 0.4, pitch: 52, sky: true },
  H: { yaw: 125.5, pitch: 52, sky: true },
  J: { yaw: -117.5, pitch: 52, sky: true },
};

const META = {
  shootDate: "2024-08-05",
  rig: "Mercy01",
  timecode: "00:01:07:00",
  location: {
    name: "Figueroa St — Financial District",
    city: "Los Angeles",
    region: "CA",
    country: "USA",
  },
  timeOfDay: "dusk",
  weather: "clear",
  season: "summer",
  shotType: "urban",
  stageCompat: ["led-volume", "green-screen", "projection"],
  sceneHints: [
    "skyscrapers",
    "glass towers",
    "intersection",
    "crosswalk",
    "traffic lights",
    "city bus",
    "palm trees",
    "american flag",
  ],
  colorState: "graded",
};

function writeTelemetry(file: string, durationSec: number): void {
  // Figueroa St heading southwest through the financial district, city speeds.
  const samples = [];
  let lat = 34.0512;
  let lon = -118.2552;
  const headingRad = (205 * Math.PI) / 180;
  for (let t = 0; t <= Math.max(2, Math.round(durationSec)); t++) {
    const speedMph = Math.max(0, 17 + 4 * Math.sin(t / 5) + 1.5 * Math.sin(t * 1.1));
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
        imu: { collected: false },
        samples,
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`source not found: ${SRC}`);
  const dropDir = path.join(DROPS_DIR, SLUG);
  fs.rmSync(dropDir, { recursive: true, force: true });
  fs.mkdirSync(dropDir, { recursive: true });

  // 1. Masked stitched master: cover the review slate burned into the nadir
  //    black band (frame counter + source TC), keep everything else intact.
  console.log("masking slate + writing stitched.mov…");
  const stitched = path.join(dropDir, "stitched.mov");
  await run("ffmpeg", [
    "-v", "error", "-i", SRC,
    "-vf",
    "drawbox=y=1300:h=748:t=fill:color=black," +
      "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
    "-c:v", "libx264", "-crf", "12", "-preset", "medium",
    "-pix_fmt", "yuv420p", "-an", "-y", stitched,
  ]);

  // 2. Virtual camera reframes via v360 (equirect -> rectilinear per camera).
  for (const id of CAMERA_IDS) {
    const a = CAMERA_ANGLES[id];
    const fov = a.sky ? "h_fov=102.8:v_fov=66.9" : "h_fov=86.5:v_fov=52.7";
    console.log(`reframing cam ${id} (yaw ${a.yaw}, pitch ${a.pitch})…`);
    await run("ffmpeg", [
      "-v", "error", "-i", stitched,
      "-vf",
      `v360=e:flat:${fov}:yaw=${a.yaw}:pitch=${a.pitch}:w=1024:h=576,` +
        "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited",
      "-c:v", "libx264", "-crf", "16", "-preset", "medium",
      "-pix_fmt", "yuv420p", "-an", "-y",
      path.join(dropDir, `cam_${id}.mov`),
    ]);
  }

  // 3. Sidecars.
  const { ffprobeJson } = await import("../exec.js");
  const probed = await ffprobeJson(stitched);
  const durationSec = Number(probed.format?.duration ?? 16);
  writeTelemetry(path.join(dropDir, "telemetry.json"), durationSec);
  fs.writeFileSync(path.join(dropDir, "meta.json"), JSON.stringify(META, null, 2));

  console.log(`✓ ${SLUG} ready (${Math.round(durationSec)}s pro-stitched drop) at ${dropDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
