import { z } from "zod";
import { CAMERA_IDS, type CameraId } from "./catalog";

/**
 * MMM website handoff formats, fixed by spheris-smart-stitch-live PR #79
 * (MeridianWebsiteHandoffBuilder / MeridianStockWebsitePackage, snake_case
 * JSON encoders). TPL consumes these verbatim — never redefine them locally.
 */

export const ASSET_TYPES = [
  "captured_nine_camera_feeds",
  "rebuilt_nine_camera_proxies",
  "captured_live_stitch",
  "captured_nine_grid",
  "unavailable",
] as const;

export const GPS_IMU_STATES = [
  "gps_imu_available", "gps_imu_missing", "gps_imu_needs_review",
  "gps_only_available", "imu_only_available",
] as const;

/** MLS camera number (1–9) → Spheris array position letter. */
export const CAMERA_NUMBER_TO_POSITION: Record<number, CameraId> =
  Object.fromEntries(CAMERA_IDS.map((id, i) => [i + 1, id])) as Record<number, CameraId>;

const packageAssetSchema = z.object({
  role: z.string(),
  path: z.string(),
  camera_number: z.number().int().min(1).max(9).nullish(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  checksum_verified: z.boolean(),
});

const sourceTakeSchema = z.object({
  mode: z.string(),
  stock_job_id: z.string().nullish(),
  roll_number: z.number().int().nullish(),
  clip_number: z.number().int().nullish(),
  source_folder_name: z.string(),
  timecode_in: z.string().nullish(),
  timecode_out: z.string().nullish(),
  clip_count: z.number().int().nullish(),
  duration_seconds: z.number(),
  raw_ready_for_repackage: z.boolean(),
  raw_issue_kinds: z.array(z.string()),
  live_asset_issue_kinds: z.array(z.string()),
});

export const websitePackageSchema = z.object({
  schema: z.literal("spheris.stock.website_package.v1"),
  stock_clip_id: z.string().min(1),
  selected_publish_asset_type: z.enum(ASSET_TYPES),
  assets: z.array(packageAssetSchema),
  gps_imu_availability: z.enum(GPS_IMU_STATES),
  operator_tags: z.array(z.string()),
  operator_notes: z.string(),
  fallback_reason: z.string().nullish(),
  source_take: sourceTakeSchema,
});

const handoffAssetSchema = z.object({
  role: z.string(),
  camera_number: z.number().int().min(1).max(9).nullish(),
  source_path: z.string(),
  package_relative_path: z.string(),
  package_path: z.string(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  checksum_verified: z.boolean(),
});

const handoffClipSchema = z.object({
  stock_clip_id: z.string().min(1),
  source_folder_name: z.string(),
  clip_package_relative_path: z.string(),
  clip_package_path: z.string(),
  metadata_json_file_name: z.string(),
  metadata_relative_path: z.string(),
  metadata_path: z.string(),
  selected_publish_asset_type: z.enum(ASSET_TYPES),
  gps_imu_availability: z.enum(GPS_IMU_STATES),
  fallback_reason: z.string().nullish(),
  metadata: websitePackageSchema,
  assets: z.array(handoffAssetSchema),
});

export const handoffManifestSchema = z.object({
  schema: z.literal("spheris.stock.website_handoff.v1"),
  handoff_root_path: z.string(),
  clips_root_relative_path: z.string(),
  clips_root_path: z.string(),
  clip_count: z.number().int().nonnegative(),
  excluded_clip_count: z.number().int().nonnegative(),
  clips: z.array(handoffClipSchema),
  excluded_clips: z.array(z.object({
    stock_clip_id: z.string(),
    source_folder_name: z.string(),
    reason: z.enum(["culled", "undecided", "missing_stock_review"]),
    detail: z.string(),
  })),
});

export type WebsitePackage = z.infer<typeof websitePackageSchema>;
export type HandoffManifest = z.infer<typeof handoffManifestSchema>;
export type HandoffClip = z.infer<typeof handoffClipSchema>;
export type HandoffAssetType = (typeof ASSET_TYPES)[number];
