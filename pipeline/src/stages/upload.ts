import fs from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { PUBLIC_MEDIA } from "../paths.js";
import { type CameraId } from "@platelab/shared";
import type { RenditionPaths } from "./renditions.js";

/**
 * Publishing renditions to where the site can serve them.
 *
 *  - local: copy into web/public/media/<sku>/ (demo + development)
 *  - s3:    renditions → public bucket, originals → separate PRIVATE bucket.
 *           Requires aws CLI + PLATELAB_PUBLIC_BUCKET / PLATELAB_VAULT_BUCKET.
 *
 * Invariant either way: original masters never land in a public location.
 * The returned URLs are site-relative paths (local) or bucket keys (s3).
 */

export interface UploadResult {
  mode: "local" | "s3";
  stitchedPreviewUrl: string;
  cameraPreviewUrls: Record<CameraId, string>;
  posterUrl: string;
}

export async function uploadRenditions(
  sku: string,
  renditions: RenditionPaths,
  originals: string[],
): Promise<UploadResult> {
  const mode = (process.env.PLATELAB_UPLOAD_MODE ?? "local") as "local" | "s3";

  if (mode === "s3") {
    const publicBucket = process.env.PLATELAB_PUBLIC_BUCKET;
    const vaultBucket = process.env.PLATELAB_VAULT_BUCKET;
    if (!publicBucket || !vaultBucket) {
      throw new Error("s3 mode needs PLATELAB_PUBLIC_BUCKET and PLATELAB_VAULT_BUCKET");
    }
    if (publicBucket === vaultBucket) {
      throw new Error("public and vault buckets must differ");
    }
    for (const original of originals) {
      await run("aws", [
        "s3", "cp", original,
        `s3://${vaultBucket}/masters/${sku}/${path.basename(original)}`,
      ]);
    }
    await run("aws", [
      "s3", "cp", renditions.dir, `s3://${publicBucket}/media/${sku}/`,
      "--recursive",
    ]);
    const base = `media/${sku}`;
    return {
      mode,
      stitchedPreviewUrl: `${base}/stitched_preview.mp4`,
      cameraPreviewUrls: Object.fromEntries(
        (Object.keys(renditions.cameraPreviews) as CameraId[]).map((id) => [
          id,
          `${base}/cam_${id}_preview.mp4`,
        ]),
      ) as Record<CameraId, string>,
      posterUrl: `${base}/poster.jpg`,
    };
  }

  // local mode — renditions were already written under web/public/media/<sku>
  const expected = path.join(PUBLIC_MEDIA, sku);
  if (path.resolve(renditions.dir) !== path.resolve(expected)) {
    fs.mkdirSync(expected, { recursive: true });
    fs.cpSync(renditions.dir, expected, { recursive: true });
  }
  const base = `/media/${sku}`;
  return {
    mode,
    stitchedPreviewUrl: `${base}/stitched_preview.mp4`,
    cameraPreviewUrls: Object.fromEntries(
      (Object.keys(renditions.cameraPreviews) as CameraId[]).map((id) => [
        id,
        `${base}/cam_${id}_preview.mp4`,
      ]),
    ) as Record<CameraId, string>,
    posterUrl: `${base}/poster.jpg`,
  };
}
