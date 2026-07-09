import fs from "node:fs";
import path from "node:path";
import { catalogSchema, type Catalog, type Plate } from "@platelab/shared";

const CATALOG_PATH = path.join(process.cwd(), "data", "catalog.json");

let cached: Catalog | null = null;
let cachedMtime = 0;

export function getCatalog(): Catalog {
  if (!fs.existsSync(CATALOG_PATH)) return { generatedAt: "", plates: [] };
  const mtime = fs.statSync(CATALOG_PATH).mtimeMs;
  if (!cached || mtime !== cachedMtime) {
    cached = catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
    cachedMtime = mtime;
  }
  return cached;
}

export function getLivePlates(): Plate[] {
  return getCatalog().plates.filter((p) => p.status === "live");
}

export function getPlate(sku: string): Plate | undefined {
  return getCatalog().plates.find((p) => p.sku === sku);
}

export function getLivePlate(sku: string): Plate | undefined {
  const p = getPlate(sku);
  return p?.status === "live" ? p : undefined;
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
