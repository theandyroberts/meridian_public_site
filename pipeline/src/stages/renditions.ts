import fs from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { CAMERA_POSITIONS, type CameraId } from "@platelab/shared";
import type { Drop } from "./discover.js";

/**
 * Watermarked, web-safe renditions. Nothing produced here is full quality:
 * previews are small, CRF 30, with SKU + PLATE LAB PREVIEW burn-ins, so a
 * leaked preview has no production value.
 */

const FONT_CANDIDATES = [
  "/System/Library/Fonts/Helvetica.ttc",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

export function findFont(): string {
  const font = FONT_CANDIDATES.find((f) => fs.existsSync(f));
  if (!font) throw new Error("no usable font for watermark burn-in");
  return font;
}

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Light viewing grade for log-encoded masters — preview only, never the master. */
const PREVIEW_GRADE = "eq=contrast=1.22:saturation=1.45:gamma=1.06";

function watermarkFilter(font: string, sku: string, label?: string): string {
  const big =
    `drawtext=fontfile=${font}:text='${esc("PLATE LAB · PREVIEW")}'` +
    `:fontsize=h/9:fontcolor=white@0.16:x=(w-text_w)/2:y=(h-text_h)/2`;
  const corner =
    `drawtext=fontfile=${font}:text='${esc(`${sku} · NOT FOR PRODUCTION`)}'` +
    `:fontsize=h/24:fontcolor=white@0.55:x=12:y=h-text_h-10`;
  const cam = label
    ? `,drawtext=fontfile=${font}:text='${esc(label)}'` +
      `:fontsize=h/16:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=8:x=12:y=10`
    : "";
  return `${big},${corner}${cam}`;
}

async function encodePreview(
  src: string,
  dst: string,
  width: number,
  filter: string,
  graded = false,
): Promise<void> {
  const chain = graded
    ? `scale=${width}:-2,${filter}`
    : `scale=${width}:-2,${PREVIEW_GRADE},${filter}`;
  await run("ffmpeg", [
    "-v", "error", "-i", src,
    "-vf", chain,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-y", dst,
  ]);
}

export interface RenditionPaths {
  dir: string;
  stitchedPreview: string;
  stagePreview?: string;
  cameraPreviews: Record<CameraId, string>;
  poster: string;
}

export async function buildRenditions(
  drop: Drop,
  fullSphereMaster: string,
  sku: string,
  outDir: string,
): Promise<RenditionPaths> {
  fs.mkdirSync(outDir, { recursive: true });
  const font = findFont();

  const graded = drop.meta.colorState === "graded";
  const stitchedPreview = path.join(outDir, "stitched_preview.mp4");
  await encodePreview(
    fullSphereMaster,
    stitchedPreview,
    960,
    watermarkFilter(font, sku),
    graded,
  );
  const stagePreview = path.join(outDir, "stage_preview.mp4");
  await encodePreview(
    fullSphereMaster,
    stagePreview,
    2048,
    watermarkFilter(font, sku, "360 STAGE PREVIS · FULL SPHERE"),
    graded,
  );

  const cameraPreviews = {} as Record<CameraId, string>;
  for (const [id, file] of Object.entries(drop.cameraFiles) as [CameraId, string][]) {
    const dst = path.join(outDir, `cam_${id}_preview.mp4`);
    const label = `${id} · ${CAMERA_POSITIONS[id].toUpperCase()}`;
    await encodePreview(file, dst, 480, watermarkFilter(font, sku, label), graded);
    cameraPreviews[id] = dst;
  }

  const poster = path.join(outDir, "poster.jpg");
  const posterSrc = fullSphereMaster;
  // Seek 1s in for a representative frame, but very short sources (e.g. test
  // fixtures) have no frame at/after t=1s — fall back to the first frame.
  try {
    await run("ffmpeg", [
      "-v", "error", "-ss", "1", "-i", posterSrc,
      "-frames:v", "1", "-vf", graded ? "scale=1280:-2" : `scale=1280:-2,${PREVIEW_GRADE}`, "-q:v", "4", "-y", poster,
    ]);
  } catch (err) {
    // Log the original failure before falling back to frame 0 — if the source
    // is genuinely corrupt, this first error carries the real signature and
    // shouldn't be lost behind a (possibly unrelated) retry failure.
    console.warn(`buildRenditions: poster seek at t=1s failed, retrying at t=0: ${(err as Error).message}`);
    await run("ffmpeg", [
      "-v", "error", "-i", posterSrc,
      "-frames:v", "1", "-vf", graded ? "scale=1280:-2" : `scale=1280:-2,${PREVIEW_GRADE}`, "-q:v", "4", "-y", poster,
    ]);
  }

  return { dir: outDir, stitchedPreview, stagePreview, cameraPreviews, poster };
}
