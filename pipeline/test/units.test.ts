import test from "node:test";
import assert from "node:assert/strict";
import {
  priceForDuration,
  speedBandForAvg,
  plateSchema,
  catalogDatabaseRecordForPlate,
} from "@platelab/shared";
import { signScreenerAccess, verifyScreenerAccess } from "../src/sign.js";
import {
  normalizeLegacyXlTelemetry,
  summarizeTelemetry,
} from "../src/stages/telemetry.js";

test("pricing: $8k/min, 1-minute minimum, prorated after", () => {
  assert.equal(priceForDuration(10), 8000); // under minimum
  assert.equal(priceForDuration(60), 8000);
  assert.equal(priceForDuration(90), 12000);
  assert.equal(priceForDuration(121), Math.round((121 / 60) * 8000));
  assert.throws(() => priceForDuration(0));
});

test("speed bands", () => {
  assert.equal(speedBandForAvg(1), "stopped");
  assert.equal(speedBandForAvg(20), "city");
  assert.equal(speedBandForAvg(45), "highway");
  assert.equal(speedBandForAvg(75), "fast");
});

test("screener signing round-trip and expiry", () => {
  const access = signScreenerAccess("secret", "PL26161-0001", 600, 1000);
  assert.equal(verifyScreenerAccess("secret", access, 1100), true);
  assert.equal(verifyScreenerAccess("secret", access, 1700), false); // expired
  assert.equal(verifyScreenerAccess("wrong", access, 1100), false);
  assert.equal(
    verifyScreenerAccess("secret", { ...access, sku: "PL26161-0002" }, 1100),
    false,
  );
});

test("telemetry summarization", () => {
  const summary = summarizeTelemetry({
    source: "u-blox F9R RTK",
    imu: { collected: true, source: "F9R ESF-INS", rateHz: 100 },
    samples: [
      { t: 0, lat: 40.0, lon: -74.0, speedMph: 30 },
      { t: 1, lat: 40.001, lon: -74.0, speedMph: 40 },
      { t: 2, lat: 40.002, lon: -74.0, speedMph: 50 },
    ],
  });
  assert.equal(summary.gps.avgSpeedMph, 40);
  assert.equal(summary.gps.maxSpeedMph, 50);
  assert.equal(summary.speedBand, "highway");
  assert.equal(summary.gps.path.length, 3);
  assert.deepEqual(summary.gps.end, { lat: 40.002, lon: -74.0 });
});

test("Legacy XL telemetry collapses repeated fixes and rejects GPS speed spikes", () => {
  const gps = [
    [0, "00", 34, -118],
    [12, "00", 34, -118],
    [24, "01", 34.0001, -118],
    [48, "02", 34.0002, -118],
    [72, "03", 35, -117], // impossible one-second jump
    [96, "04", 34.0004, -118],
    [120, "05", 34.0005, -118],
  ].map(([tc_frames, second, latitude, longitude]) => ({
    tc_frames,
    host_wall_clock: `2024-01-04T12:00:${second}Z`,
    latitude,
    longitude,
  }));
  const normalized = normalizeLegacyXlTelemetry({
    schema: "spheris.telemetry.gps_imu.v1",
    source: { kind: "legacy_xl" },
    availability: { gps_available: true, imu_available: true },
    take: { start_frame: 0, end_frame: 120 },
    samples: { gps, imu: [{ tc_frames: 0 }, { tc_frames: 1 }] },
  });
  assert.equal(normalized.samples.length, 6);
  assert.equal(normalized.imu.collected, true);
  assert.ok(Math.max(...normalized.samples.map((sample) => sample.speedMph)) < 120);
});

test("plate schema v2: opaque sku, status default, mmm block, optional gps", () => {
  const base = {
    sku: "PL-4839208",
    title: "t", description: "d", shootDate: "2026-07-08", rig: "Mercy01",
    media: { durationSec: 10, fps: 23.98, stitchedResolution: "3840x1920",
      colorPipeline: "c", masterFormat: "m", cameraOriginals: "o" },
    shotType: "urban", timeOfDay: "day", weather: "clear", season: "summer",
    tags: [], objects: [],
    location: { name: "n", city: "c", region: "r", country: "US" },
    imu: { collected: false },
    stageCompat: ["led-volume"], availability: "available",
    pricing: { perMinuteUsd: 8000, totalUsd: 8000, minimumMinutes: 1 },
    renditions: {
      stitchedPreview: "/m/s.mp4",
      stagePreview: "/m/stage.mp4",
      cameraPreviews: {},
      poster: "/m/p.jpg",
    },
    security: { masterSha256: "a".repeat(64), watermarked: true },
    ingestedAt: "2026-07-08T00:00:00Z",
  };
  const parsed = plateSchema.parse({ ...base, mmm: { stockClipId: "SPH-STK-20260708-GLENDORA-001-CLIP-0001" } });
  assert.equal(parsed.status, "live"); // default for legacy entries
  assert.equal(parsed.mmm?.stockClipId.startsWith("SPH-STK"), true);
  assert.equal(parsed.gps, undefined); // gps now optional
  const databaseRecord = catalogDatabaseRecordForPlate(parsed, "test-v1");
  const stageAsset = databaseRecord.assets.find(
    (asset) => asset.kind === "lab_preview",
  );
  assert.equal(stageAsset?.public_url, "/m/stage.mp4");
  assert.deepEqual(stageAsset?.metadata, {
    projection: "equirectangular",
    coverage: "full-sphere",
    purpose: "led-volume-previs",
  });
  assert.throws(() => plateSchema.parse({ ...base, sku: "PL26161-0042" }));
  assert.throws(() => plateSchema.parse({ ...base, sku: "PL-4839207" })); // bad check digit is format-valid; regex passes — see refine
});
