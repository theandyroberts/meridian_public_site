import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeHandoff } from "./helpers/makeHandoff.js";
import { verifyHandoff, HandoffVerifyError } from "../src/mmm/verify.js";
import { adaptClip, ClipAdaptError } from "../src/mmm/adapter.js";

const CLIP = "SPH-STK-20260708-GLENDORA-001-CLIP-0001";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tpl-handoff-"));

test("verify: valid handoff passes; corrupted asset fails with checksum code", async () => {
  const root = tmp();
  await makeHandoff(root, { clips: [{ stockClipId: CLIP }] });
  const manifest = await verifyHandoff(root);
  assert.equal(manifest.clip_count, 1);

  // Corrupt one asset → checksum failure
  const asset = manifest.clips[0].assets[0];
  fs.appendFileSync(path.join(root, asset.package_relative_path), "corrupt");
  await assert.rejects(verifyHandoff(root), (e: HandoffVerifyError) => e.code === "checksum");
});

test("adapt: nine feeds → full drop with A..J mapping and synthesized meta", async () => {
  const root = tmp();
  await makeHandoff(root, { clips: [{ stockClipId: CLIP }] });
  const manifest = await verifyHandoff(root);
  const { drop, stockClipId } = adaptClip(root, manifest.clips[0]);
  assert.equal(stockClipId, CLIP);
  assert.equal(Object.keys(drop.cameraFiles).length, 9);
  assert.ok(drop.cameraFiles.A!.endsWith("_captured_camera_feed_01.mp4"));
  assert.ok(drop.cameraFiles.J!.endsWith("_captured_camera_feed_09.mp4"));
  assert.equal(drop.meta.shootDate, "2026-07-08");
  assert.equal(drop.meta.season, "summer");
  assert.equal(drop.meta.location.city, "Glendora");
  assert.deepEqual(drop.meta.sceneHints, ["KEEP", "Great Location", "bridge at dawn"]);
});

test("adapt: live stitch → stitched-only drop; grid/unavailable rejected", async () => {
  const root = tmp();
  await makeHandoff(root, { clips: [
    { stockClipId: CLIP, assetType: "captured_live_stitch" },
    { stockClipId: CLIP.replace("0001", "0002"), assetType: "captured_nine_grid" },
    { stockClipId: CLIP.replace("0001", "0003"), assetType: "unavailable" },
  ]});
  const manifest = await verifyHandoff(root);
  const adapted = adaptClip(root, manifest.clips[0]);
  assert.ok(adapted.drop.stitchedMaster);
  assert.deepEqual(adapted.drop.cameraFiles, {});
  assert.throws(() => adaptClip(root, manifest.clips[1]),
    (e: ClipAdaptError) => e.stage === "unsupported_asset_type");
  assert.throws(() => adaptClip(root, manifest.clips[2]),
    (e: ClipAdaptError) => e.stage === "no_publishable_asset");
});
