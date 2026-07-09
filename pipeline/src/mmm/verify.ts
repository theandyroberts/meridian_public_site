import fs from "node:fs";
import path from "node:path";
import { handoffManifestSchema, type HandoffManifest, type HandoffClip } from "@platelab/shared";
import { sha256File } from "../stages/checksum.js";

export class HandoffVerifyError extends Error {
  constructor(public code: "manifest" | "checksum", public detail: string) {
    super(`${code}: ${detail}`);
  }
}

/**
 * Parse + schema-validate the manifest only. Schema errors are handoff-level
 * ("manifest") — the whole handoff fails, per spec. Per-clip checksum
 * problems are NOT checked here; see verifyClipAssets.
 */
export function parseManifest(rootDir: string): HandoffManifest {
  const manifestPath = path.join(rootDir, "website_handoff_manifest.json");
  if (!fs.existsSync(manifestPath)) throw new HandoffVerifyError("manifest", "website_handoff_manifest.json not found");
  try {
    return handoffManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch (err) {
    throw new HandoffVerifyError("manifest", (err as Error).message);
  }
}

/**
 * Verify one clip's asset checksums. Throws HandoffVerifyError("checksum")
 * for missing/unverified/mismatched sha256 of THAT clip's assets only —
 * siblings are unaffected (spec: "Asset checksum missing, unverified, or
 * mismatched → that clip failed(checksum); siblings proceed").
 */
export async function verifyClipAssets(rootDir: string, clip: HandoffClip): Promise<void> {
  for (const asset of clip.assets) {
    if (!asset.checksum_sha256 || !asset.checksum_verified) {
      throw new HandoffVerifyError("checksum", `${clip.stock_clip_id}/${asset.role}: checksum missing or unverified`);
    }
    const file = path.join(rootDir, asset.package_relative_path);
    if (!fs.existsSync(file)) throw new HandoffVerifyError("checksum", `${asset.package_relative_path}: file missing`);
    const actual = await sha256File(file);
    if (actual !== asset.checksum_sha256) {
      throw new HandoffVerifyError("checksum", `${asset.package_relative_path}: sha256 mismatch`);
    }
  }
}

/**
 * Thin convenience wrapper kept for callers/tests that want manifest parse +
 * all-clip checksum verification in one call. Manifest schema errors surface
 * as "manifest"; any clip's checksum failure surfaces as "checksum" (this
 * wrapper does not isolate per-clip — use parseManifest + verifyClipAssets
 * directly for the isolated per-clip behavior the daemon relies on).
 */
export async function verifyHandoff(rootDir: string): Promise<HandoffManifest> {
  const manifest = parseManifest(rootDir);
  for (const clip of manifest.clips) {
    await verifyClipAssets(rootDir, clip);
  }
  return manifest;
}
