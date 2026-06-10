import fs from "node:fs";
import path from "node:path";
import { catalogSchema, type Catalog, type Plate } from "@platelab/shared";

const CATALOG_PATH = path.join(process.cwd(), "data", "catalog.json");

let cached: Catalog | null = null;

export function getCatalog(): Catalog {
  if (cached && process.env.NODE_ENV === "production") return cached;
  if (!fs.existsSync(CATALOG_PATH)) {
    return { generatedAt: "", plates: [] };
  }
  cached = catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
  return cached;
}

export function getPlate(sku: string): Plate | undefined {
  return getCatalog().plates.find((p) => p.sku === sku);
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
