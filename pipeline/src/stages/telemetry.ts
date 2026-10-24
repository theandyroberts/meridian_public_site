import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { speedBandForAvg, type Gps, type Imu, type SpeedBand } from "@platelab/shared";

/**
 * Telemetry sidecar exported from the capture system's u-blox F9R logger.
 * Samples are NAV-PVT-derived (position + ground speed); the imu block
 * reflects whether ESF-INS fused inertial data was recorded alongside.
 */
export const telemetrySchema = z.object({
  source: z.string().default("u-blox F9R RTK"),
  imu: z.object({
    collected: z.boolean(),
    source: z.string().optional(),
    rateHz: z.number().positive().optional(),
  }),
  samples: z
    .array(
      z.object({
        t: z.number(), // seconds from clip start
        lat: z.number(),
        lon: z.number(),
        speedMph: z.number().nonnegative(),
      }),
    )
    .min(2),
});

export type Telemetry = z.infer<typeof telemetrySchema>;

const legacyXlTelemetrySchema = z.object({
  schema: z.literal("spheris.telemetry.gps_imu.v1"),
  source: z.object({
    kind: z.string(),
  }),
  availability: z.object({
    gps_available: z.boolean(),
    imu_available: z.boolean(),
  }),
  take: z.object({
    start_frame: z.number().int(),
    end_frame: z.number().int(),
  }),
  samples: z.object({
    gps: z.array(z.object({
      host_wall_clock: z.string(),
      tc_frames: z.number().int(),
      latitude: z.number(),
      longitude: z.number(),
    })).min(2),
    imu: z.array(z.object({ tc_frames: z.number().int() })),
  }),
});

export interface TelemetrySummary {
  gps: Gps;
  imu: Imu;
  speedBand: SpeedBand;
}

/** Thin the path to ~maxPoints equal-time samples for catalog/drawing use. */
function simplify(samples: Telemetry["samples"], maxPoints = 64) {
  if (samples.length <= maxPoints) {
    return samples.map(({ lat, lon }) => ({ lat, lon }));
  }
  const step = (samples.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const { lat, lon } = samples[Math.round(i * step)];
    out.push({ lat, lon });
  }
  return out;
}

export function summarizeTelemetry(t: Telemetry): TelemetrySummary {
  const speeds = t.samples.map((s) => s.speedMph);
  const reportedAvg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  // Legacy speeds are derived from irregular Android fixes and median-smoothed
  // to suppress one-frame noise. Use distance over elapsed route time for the
  // physical average so variable fix intervals do not bias it downward.
  const elapsedHours =
    (t.samples[t.samples.length - 1].t - t.samples[0].t) / 3_600;
  const routeMiles = t.samples.slice(1).reduce(
    (total, sample, index) =>
      total +
      haversineMiles(
        {
          latitude: t.samples[index].lat,
          longitude: t.samples[index].lon,
        },
        { latitude: sample.lat, longitude: sample.lon },
      ),
    0,
  );
  const routeAvg = elapsedHours > 0 ? routeMiles / elapsedHours : Number.NaN;
  const avg =
    t.source === "Legacy XL Android LTC GPS" &&
    Number.isFinite(routeAvg) &&
    routeAvg <= 120
      ? routeAvg
      : reportedAvg;
  const max = Math.max(...speeds);
  const first = t.samples[0];
  const last = t.samples[t.samples.length - 1];

  return {
    gps: {
      source: t.source,
      start: { lat: first.lat, lon: first.lon },
      end: { lat: last.lat, lon: last.lon },
      path: simplify(t.samples),
      avgSpeedMph: Math.round(avg * 10) / 10,
      maxSpeedMph: Math.round(max * 10) / 10,
    },
    imu: t.imu,
    speedBand: speedBandForAvg(avg),
  };
}

export function loadTelemetry(file: string): TelemetrySummary {
  const document = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const standard = telemetrySchema.safeParse(document);
  const parsed = standard.success ? standard.data : normalizeLegacyXlTelemetry(document);
  return summarizeTelemetry(parsed);
}

