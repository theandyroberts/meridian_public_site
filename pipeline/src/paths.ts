import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (meridian_public_site). Override with PLATELAB_ROOT in tests/daemon. */
export const ROOT = process.env.PLATELAB_ROOT ?? path.resolve(here, "..", "..");
export const SAMPLE_DATA = path.join(ROOT, "sample-data");
export const DROPS_DIR = path.join(SAMPLE_DATA, "drops");
export const AUDIT_LOG = path.join(SAMPLE_DATA, "audit.jsonl");
export const TRANSFERS_DIR = path.join(SAMPLE_DATA, "transfers");
export const CATALOG_PATH = path.join(ROOT, "web", "data", "catalog.json");
export const SKU_LEDGER = path.join(ROOT, "web", "data", "sku-ledger.json");
/** Public renditions root — ONLY watermarked previews/posters may land here. */
export const PUBLIC_MEDIA = path.join(ROOT, "web", "public", "media");
/** MMM handoff inbox/archive (daemon-owned). */
export const INGEST_INBOX = path.join(ROOT, "ingest-inbox");
export const INBOX_INCOMING = path.join(INGEST_INBOX, "incoming");
export const INBOX_ARCHIVE = path.join(INGEST_INBOX, "archive");
export const INBOX_FAILED = path.join(INGEST_INBOX, "failed");
