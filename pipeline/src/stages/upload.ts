import fs from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { PUBLIC_MEDIA, ROOT } from "../paths.js";
import { type CameraId } from "@platelab/shared";
import type { RenditionPaths } from "./renditions.js";

/**
 * Publishing renditions to where the site can serve them.
 *
 *  - local: copy into web/public/media/<sku>/ (demo + development)
 *  - s3:    renditions → public bucket, originals → separate PRIVATE bucket.
 *           Requires aws CLI + PLATELAB_PUBLIC_BUCKET / PLATELAB_VAULT_BUCKET.
 *  - hippius: S3-compatible upload to Hippius, using HIPPIUS_BUCKET plus
 *             HIPPIUS_ACCESS_KEY / HIPPIUS_SECRET from env or root .env.local.
 *
 * Invariant either way: original masters never land in a public location.
 * The returned URLs are site-relative paths (local) or bucket keys (remote).
 */

type UploadMode = "local" | "s3" | "hippius";

export interface UploadResult {
  mode: UploadMode;
  stitchedPreviewUrl: string;
  cameraPreviewUrls: Record<CameraId, string>;
  posterUrl: string;
}

interface RemoteUploadConfig {
  mode: "s3" | "hippius";
  publicBucket: string;
  vaultBucket: string;
  awsArgsPrefix: string[];
  env?: NodeJS.ProcessEnv;
}

let dotEnvLoaded = false;

export function parseDotEnv(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    const quote = value[0];
    if ((quote === `"` || quote === `'`) && value[value.length - 1] === quote) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    parsed[match[1]] = value;
  }
  return parsed;
}

export function loadRootDotEnvLocal(): void {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;

  const envPath = path.join(process.env.PLATELAB_ROOT ?? ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const [key, value] of Object.entries(parseDotEnv(fs.readFileSync(envPath, "utf8")))) {
    process.env[key] ??= value;
  }
}

function uploadMode(env: NodeJS.ProcessEnv): UploadMode {
  const explicit = env.PLATELAB_UPLOAD_MODE as UploadMode | undefined;
  if (explicit) {
    if (!["local", "s3", "hippius"].includes(explicit)) {
      throw new Error(`unsupported PLATELAB_UPLOAD_MODE: ${explicit}`);
    }
    return explicit;
  }
  return env.HIPPIUS_BUCKET ? "hippius" : "local";
}

export function resolveRemoteUploadConfig(env: NodeJS.ProcessEnv): RemoteUploadConfig {
  const mode = uploadMode(env);
  if (mode === "local") {
    throw new Error("local mode does not use remote upload config");
  }

  if (mode === "hippius") {
    const bucket = env.HIPPIUS_BUCKET;
    const accessKey = env.HIPPIUS_ACCESS_KEY;
    const secretKey = env.HIPPIUS_SECRET ?? env.HIPPIUS_SECRET_KEY;
    if (!bucket || !accessKey || !secretKey) {
      throw new Error("hippius mode needs HIPPIUS_BUCKET, HIPPIUS_ACCESS_KEY, and HIPPIUS_SECRET");
    }
    const endpointUrl = env.HIPPIUS_ENDPOINT_URL ?? "https://s3.hippius.com";
    const region = env.HIPPIUS_REGION ?? "decentralized";
    return {
      mode,
      publicBucket: bucket,
      vaultBucket: bucket,
      awsArgsPrefix: ["--endpoint-url", endpointUrl],
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: accessKey,
        AWS_SECRET_ACCESS_KEY: secretKey,
        AWS_DEFAULT_REGION: region,
      },
    };
  }

  const publicBucket = env.PLATELAB_PUBLIC_BUCKET;
  const vaultBucket = env.PLATELAB_VAULT_BUCKET;
  if (!publicBucket || !vaultBucket) {
    throw new Error("s3 mode needs PLATELAB_PUBLIC_BUCKET and PLATELAB_VAULT_BUCKET");
  }
  if (publicBucket === vaultBucket) {
    throw new Error("public and vault buckets must differ");
  }
  const endpointUrl = env.PLATELAB_S3_ENDPOINT_URL;
  return {
    mode,
    publicBucket,
    vaultBucket,
    awsArgsPrefix: endpointUrl ? ["--endpoint-url", endpointUrl] : [],
  };
}

export async function uploadRenditions(
  sku: string,
  renditions: RenditionPaths,
  originals: string[],
): Promise<UploadResult> {
  loadRootDotEnvLocal();
  const mode = uploadMode(process.env);

  if (mode === "s3" || mode === "hippius") {
    const remote = resolveRemoteUploadConfig(process.env);
    for (const original of originals) {
      await run("aws", [
        ...remote.awsArgsPrefix,
        "s3", "cp", original,
        `s3://${remote.vaultBucket}/masters/${sku}/${path.basename(original)}`,
      ], { env: remote.env });
    }
    await run("aws", [
      ...remote.awsArgsPrefix,
      "s3", "cp", renditions.dir, `s3://${remote.publicBucket}/media/${sku}/`,
      "--recursive",
    ], { env: remote.env });
    const base = `media/${sku}`;
    return {
      mode: remote.mode,
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