function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3_958.7613;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

type LegacyGpsFix = z.infer<typeof legacyXlTelemetrySchema>["samples"]["gps"][number];

function legacySegmentSpeedMph(a: LegacyGpsFix, b: LegacyGpsFix): number {
  const hours = (b.tc_frames - a.tc_frames) / 24 / 3_600;
  return hours > 0 ? haversineMiles(a, b) / hours : Number.POSITIVE_INFINITY;
}

/**
 * Normalize recorder ordering and remove only isolated "jump out and back"
 * fixes. A point is discarded when both adjacent legs would require an
 * impossible road speed, while bypassing that single point is plausible.
 * This leaves sustained route changes intact and prevents map polylines from
 * drawing long spikes caused by one corrupted Android GPS sample.
 */
function cleanLegacyGpsFixes(samples: LegacyGpsFix[]): LegacyGpsFix[] {
  const byFrame = new Map<number, LegacyGpsFix[]>();
  for (const sample of samples) {
    const group = byFrame.get(sample.tc_frames) ?? [];
    group.push(sample);
    byFrame.set(sample.tc_frames, group);
  }
  let fixes = [...byFrame.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tcFrames, group]) => ({
      ...group[0],
      tc_frames: tcFrames,
      latitude: median(group.map((fix) => fix.latitude)),
      longitude: median(group.map((fix) => fix.longitude)),
    }));

  let changed = true;
  while (changed && fixes.length > 2) {
    changed = false;
    fixes = fixes.filter((fix, index, all) => {
      if (index === 0 || index === all.length - 1) return true;
      const incoming = legacySegmentSpeedMph(all[index - 1], fix);
      const outgoing = legacySegmentSpeedMph(fix, all[index + 1]);
      const bypass = legacySegmentSpeedMph(all[index - 1], all[index + 1]);
      const isolatedSpike = incoming > 120 && outgoing > 120 && bypass <= 120;
      if (isolatedSpike) changed = true;
      return !isolatedSpike;
    });
  }

  return fixes.filter(
    (fix, index, all) =>
      index === 0 ||
      fix.latitude !== all[index - 1].latitude ||
      fix.longitude !== all[index - 1].longitude,
  );
}

/** Convert the MMM Legacy XL LTC export into the catalog's compact telemetry shape. */
export function normalizeLegacyXlTelemetry(document: unknown): Telemetry {
  const legacy = legacyXlTelemetrySchema.parse(document);
  if (!legacy.availability.gps_available) {
    throw new Error("Legacy XL telemetry reports that GPS is unavailable");
  }

  // The handoff repeats the same Android GPS fix at the video frame rate and
  // may include isolated, one-frame coordinate corruption.
  const fixes = cleanLegacyGpsFixes(legacy.samples.gps);
  if (fixes.length < 2) throw new Error("Legacy XL GPS has fewer than two distinct fixes");

  const segmentSpeeds: Array<number | undefined> = [];
  for (let index = 0; index < fixes.length - 1; index++) {
    const current = fixes[index];
    const next = fixes[index + 1];
    const mph = legacySegmentSpeedMph(current, next);
    // Reject impossible GPS jumps before the median window. They are sensor
    // outliers, not a reason to classify a city drive as aircraft-fast.
    segmentSpeeds.push(Number.isFinite(mph) && mph <= 120 ? mph : undefined);
  }

  const smoothed = segmentSpeeds.map((_, index) => {
    const window = segmentSpeeds
      .slice(Math.max(0, index - 2), Math.min(segmentSpeeds.length, index + 3))
      .filter((value): value is number => value !== undefined);
    return window.length ? median(window) : 0;
  });
  const startFrame = fixes[0].tc_frames;
  const samples = fixes.map((fix, index) => ({
    t: (fix.tc_frames - startFrame) / 24,
    lat: fix.latitude,
    lon: fix.longitude,
    speedMph: smoothed[Math.min(index, smoothed.length - 1)] ?? 0,
  }));
  const durationSec = Math.max(
    (legacy.take.end_frame - legacy.take.start_frame) / 24,
    1 / 24,
  );
  return telemetrySchema.parse({
    source: "Legacy XL Android LTC GPS",
    imu: {
      collected: legacy.availability.imu_available && legacy.samples.imu.length > 0,
      source: "Legacy XL Android LTC IMU",
      rateHz: legacy.samples.imu.length / durationSec,
    },
    samples,
  });
}

