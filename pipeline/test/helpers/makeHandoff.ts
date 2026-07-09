import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import type { HandoffAssetType } from "@platelab/shared";

const exec = promisify(execFile);

async function tinyVideo(dest: string, seconds: number): Promise<void> {
  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc=size=160x80:rate=12:duration=${seconds}`,
    "-pix_fmt", "yuv420p", dest]);
}

const sha256 = (p: string) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

export async function makeHandoff(
  rootDir: string,
  opts: { clips: Array<{ stockClipId: string; assetType?: HandoffAssetType; seconds?: number }> },
): Promise<void> {
  const clips = [];
  for (const c of opts.clips) {
    const assetType = c.assetType ?? "captured_nine_camera_feeds";
    const token = c.stockClipId.replace(/[^A-Za-z0-9_-]/g, "_");
    const clipRel = path.join("clips", token);
    const assetsDir = path.join(rootDir, clipRel, "assets");
    const metaDir = path.join(rootDir, clipRel, "metadata");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(metaDir, { recursive: true });

    const assets = [];
    if (assetType === "captured_nine_camera_feeds" || assetType === "rebuilt_nine_camera_proxies") {
      const prefix = assetType === "captured_nine_camera_feeds" ? "captured_camera_feed" : "rebuilt_camera_proxy";
      for (let n = 1; n <= 9; n++) {
        const role = `${prefix}_${String(n).padStart(2, "0")}`;
        const rel = path.join(clipRel, "assets", `${token}__${String(n).padStart(2, "0")}_${role}.mp4`);
        await tinyVideo(path.join(rootDir, rel), c.seconds ?? 1);
        assets.push({ role, camera_number: n, source_path: `/mmm/${role}.mp4`,
          package_relative_path: rel, package_path: path.join(rootDir, rel),
          checksum_sha256: sha256(path.join(rootDir, rel)), checksum_verified: true });
      }
    } else if (assetType === "captured_live_stitch") {
      const rel = path.join(clipRel, "assets", `${token}__01_captured_live_stitch.mp4`);
      await tinyVideo(path.join(rootDir, rel), c.seconds ?? 1);
      assets.push({ role: "captured_live_stitch", camera_number: null, source_path: "/mmm/ls.mp4",
        package_relative_path: rel, package_path: path.join(rootDir, rel),
        checksum_sha256: sha256(path.join(rootDir, rel)), checksum_verified: true });
    } // captured_nine_grid / unavailable: no assets needed for tests

    const metadata = {
      schema: "spheris.stock.website_package.v1",
      stock_clip_id: c.stockClipId,
      selected_publish_asset_type: assetType,
      assets: assets.map((a) => ({ role: a.role, path: a.source_path, camera_number: a.camera_number,
        checksum_sha256: a.checksum_sha256, checksum_verified: a.checksum_verified })),
      gps_imu_availability: "gps_imu_missing",
      operator_tags: ["KEEP", "Great Location"],
      operator_notes: "bridge at dawn",
      fallback_reason: assetType === "captured_nine_camera_feeds" ? null : "fallback",
      source_take: { mode: "stock", stock_job_id: c.stockClipId.replace(/-CLIP-\d+$/, ""),
        roll_number: 7, clip_number: 48, source_folder_name: "Roll_007_Clip_048",
        timecode_in: null, timecode_out: null, clip_count: null,
        duration_seconds: c.seconds ?? 1, raw_ready_for_repackage: true,
        raw_issue_kinds: [], live_asset_issue_kinds: [] },
    };
    const metaFile = `${token}.website.json`;
    fs.writeFileSync(path.join(metaDir, metaFile), JSON.stringify(metadata, null, 2));

    clips.push({
      stock_clip_id: c.stockClipId, source_folder_name: "Roll_007_Clip_048",
      clip_package_relative_path: clipRel, clip_package_path: path.join(rootDir, clipRel),
      metadata_json_file_name: metaFile,
      metadata_relative_path: path.join(clipRel, "metadata", metaFile),
      metadata_path: path.join(rootDir, clipRel, "metadata", metaFile),
      selected_publish_asset_type: assetType,
      gps_imu_availability: "gps_imu_missing",
      fallback_reason: metadata.fallback_reason, metadata, assets,
    });
  }
  const manifest = {
    schema: "spheris.stock.website_handoff.v1",
    handoff_root_path: rootDir, clips_root_relative_path: "clips",
    clips_root_path: path.join(rootDir, "clips"),
    clip_count: clips.length, excluded_clip_count: 0, clips, excluded_clips: [],
  };
  fs.writeFileSync(path.join(rootDir, "website_handoff_manifest.json"), JSON.stringify(manifest, null, 2));
}
