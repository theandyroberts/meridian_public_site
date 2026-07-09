import fs from "node:fs";
import path from "node:path";
import { catalogSchema, isValidSku, type Catalog } from "@platelab/shared";
import { REPO_ROOT } from "@/lib/ingest/paths";

const CATALOG = path.join(process.cwd(), "data", "catalog.json");
const AUDIT = path.join(REPO_ROOT, "sample-data", "audit.jsonl");

function load(): Catalog {
  return catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG, "utf8")));
}

function save(catalog: Catalog, event: string, detail: Record<string, unknown>): void {
  catalog.generatedAt = new Date().toISOString();
  catalogSchema.parse(catalog);
  const tmp = CATALOG + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2));
  fs.renameSync(tmp, CATALOG);
  fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
  fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n");
}

export function publishDraft(sku: string): void {
  if (!isValidSku(sku)) throw new Error(`invalid SKU: ${sku}`);
  const catalog = load();
  const plate = catalog.plates.find((p) => p.sku === sku);
  if (!plate) throw new Error(`unknown SKU: ${sku}`);
  plate.status = "live";
  save(catalog, "admin.publish", { sku });
}

export function rejectDraft(sku: string, reason: string): void {
  if (!isValidSku(sku)) throw new Error(`invalid SKU: ${sku}`);
  const catalog = load();
  const idx = catalog.plates.findIndex((p) => p.sku === sku);
  if (idx < 0) throw new Error(`unknown SKU: ${sku}`);
  catalog.plates.splice(idx, 1); // SKU stays in the ledger — never reused
  save(catalog, "admin.reject", { sku, reason });
}
