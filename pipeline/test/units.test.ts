import test from "node:test";
import assert from "node:assert/strict";
import {
  priceForDuration,
  speedBandForAvg,
} from "@platelab/shared";
import { signScreenerAccess, verifyScreenerAccess } from "../src/sign.js";
import { summarizeTelemetry } from "../src/stages/telemetry.js";

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