interface NominatimResult {
  display_name?: string;
  address?: Record<string, string | undefined>;
}

type GeocodedLocation = NonNullable<Gps["startLocation"]>;
const geocodeMemory = new Map<string, GeocodedLocation>();
let lastNominatimRequestAt = 0;

function geocodeCachePath(): string {
  return (
    process.env.PLATELAB_GEOCODE_CACHE?.trim() ||
    path.join(os.homedir(), ".cache", "platelab", "geocoding.json")
  );
}

function cacheKey(point: { lat: number; lon: number }): string {
  return `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`;
}

function loadGeocodeCache(): void {
  if (geocodeMemory.size) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(geocodeCachePath(), "utf8")) as Record<
      string,
      GeocodedLocation
    >;
    for (const [key, value] of Object.entries(parsed)) geocodeMemory.set(key, value);
  } catch {
    // First run or an unreadable cache: lookups can still proceed.
  }
}

function saveGeocodeCache(): void {
  const file = geocodeCachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(geocodeMemory), null, 2));
}

function normalizeNominatim(result: NominatimResult): GeocodedLocation {
  const address = result.address ?? {};
  const city = address.city ?? address.town ?? address.village ?? address.municipality;
  const region = address.state ?? address.region;
  const neighbourhood =
    address.neighbourhood ?? address.suburb ?? address.quarter ?? address.city_district;
  const road = address.road ?? address.pedestrian ?? address.highway;
  const parts = [road, neighbourhood, city, region].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );
  return {
    label: parts.join(", ") || result.display_name || "Location unavailable",
    ...(road ? { road } : {}),
    ...(neighbourhood ? { neighbourhood } : {}),
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(address.country ? { country: address.country } : {}),
  };
}

async function reverseGeocode(point: { lat: number; lon: number }): Promise<GeocodedLocation> {
  loadGeocodeCache();
  const key = cacheKey(point);
  const cached = geocodeMemory.get(key);
  if (cached) return cached;

  const waitMs = Math.max(0, 1_050 - (Date.now() - lastNominatimRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastNominatimRequestAt = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(point.lat));
  url.searchParams.set("lon", String(point.lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        process.env.PLATELAB_GEOCODER_USER_AGENT?.trim() ||
        "ThePlateLabIngest/1.0 (https://theplatelab.studio)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Nominatim reverse lookup failed (${response.status})`);
  const location = normalizeNominatim((await response.json()) as NominatimResult);
  geocodeMemory.set(key, location);
  saveGeocodeCache();
  return location;
}

/** Add user-readable route endpoints without making telemetry parsing depend on the network. */
export async function enrichTelemetryLocations(summary: TelemetrySummary): Promise<TelemetrySummary> {
  if (process.env.PLATELAB_REVERSE_GEOCODE === "false") return summary;
  try {
    const startLocation = await reverseGeocode(summary.gps.start);
    const endLocation = await reverseGeocode(summary.gps.end);
    return {
      ...summary,
      gps: {
        ...summary.gps,
        startLocation,
        endLocation,
        geocoding: {
          provider: "OpenStreetMap Nominatim",
          lookedUpAt: new Date().toISOString(),
        },
      },
    };
  } catch (error) {
    console.warn(
      `Reverse geocoding unavailable; retaining coordinates only: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return summary;
  }
}
