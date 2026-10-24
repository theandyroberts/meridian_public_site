import path from "node:path";
import {
  CAMERA_NUMBER_TO_POSITION,
  type HandoffClip,
  type CameraId,
} from "@platelab/shared";
import type { Drop } from "../stages/discover.js";
import type { DropMeta } from "../stages/discover.js";

export class ClipAdaptError extends Error {
  constructor(public stage: "unsupported_asset_type" | "no_publishable_asset", message: string) {
    super(message);
  }
}

const SEASONS_BY_MONTH = ["winter","winter","spring","spring","spring","summer",
  "summer","summer","fall","fall","fall","winter"] as const;

const LEGACY_GA_DTLA_CALIBRATION = "legacy-xl-ga-dtla-2024-v2";

function isLegacyGaDtlaClip(stockClipId: string): boolean {
  return /^SPH-STK-LEGACY-\d{8}-GA-DTLA-/i.test(stockClipId);
}

function titleCase(slug: string): string {
  return slug.replace(/-/g, " ").toLowerCase().replace(/(^|\s)\w/g, (m) => m.toUpperCase());
}

/** SPH-STK-YYYYMMDD-LOCATION-###-CLIP-#### → { shootDate, locationSlug } */
function parseStockClipId(id: string): { shootDate: string; locationSlug: string } {
  const m = /^SPH-STK-(\d{4})(\d{2})(\d{2})-(.+)-\d{3}-CLIP-\d+/i.exec(id);
  if (!m) return { shootDate: "1970-01-01", locationSlug: "Unknown" };
  return { shootDate: `${m[1]}-${m[2]}-${m[3]}`, locationSlug: titleCase(m[4]) };
}

/**
 * Translate one MMM handoff clip into the pipeline's Drop shape. Synthesized
 * meta fields are best-effort defaults — the AI labeling stage refines from
 * frames, and the draft gate is the human backstop before anything goes live.
 */
export function adaptClip(rootDir: string, clip: HandoffClip): { drop: Drop; stockClipId: string } {
  const type = clip.selected_publish_asset_type;
  if (type === "captured_nine_grid") {
    throw new ClipAdaptError("unsupported_asset_type",
      `nine-grid fallback is not ingestible in v1 (${clip.fallback_reason ?? "no reason given"})`);
  }
  if (type === "unavailable") {
    throw new ClipAdaptError("no_publishable_asset", clip.fallback_reason ?? "no publishable asset");
  }

  const cameraFiles: Partial<Record<CameraId, string>> = {};
  let stitchedMaster: string | undefined;
  for (const asset of clip.assets) {
    const abs = path.join(rootDir, asset.package_relative_path);
    // Some handoffs include a live full-sphere reference alongside the nine
    // source feeds. Keep it: master preparation will verify its 2:1 geometry
    // and otherwise fall back to the calibrated cameras.
    if (type === "captured_live_stitch" || asset.role === "captured_live_stitch") {
      stitchedMaster = abs;
      continue;
    }
    if (asset.camera_number != null) {
      cameraFiles[CAMERA_NUMBER_TO_POSITION[asset.camera_number]] = abs;
    }
  }

  const { shootDate, locationSlug } = parseStockClipId(clip.stock_clip_id);
  const month = Number(shootDate.slice(5, 7)) - 1;
  const legacyGaDtla = isLegacyGaDtlaClip(clip.stock_clip_id);
  const meta: DropMeta = {
    shootDate,
    rig: legacyGaDtla ? "Legacy XL" : "Spheris XL 01",
    location: { name: locationSlug, city: locationSlug, region: "—", country: "US" },
    timeOfDay: "day",
    weather: "clear",
    season: SEASONS_BY_MONTH[month] ?? "summer",
    shotType: "urban",
    stageCompat: ["led-volume", "green-screen", "projection"],
    colorState: "log",
    ...(legacyGaDtla ? { calibrationProfile: LEGACY_GA_DTLA_CALIBRATION } : {}),
    trustedStitchedMaster: false,
    sceneHints: [
      ...clip.metadata.operator_tags,
      ...(clip.metadata.operator_notes ? [clip.metadata.operator_notes] : []),
    ],
  };

  return {
    stockClipId: clip.stock_clip_id,
    drop: {
      dir: path.join(rootDir, clip.clip_package_relative_path),
      stitchedMaster,
      cameraFiles,
      telemetryPath: undefined, // MMM telemetry export not shipped yet (spec: flagged to MMM)
      meta,
    },
  };
}
