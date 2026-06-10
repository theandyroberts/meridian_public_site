import fs from "node:fs";
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
