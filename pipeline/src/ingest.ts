import path from "node:path";
import {
  priceForDuration,
  PER_MINUTE_USD,
  MINIMUM_MINUTES,
  type Plate,
  type PlateStatus,
} from "@platelab/shared";
import { audit } from "./audit.js";
import { PUBLIC_MEDIA } from "./paths.js";
import { discover, type Drop } from "./stages/discover.js";
import { probe } from "./stages/probe.js";
import { sha256File } from "./stages/checksum.js";
import { loadTelemetry } from "./stages/telemetry.js";
import { labelDrop } from "./stages/label.js";
import { describePlate } from "./stages/describe.js";
import { buildRenditions } from "./stages/renditions.js";
import { uploadRenditions } from "./stages/upload.js";
import { publishPlate } from "./stages/publish.js";
import { assignSku } from "./mmm/skuLedger.js";

export interface IngestOpts {
  sku?: string;
  status?: PlateStatus;
  stockClipId?: string;
}

export async function ingestDrop(dropDir: string, opts: IngestOpts = {}): Promise<Plate> {
  return ingestDiscovered(discover(dropDir), opts);
}

/**
 * Ingest one discovered drop end to end. Stages are sequential and each is
 * audited; a failure leaves the catalog untouched (publish is last + atomic).
 */
export async function ingestDiscovered(drop: Drop, opts: IngestOpts = {}): Promise<Plate> {
  const t0 = Date.now();
  audit("ingest.start", { dropDir: drop.dir });

  const masterFile = drop.stitchedMaster ?? drop.cameraFiles.A;
  if (!masterFile) throw new Error(`${drop.dir}: no master (stitched or cam A)`);
  const probed = await probe(masterFile);
  audit("ingest.probe", { dropDir: drop.dir, ...probed });

  const sku = opts.sku ?? assignSku();
  const status = opts.status ?? "live";
  audit("ingest.sku", { dropDir: drop.dir, sku, status });

  const masterSha256 = await sha256File(masterFile);
  audit("ingest.checksum", { sku, masterSha256 });

  const telemetry = drop.telemetryPath ? loadTelemetry(drop.telemetryPath) : undefined;
  const labels = await labelDrop(masterFile, probed.durationSec, drop.meta);
  audit("ingest.label", { sku, labeler: labels.labeler, count: labels.objects.length });

  const described = await describePlate(
    drop.meta,
    labels,
    telemetry ?? { gps: undefined, imu: { collected: false }, speedBand: undefined },
    probed.durationSec,
  );
  audit("ingest.describe", { sku, describer: described.describer });

  const renditions = await buildRenditions(drop, sku, path.join(PUBLIC_MEDIA, sku));
  const uploaded = await uploadRenditions(sku, renditions, [
    ...(drop.stitchedMaster ? [drop.stitchedMaster] : []),
    ...Object.values(drop.cameraFiles).filter((f): f is string => !!f),
  ]);
  audit("ingest.upload", { sku, mode: uploaded.mode });

  const plate: Plate = {
    sku,
    status,
    ...(opts.stockClipId ? { mmm: { stockClipId: opts.stockClipId } } : {}),
    title: described.title,
    description: described.description,
    shootDate: drop.meta.shootDate,
    rig: drop.meta.rig,
    media: {
      durationSec: Math.round(probed.durationSec * 100) / 100,
      fps: probed.fps,
      stitchedResolution: "3840x1920",
      colorPipeline: "Log3G10 / REDWideGamutRGB",
      masterFormat: drop.stitchedMaster
        ? "ProRes 4444 12-bit equirect"
        : "ProRes 4444 12-bit equirect · pro stitch on delivery",
      cameraOriginals: "9x RED Komodo 6K R3D",
      timecode: drop.meta.timecode,
    },
    shotType: drop.meta.shotType,
    timeOfDay: drop.meta.timeOfDay,
    weather: drop.meta.weather,
    season: drop.meta.season,
    ...(telemetry ? { speedBand: telemetry.speedBand, gps: telemetry.gps } : {}),
    tags: labels.tags,
    objects: labels.objects,
    location: drop.meta.location,
    imu: telemetry ? telemetry.imu : { collected: false },
    stageCompat: drop.meta.stageCompat,
    availability: "available",
    pricing: {
      perMinuteUsd: PER_MINUTE_USD,
      totalUsd: priceForDuration(probed.durationSec),
      minimumMinutes: MINIMUM_MINUTES,
    },
    renditions: {
      stitchedPreview: uploaded.stitchedPreviewUrl,
      cameraPreviews: uploaded.cameraPreviewUrls,
      poster: uploaded.posterUrl,
    },
    security: { masterSha256, watermarked: true },
    ingestedAt: new Date().toISOString(),
  };

  publishPlate(plate);
  audit("ingest.done", { sku, ms: Date.now() - t0 });
  return plate;
}
