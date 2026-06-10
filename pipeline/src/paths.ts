import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (meridian_public_site). */
export const ROOT = path.resolve(here, "..", "..");
export const SAMPLE_DATA = path.join(ROOT, "sample-data");
export const DROPS_DIR = path.join(SAMPLE_DATA, "drops");
export const AUDIT_LOG = path.join(SAMPLE_DATA, "audit.jsonl");
export const CATALOG_PATH = path.join(ROOT, "web", "data", "catalog.json");
/** Public renditions root — ONLY watermarked previews/posters may land here. */
export const PUBLIC_MEDIA = path.join(ROOT, "web", "public", "media");
