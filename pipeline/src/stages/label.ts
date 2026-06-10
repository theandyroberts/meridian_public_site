import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../exec.js";
import type { ObjectLabel } from "@platelab/shared";
import type { DropMeta } from "./discover.js";

/**
 * Object labeling over sampled frames of the stitched master.
 *
 * Two implementations behind one interface:
 *  - Claude vision when ANTHROPIC_API_KEY is set (production path)
 *  - a deterministic stub seeded from operator scene hints, so the
 *    pipeline runs offline and in CI with stable output
 */

export interface LabelResult {
  objects: ObjectLabel[];
  tags: string[];
}

const FRAME_COUNT = 4;

async function extractFrames(stitchedMaster: string, durationSec: number): Promise<string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "platelab-frames-"));
  const frames: string[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = (durationSec * (i + 0.5)) / FRAME_COUNT;
    const out = path.join(dir, `frame_${i}.jpg`);
    await run("ffmpeg", [
      "-v", "error", "-ss", t.toFixed(2), "-i", stitchedMaster,
      "-frames:v", "1", "-vf", "scale=1024:-2", "-q:v", "5", "-y", out,
    ]);
    frames.push(out);
  }
  return frames;
}

async function labelWithClaude(frames: string[], apiKey: string): Promise<LabelResult> {
  const content: any[] = frames.map((f) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: "image/jpeg",
      data: fs.readFileSync(f).toString("base64"),
    },
  }));
  content.push({
    type: "text",
    text:
      "These are frames from a 360-degree driving plate (equirectangular). " +
      "List the visible objects and scene attributes useful to a film art director " +
      "searching stock footage. Respond with ONLY JSON: " +
      '{"objects":[{"label":string,"confidence":0..1}],"tags":[string]} ' +
      "with at most 20 objects and 15 lowercase tags.",
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`labeling API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as any;
  const text: string = body.content?.[0]?.text ?? "{}";
  const json = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, ""));
  return {
    objects: (json.objects ?? []).slice(0, 20),
    tags: (json.tags ?? []).slice(0, 15).map((t: string) => t.toLowerCase()),
  };
}

/** Deterministic pseudo-confidence in [0.62, 0.97] from the label text. */
function stubConfidence(label: string): number {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Math.round((0.62 + (h % 36) / 100) * 100) / 100;
}

function labelWithStub(meta: DropMeta): LabelResult {
  const objects = meta.sceneHints.map((label) => ({
    label,
    confidence: stubConfidence(label),
  }));
  const tags = [
    meta.shotType,
    meta.timeOfDay,
    meta.weather,
    meta.season,
    meta.location.city.toLowerCase(),
    ...meta.sceneHints.map((h) => h.toLowerCase()),
  ];
  return { objects, tags: [...new Set(tags)] };
}

export async function labelDrop(
  stitchedMaster: string,
  durationSec: number,
  meta: DropMeta,
): Promise<LabelResult & { labeler: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const frames = await extractFrames(stitchedMaster, durationSec);
    try {
      const result = await labelWithClaude(frames, apiKey);
      // Vision output plus operator hints; hints are ground truth.
      const merged = labelWithStub(meta);
      return {
        objects: result.objects.length ? result.objects : merged.objects,
        tags: [...new Set([...merged.tags, ...result.tags])],
        labeler: "claude-haiku-4-5 vision",
      };
    } finally {
      frames.forEach((f) => fs.rmSync(f, { force: true }));
    }
  }
  return { ...labelWithStub(meta), labeler: "offline-stub" };
}
