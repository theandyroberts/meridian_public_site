import { z } from "zod";

/**
 * The Plate Lab catalog schema.
 *
 * One catalog.json is the contract between the ingest pipeline (producer)
 * and the public site (consumer). Original media paths must never appear
 * here — only watermarked renditions that are safe to serve publicly.
 */

export const SHOT_TYPES = [
  "highway",
  "urban",
  "residential",
  "tunnel",
  "bridge",
  "coastal",
  "rural",
] as const;

export const TIMES_OF_DAY = ["dawn", "day", "dusk", "night"] as const;

export const WEATHER = ["clear", "cloudy", "rain", "fog", "snow"] as const;

export const SEASONS = ["spring", "summer", "fall", "winter"] as const;

export const SPEED_BANDS = ["stopped", "city", "highway", "fast"] as const;

export const STAGE_COMPAT = ["led-volume", "green-screen", "projection"] as const;

export const AVAILABILITY = [
  "available",
  "reserved",
  "licensed",
  "exclusive-sold",
] as const;

/** Drew's 9-grid display order: sky tier top, front ring middle, back ring bottom. */
export const GRID_ORDER = ["J", "G", "H", "F", "A", "B", "C", "D", "E"] as const;

export const CAMERA_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "J"] as const;
export type CameraId = (typeof CAMERA_IDS)[number];

export const CAMERA_POSITIONS: Record<CameraId, string> = {
  A: "front",
  B: "front right",
  C: "back right",
  D: "back",
  E: "back left",
  F: "front left",
  G: "sky front",
  H: "sky back right",
  J: "sky back left",
};

const latLon = z.object({ lat: z.number(), lon: z.number() });

export const gpsSchema = z.object({
  source: z.string(), // e.g. "u-blox F9R RTK"
  start: latLon,
  end: latLon,
  /** Simplified route, equal-time samples, for drawing — not survey data. */
  path: z.array(latLon).min(2),
  avgSpeedMph: z.number().nonnegative(),
  maxSpeedMph: z.number().nonnegative(),
});

export const imuSchema = z.object({
  collected: z.boolean(),
  source: z.string().optional(), // e.g. "F9R ESF-INS"
  rateHz: z.number().positive().optional(),
});

export const objectLabelSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
});

export const renditionsSchema = z.object({
  /** Watermarked equirect preview MP4, the master clock in the player. */
  stitchedPreview: z.string(),
  /** Watermarked per-camera preview MP4s, keyed by camera id. */
  cameraPreviews: z.record(z.enum(CAMERA_IDS), z.string()),
  poster: z.string(),
});

export const plateSchema = z.object({
  sku: z.string().regex(/^PL\d{5}-\d{4}$/),
  title: z.string().min(1),
  description: z.string().min(1),
  shootDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rig: z.string(), // e.g. "Mercy01"

  media: z.object({
    durationSec: z.number().positive(),
    fps: z.number().positive(), // 23.98
    stitchedResolution: z.string(), // "3840x1920"
    colorPipeline: z.string(), // "Log3G10 / REDWideGamutRGB"
    masterFormat: z.string(), // "ProRes 4444 12-bit equirect"
    cameraOriginals: z.string(), // "9x RED Komodo 6K R3D"
    timecode: z.string().optional(),
  }),

  shotType: z.enum(SHOT_TYPES),
  timeOfDay: z.enum(TIMES_OF_DAY),
  weather: z.enum(WEATHER),
  season: z.enum(SEASONS),
  speedBand: z.enum(SPEED_BANDS),
  tags: z.array(z.string()),
  objects: z.array(objectLabelSchema),

  location: z.object({
    name: z.string(), // "FDR Drive, New York, NY"
    city: z.string(),
    region: z.string(),
    country: z.string(),
  }),
  gps: gpsSchema,
  imu: imuSchema,

  stageCompat: z.array(z.enum(STAGE_COMPAT)),
  availability: z.enum(AVAILABILITY),

  pricing: z.object({
    perMinuteUsd: z.number().positive(),
    totalUsd: z.number().positive(),
    minimumMinutes: z.number().positive(),
  }),

  renditions: renditionsSchema,

  security: z.object({
    /** sha256 of the original stitched master, for chain of custody. */
    masterSha256: z.string().regex(/^[0-9a-f]{64}$/),
    watermarked: z.literal(true),
  }),

  ingestedAt: z.string(), // ISO timestamp
});

export const catalogSchema = z.object({
  generatedAt: z.string(),
  plates: z.array(plateSchema),
});

export type Gps = z.infer<typeof gpsSchema>;
export type Imu = z.infer<typeof imuSchema>;
export type ObjectLabel = z.infer<typeof objectLabelSchema>;
export type Plate = z.infer<typeof plateSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type ShotType = (typeof SHOT_TYPES)[number];
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export type SpeedBand = (typeof SPEED_BANDS)[number];

export function speedBandForAvg(avgMph: number): SpeedBand {
  if (avgMph < 3) return "stopped";
  if (avgMph < 35) return "city";
  if (avgMph < 60) return "highway";
  return "fast";
}
