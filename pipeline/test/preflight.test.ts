import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { preflightDrop } from "../src/preflight.js";
import { isFullSphere } from "../src/stages/master.js";

const META = {
  shootDate: "2026-08-08",
  rig: "LEGACY_XL",
  location: { name: "6th Street", city: "Los Angeles", region: "CA", country: "US" },
  timeOfDay: "day",
  weather: "clear",
  season: "summer",
  shotType: "bridge",
  stageCompat: ["led-volume"],
  sceneHints: [],
};

function tinyVideo(file: string, size = "160x80"): void {
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y", "-f", "lavfi", "-i",
    `testsrc=size=${size}:rate=12:duration=1`, "-pix_fmt", "yuv420p", file,
  ]);
}

test("isFullSphere accepts 2:1 equirectangular media and rejects camera-shaped media", () => {
  assert.equal(isFullSphere({ width: 3840, height: 1920 }), true);
  assert.equal(isFullSphere({ width: 1920, height: 1080 }), false);
});

test("preflight blocks a legacy nine-camera drop without an explicit calibration", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-not-used";
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-preflight-"));
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ ...META, trustedStitchedMaster: true }));
    for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "J"]) {
      tinyVideo(path.join(dir, `cam_${id}.mp4`));
    }
    const result = await preflightDrop(dir);
    assert.equal(result.ready, false);
    assert.match(result.checks.find((check) => check.check === "calibration")!.detail, /no calibration registered/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("preflight accepts the solved GA DTLA Legacy XL v2 calibration", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-not-used";
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-preflight-"));
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({
        ...META,
        calibrationProfile: "legacy-xl-ga-dtla-2024-v2",
      }),
    );
    for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "J"]) {
      tinyVideo(path.join(dir, `cam_${id}.mp4`));
    }
    const result = await preflightDrop(dir);
    assert.equal(result.ready, true);
    assert.match(
      result.checks.find((check) => check.check === "calibration")!.detail,
      /legacy-xl-ga-dtla-2024-v2 \(metadata\)/,
    );
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("preflight accepts a supplied 2:1 full-sphere master without a rig calibration", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-not-used";
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-preflight-"));
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ ...META, trustedStitchedMaster: true }),
    );
    tinyVideo(path.join(dir, "stitched.mp4"));
    const result = await preflightDrop(dir);
    assert.equal(result.ready, true);
    assert.match(result.checks.find((check) => check.check === "supplied master")!.detail, /verified 2:1 full sphere/);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
