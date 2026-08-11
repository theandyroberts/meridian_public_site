import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const catalog = JSON.parse(readFileSync(`${root}/web/data/catalog.json`, "utf8"));
const errors = [];
const rows = [];

for (const plate of catalog.plates) {
  const relative = plate.renditions.stagePreview;
  if (!relative) {
    errors.push(`${plate.sku}: catalog has no stagePreview`);
    continue;
  }
  const localPath = `${root}/web/public${relative}`;
  let probe;
  try {
    probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height,codec_name,pix_fmt,color_space,color_primaries,color_transfer:format=duration,size",
          "-of",
          "json",
          localPath,
        ],
        { encoding: "utf8" },
      ),
    );
  } catch {
    errors.push(`${plate.sku}: cannot probe ${localPath}`);
    continue;
  }
  const stream = probe.streams?.[0] ?? {};
  const duration = Number(probe.format?.duration ?? 0);
  if (stream.width !== 2048 || stream.height !== 1024) {
    errors.push(`${plate.sku}: expected 2048x1024, got ${stream.width}x${stream.height}`);
  }
  if (stream.codec_name !== "h264" || stream.pix_fmt !== "yuv420p") {
    errors.push(`${plate.sku}: expected H.264 yuv420p`);
  }
  if (
    stream.color_space !== "bt709" ||
    stream.color_primaries !== "bt709" ||
    stream.color_transfer !== "bt709"
  ) {
    errors.push(`${plate.sku}: missing BT.709 color tags`);
  }
  if (Math.abs(duration - plate.media.durationSec) > 0.25) {
    errors.push(
      `${plate.sku}: duration ${duration.toFixed(3)} differs from catalog ${plate.media.durationSec}`,
    );
  }
  rows.push({
    sku: plate.sku,
    resolution: `${stream.width}x${stream.height}`,
    duration: duration.toFixed(2),
    megabytes: (Number(probe.format?.size ?? 0) / 1_000_000).toFixed(1),
  });
}

console.table(rows);
if (errors.length) {
  throw new Error(`Stage-preview checks failed:\n${errors.join("\n")}`);
}
console.log(`All ${rows.length} plates have valid full-sphere Studio previews.`);
