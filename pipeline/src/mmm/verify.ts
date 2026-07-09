import fs from "node:fs";
import path from "node:path";
import { handoffManifestSchema, type HandoffManifest } from "@platelab/shared";
import { sha256File } from "../stages/checksum.js";

export class HandoffVerifyError extends Error {
  constructor(public code: "manifest" | "checksum", public detail: string) {
    super(`${code}: ${detail}`);
  }
}

/** Parse + schema-validate the manifest, then verify every asset checksum. */
export async function verifyHandoff(rootDir: string): Promise<HandoffManifest> {
  const manifestPath = path.join(rootDir, "website_handoff_manifest.json");
  if (!fs.existsSync(manifestPath)) throw new HandoffVerifyError("manifest", "website_handoff_manifest.json not found");
  let manifest: HandoffManifest;
  try {
    manifest = handoffManifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch (err) {
    throw new HandoffVerifyError("manifest", (err as Error).message);
  }
  for (const clip of manifest.clips) {
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
  return manifest;
}
