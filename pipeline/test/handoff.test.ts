import test from "node:test";
import assert from "node:assert/strict";
import {
  handoffManifestSchema,
  websitePackageSchema,
  CAMERA_NUMBER_TO_POSITION,
} from "@platelab/shared";

const CLIP_META = {
  schema: "spheris.stock.website_package.v1",
  stock_clip_id: "SPH-STK-20260708-GLENDORA-001-CLIP-0001",
  selected_publish_asset_type: "captured_nine_camera_feeds",
  assets: [
    { role: "captured_camera_feed_01", path: "/src/a.mov", camera_number: 1,
      checksum_sha256: "a".repeat(64), checksum_verified: true },
  ],
  gps_imu_availability: "gps_imu_missing",
  operator_tags: ["KEEP"],
  operator_notes: "",
  fallback_reason: null,
  source_take: {
    mode: "stock", stock_job_id: "SPH-STK-20260708-GLENDORA-001",
    roll_number: 7, clip_number: 48, source_folder_name: "Roll_007_Clip_048",
    timecode_in: "14:32:10:00", timecode_out: "14:34:18:00", clip_count: 3072,
    duration_seconds: 128, raw_ready_for_repackage: true,
    raw_issue_kinds: [], live_asset_issue_kinds: [],
  },
};

test("website package schema parses PR#79 shape", () => {
  const p = websitePackageSchema.parse(CLIP_META);
  assert.equal(p.stock_clip_id, CLIP_META.stock_clip_id);
  assert.throws(() => websitePackageSchema.parse({ ...CLIP_META, schema: "wrong.v9" }));
});

test("handoff manifest parses and camera map is the array topology", () => {
  const m = handoffManifestSchema.parse({
    schema: "spheris.stock.website_handoff.v1",
    handoff_root_path: "/x", clips_root_relative_path: "clips", clips_root_path: "/x/clips",
    clip_count: 1, excluded_clip_count: 1,
    clips: [{
      stock_clip_id: CLIP_META.stock_clip_id, source_folder_name: "Roll_007_Clip_048",
      clip_package_relative_path: "clips/SPH-STK-20260708-GLENDORA-001-CLIP-0001",
      clip_package_path: "/x/clips/SPH-STK-20260708-GLENDORA-001-CLIP-0001",
      metadata_json_file_name: "SPH-STK-20260708-GLENDORA-001-CLIP-0001.website.json",
      metadata_relative_path: "clips/SPH-STK-20260708-GLENDORA-001-CLIP-0001/metadata/SPH-STK-20260708-GLENDORA-001-CLIP-0001.website.json",
      metadata_path: "/x/clips/…/metadata/….website.json",
      selected_publish_asset_type: "captured_nine_camera_feeds",
      gps_imu_availability: "gps_imu_missing", fallback_reason: null,
      metadata: CLIP_META,
      assets: [{ role: "captured_camera_feed_01", camera_number: 1,
        source_path: "/src/a.mov",
        package_relative_path: "clips/…/assets/…__01_captured_camera_feed_01.mov",
        package_path: "/x/clips/…", checksum_sha256: "a".repeat(64), checksum_verified: true }],
    }],
    excluded_clips: [{ stock_clip_id: "SPH-…-CLIP-0002", source_folder_name: "Roll_007_Clip_049",
      reason: "culled", detail: "cull" }],
  });
  assert.equal(m.clips.length, 1);
  assert.equal(CAMERA_NUMBER_TO_POSITION[1], "A");
  assert.equal(CAMERA_NUMBER_TO_POSITION[9], "J");
});
