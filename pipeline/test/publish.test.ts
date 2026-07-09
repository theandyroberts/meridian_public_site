import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRandomSku } from "@platelab/shared";

function makePlate(sku: string) {
  return {
    sku,
    title: "t", description: "d", shootDate: "2026-07-08", rig: "Mercy01",
    media: { durationSec: 10, fps: 23.98, stitchedResolution: "3840x1920",
      colorPipeline: "c", masterFormat: "m", cameraOriginals: "o" },
    shotType: "urban", timeOfDay: "day", weather: "clear", season: "summer",
    tags: [], objects: [],
    location: { name: "n", city: "c", region: "r", country: "US" },
    imu: { collected: false },
    stageCompat: ["led-volume"], availability: "available",
    pricing: { perMinuteUsd: 8000, totalUsd: 8000, minimumMinutes: 1 },
    renditions: { stitchedPreview: "/m/s.mp4", cameraPreviews: {}, poster: "/m/p.jpg" },
    security: { masterSha256: "a".repeat(64), watermarked: true },
    ingestedAt: "2026-07-08T00:00:00Z",
    status: "draft" as const,
  };
}

test("publishPlate: concurrent writers don't lose updates (advisory lock serializes RMW)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-publish-"));
  process.env.PLATELAB_ROOT = root;
  const { publishPlate, loadCatalog } = await import("../src/stages/publish.js");
  const { CATALOG_PATH } = await import("../src/paths.js");

  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), plates: [] }));

  const skus = Array.from({ length: 8 }, (_, i) => makeRandomSku(() => (i + 1) / 10));
  // Fire concurrent publishPlate calls — without a lock, concurrent
  // read-modify-write on catalog.json would drop some of these.
  await Promise.all(skus.map((sku) => Promise.resolve(publishPlate(makePlate(sku)))));

  const catalog = loadCatalog();
  assert.equal(catalog.plates.length, skus.length);
  for (const sku of skus) {
    assert.ok(catalog.plates.some((p) => p.sku === sku), `missing ${sku}`);
  }
  // Lockfile cleaned up after every writer releases.
  assert.equal(fs.existsSync(`${CATALOG_PATH}.lock`), false);
});

test("removePlate: removes the plate and cleans up the lockfile", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-publish-"));
  process.env.PLATELAB_ROOT = root;
  const { publishPlate, removePlate, loadCatalog } = await import("../src/stages/publish.js");
  const { CATALOG_PATH } = await import("../src/paths.js");

  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), plates: [] }));

  publishPlate(makePlate("PL-4839208"));
  removePlate("PL-4839208", "test cleanup");

  const catalog = loadCatalog();
  assert.equal(catalog.plates.length, 0);
  assert.equal(fs.existsSync(`${CATALOG_PATH}.lock`), false);
});

test("publishPlate: stale lockfile (crashed writer) is removed and retried", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-publish-"));
  process.env.PLATELAB_ROOT = root;
  const { publishPlate, loadCatalog } = await import("../src/stages/publish.js");
  const { CATALOG_PATH } = await import("../src/paths.js");

  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), plates: [] }));

  // Simulate a crashed writer: lockfile present, mtime far in the past.
  const lockPath = `${CATALOG_PATH}.lock`;
  fs.writeFileSync(lockPath, "");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lockPath, old, old);

  publishPlate(makePlate("PL-4839208"));

  const catalog = loadCatalog();
  assert.equal(catalog.plates.length, 1);
  assert.equal(fs.existsSync(lockPath), false);
});
