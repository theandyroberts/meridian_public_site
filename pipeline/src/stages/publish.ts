import fs from "node:fs";
import path from "node:path";
import { catalogSchema, plateSchema, type Catalog, type Plate } from "@platelab/shared";
import { CATALOG_PATH } from "../paths.js";
import {
  publishPlateToSupabase,
  plateFromSupabase,
  publishedMmmIdsFromSupabase,
  removePlateFromSupabase,
  usesSupabaseCatalog,
} from "./publishSupabase.js";

/** Advisory lock for the local JSON compatibility backend. */
function withCatalogLock<T>(catalogPath: string, fn: () => T): T {
  const lockPath = `${catalogPath}.lock`;
  const timeoutMs = 5000;
  const intervalMs = 50;
  const staleMs = 30_000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs) {
          fs.rmSync(lockPath, { force: true }); // crashed writer; retry immediately
          continue;
        }
      } catch { /* lock removed concurrently; retry */ }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for catalog lock: ${lockPath}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

export function loadCatalog(): Catalog {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { generatedAt: new Date().toISOString(), plates: [] };
  }
  return catalogSchema.parse(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
}

/** Validate and upsert one plate, then atomically rewrite the catalog. */
export async function publishPlate(plate: Plate): Promise<Catalog> {
  plateSchema.parse(plate);
  if (usesSupabaseCatalog()) {
    await publishPlateToSupabase(plate);
    return {
      generatedAt: new Date().toISOString(),
      plates: [plate],
    };
  }
  return withCatalogLock(CATALOG_PATH, () => {
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
  });
}

export async function removePlate(
  sku: string,
  reason: string,
): Promise<Catalog> {
  if (usesSupabaseCatalog()) {
    await removePlateFromSupabase(sku);
    return {
      generatedAt: new Date().toISOString(),
      plates: [],
    };
  }
  return withCatalogLock(CATALOG_PATH, () => {
    const catalog = loadCatalog();
    const idx = catalog.plates.findIndex((p) => p.sku === sku);
    if (idx < 0) throw new Error(`unknown SKU: ${sku}`);
    catalog.plates.splice(idx, 1);
    catalog.generatedAt = new Date().toISOString();
    catalogSchema.parse(catalog);
    const tmp = CATALOG_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2));
    fs.renameSync(tmp, CATALOG_PATH);
    return catalog;
  });
}

export async function loadPublishedMmmIds(): Promise<string[]> {
  if (usesSupabaseCatalog()) {
    return publishedMmmIdsFromSupabase();
  }
  return loadCatalog().plates.flatMap((plate) =>
    plate.mmm?.stockClipId ? [plate.mmm.stockClipId] : [],
  );
}

export async function loadPlate(sku: string): Promise<Plate | undefined> {
  if (usesSupabaseCatalog()) {
    return plateFromSupabase(sku);
  }
  return loadCatalog().plates.find((plate) => plate.sku === sku);
}
