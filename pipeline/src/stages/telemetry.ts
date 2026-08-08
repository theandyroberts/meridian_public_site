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
  const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
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
  const parsed = telemetrySchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  return summarizeTelemetry(parsed);
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
