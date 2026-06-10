import fs from "node:fs";
import path from "node:path";
import { catalogSchema, plateSchema, type Catalog, type Plate } from "@platelab/shared";
import { CATALOG_PATH } from "../paths.js";

export function loadCatalog(): Catalog {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { generatedAt: new Date().toISOString(), plates: [] };
  }
  return catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
}

/** Validate and upsert one plate, then atomically rewrite the catalog. */
export function publishPlate(plate: Plate): Catalog {
  plateSchema.parse(plate);
  const catalog = loadCatalog();
  const idx = catalog.plates.findIndex((p) => p.sku === plate.sku);
  if (idx >= 0) catalog.plates[idx] = plate;
  else catalog.plates.push(plate);
  catalog.plates.sort((a, b) => a.sku.localeCompare(b.sku));
  catalog.generatedAt = new Date().toISOString();

  catalogSchema.parse(catalog);
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  const tmp = CATALOG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2));
  fs.renameSync(tmp, CATALOG_PATH);
  return catalog;
}
