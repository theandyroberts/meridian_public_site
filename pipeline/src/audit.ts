import fs from "node:fs";
import path from "node:path";
import { AUDIT_LOG } from "./paths.js";

/**
 * Append-only ingest audit trail. Every stage of every ingest writes a line,
 * so a plate's full chain of custody is reconstructable from this file.
 */
export function audit(event: string, detail: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(
    AUDIT_LOG,
    JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n",
  );
}
