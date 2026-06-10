import type { DropMeta } from "./discover.js";
import type { LabelResult } from "./label.js";
import type { TelemetrySummary } from "./telemetry.js";

/**
 * Title + description generation. Uses Claude when a key is present,
 * otherwise a deterministic template. Either way the result is meant to be
 * human-reviewed before a plate is featured.
 */

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function templateDescription(
  meta: DropMeta,
  labels: LabelResult,
  telemetry: TelemetrySummary,
  durationSec: number,
): { title: string; description: string } {
  const dur = Math.round(durationSec);
  const top = labels.objects
    .slice(0, 4)
    .map((o) => o.label)
    .join(", ");
  const title = `${meta.location.name} — ${cap(meta.timeOfDay)} ${cap(meta.shotType)}`;
  const description =
    `${cap(meta.timeOfDay)} ${meta.shotType} plate along ${meta.location.name}, ` +
    `${meta.location.city}. ${dur}s of pro-stitched 360×180 coverage at an average ` +
    `${telemetry.gps.avgSpeedMph} mph${top ? `, passing ${top}` : ""}. ` +
    `${meta.weather === "clear" ? "Clean light" : cap(meta.weather) + " conditions"}, ` +
    `captured on the Spheris 9-camera array with full sky tier for reflections and ` +
    `LED-dome work.`;
  return { title, description };
}

export async function describePlate(
  meta: DropMeta,
  labels: LabelResult,
  telemetry: TelemetrySummary,
  durationSec: number,
): Promise<{ title: string; description: string; describer: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const fallback = templateDescription(meta, labels, telemetry, durationSec);
  if (!apiKey) return { ...fallback, describer: "template" };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content:
            "Write a title and 2-sentence description for a stock driving-plate " +
            "listing aimed at film art directors. Factual, no hype adjectives. " +
            'Respond ONLY with JSON {"title":string,"description":string}.\n' +
            `Metadata: ${JSON.stringify({ meta, labels: labels.tags, gps: telemetry.gps, durationSec })}`,
        },
      ],
    }),
  });
  if (!res.ok) return { ...fallback, describer: "template (api error)" };
  const body = (await res.json()) as any;
  try {
    const json = JSON.parse(
      (body.content?.[0]?.text ?? "").replace(/^```json?\s*|\s*```$/g, ""),
    );
    if (json.title && json.description) {
      return { title: json.title, description: json.description, describer: "claude-haiku-4-5" };
    }
  } catch {
    /* fall through to template */
  }
  return { ...fallback, describer: "template (parse fallback)" };
}
