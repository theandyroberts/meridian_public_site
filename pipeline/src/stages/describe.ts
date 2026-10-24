import { z } from "zod";
import type { DropMeta } from "./discover.js";
import type { LabelResult } from "./label.js";
import type { TelemetrySummary } from "./telemetry.js";

/** Telemetry may be entirely absent (stitched-only drops with no sidecar). */
export type DescribeTelemetry = Partial<Pick<TelemetrySummary, "gps" | "speedBand">> &
  Pick<TelemetrySummary, "imu">;

const DESCRIPTION_MODEL = "gpt-5.6-luna";
const descriptionSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(40).max(900),
});

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Non-production fixture output. Production ingest requires AI metadata. */
export function templateDescription(
  meta: DropMeta,
  labels: LabelResult,
  telemetry: DescribeTelemetry,
  durationSec: number,
): { title: string; description: string } {
  const top = labels.objects.slice(0, 4).map((object) => object.label).join(", ");
  return {
    title: `${meta.location.name} — ${cap(meta.timeOfDay)} ${cap(meta.shotType)}`,
    description:
      `${cap(meta.timeOfDay)} ${meta.shotType} plate along ${meta.location.name}, ` +
      `${meta.location.city}. ${Math.round(durationSec)}s of 360×180 coverage` +
      `${telemetry.gps ? ` at an average ${telemetry.gps.avgSpeedMph} mph` : ""}` +
      `${top ? `, passing ${top}` : ""}.`,
  };
}

export function sanitizePlateTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/^(?:cam[_ -]?[a-j]|roll\d+[_ -]?clip\d+|ga)\b[\s_.:/-]*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[—–:|\s]+|[—–:|\s]+$/g, "")
    .slice(0, 120);
}

function responseOutputText(body: unknown): string | undefined {
  return (body as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> })
    .output?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
}

export async function describePlate(
  meta: DropMeta,
  labels: LabelResult,
  telemetry: DescribeTelemetry,
  durationSec: number,
): Promise<{ title: string; description: string; describer: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const fallback = templateDescription(meta, labels, telemetry, durationSec);
  if (!apiKey) {
    if (process.env.PLATELAB_ALLOW_STUB_METADATA === "true") {
      return {
        ...fallback,
        title: sanitizePlateTitle(fallback.title),
        describer: "template (explicit non-production mode)",
      };
    }
    throw new Error(
      "OPENAI_API_KEY is required for catalog title and description generation",
    );
  }

  const model = process.env.OPENAI_INGEST_TEXT_MODEL?.trim() || DESCRIPTION_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "none" },
      input: [
        {
          role: "system",
          content:
            "Write a concise human-facing stock-footage title and a factual two- or " +
            "three-sentence description for film producers searching 360 production plates. " +
            "Lead with the specific road, district, bridge, landmark, or environment. Include " +
            "time of day, motion, weather, traffic, and camera-useful visual facts when known. " +
            "Never copy camera letters, capture codes, folder prefixes, roll/clip identifiers, " +
            "or unexplained abbreviations into the title. Do not claim a full-sphere sky tier " +
            "unless the supplied metadata says one exists. Do not add promotional hype.",
        },
        {
          role: "user",
          content: JSON.stringify({
            operatorMetadata: meta,
            visualLabels: labels,
            gps: telemetry.gps,
            imu: telemetry.imu,
            speedBand: telemetry.speedBand,
            durationSec,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "plate_listing_copy",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
            },
            required: ["title", "description"],
            additionalProperties: false,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `OpenAI listing copy failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  const outputText = responseOutputText(await response.json());
  if (!outputText) throw new Error("OpenAI listing copy returned no structured output");
  const generated = descriptionSchema.parse(JSON.parse(outputText));
  const title = sanitizePlateTitle(generated.title);
  if (!title) throw new Error("OpenAI listing copy produced an empty title after sanitization");
  return { title, description: generated.description.trim(), describer: model };
}
