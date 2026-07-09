import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discover } from "../src/stages/discover.js";

const META = JSON.stringify({
  shootDate: "2026-07-08", rig: "Mercy01",
  location: { name: "n", city: "c", region: "r", country: "US" },
  timeOfDay: "day", weather: "clear", season: "summer", shotType: "urban",
  stageCompat: ["led-volume"], sceneHints: [],
});

function makeDir(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-drop-"));
  for (const f of files) fs.writeFileSync(path.join(dir, f), "x");
  fs.writeFileSync(path.join(dir, "meta.json"), META);
  return dir;
}

test("discover: stitched-only drop is accepted (no cameras, no telemetry)", () => {
  const dir = makeDir(["stitched.mov"]);
  const drop = discover(dir);
  assert.equal(drop.stitchedMaster, path.join(dir, "stitched.mov"));
  assert.deepEqual(drop.cameraFiles, {});
  assert.equal(drop.telemetryPath, undefined);
});

test("discover: no stitched master and missing cameras still throws", () => {
  const dir = makeDir(["cam_A.mov", "cam_B.mov"]);
  assert.throws(() => discover(dir), /missing cameras/);
});
