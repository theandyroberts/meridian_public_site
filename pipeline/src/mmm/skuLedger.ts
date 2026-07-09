import fs from "node:fs";
import path from "node:path";
import { makeRandomSku } from "@platelab/shared";
import { SKU_LEDGER } from "../paths.js";

/**
 * Every SKU ever issued, including rejected/removed plates — identifiers are
 * never recycled (old invoices/links must never resolve to a different
 * plate). Single-writer: only the daemon (or CLI) assigns SKUs.
 */

export function loadLedger(): string[] {
  if (!fs.existsSync(SKU_LEDGER)) return [];
  return JSON.parse(fs.readFileSync(SKU_LEDGER, "utf8")).issued as string[];
}

function saveLedger(issued: string[]): void {
  fs.mkdirSync(path.dirname(SKU_LEDGER), { recursive: true });
  const tmp = SKU_LEDGER + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ issued }, null, 2));
  fs.renameSync(tmp, SKU_LEDGER);
}

export function assignSku(opts: { rng?: () => number } = {}): string {
  const issued = loadLedger();
  const taken = new Set(issued);
  for (let i = 0; i < 10_000; i++) {
    const sku = makeRandomSku(opts.rng);
    if (!taken.has(sku)) {
      issued.push(sku);
      saveLedger(issued);
      return sku;
    }
  }
  throw new Error("SKU space exhausted — widen the base (see spec)");
}
