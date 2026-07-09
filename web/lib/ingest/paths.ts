import path from "node:path";

/** web/ runs with cwd = web; the repo root is one level up (see pm2 config). */
export const REPO_ROOT = process.env.PLATELAB_ROOT ?? path.join(process.cwd(), "..");
export const TRANSFERS_DIR = path.join(REPO_ROOT, "sample-data", "transfers");
export const INBOX_INCOMING = path.join(REPO_ROOT, "ingest-inbox", "incoming");
