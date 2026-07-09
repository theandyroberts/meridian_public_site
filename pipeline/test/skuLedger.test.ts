import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("sku ledger: assigns, persists, never reuses, retries collisions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-ledger-"));
  process.env.PLATELAB_ROOT = root;
  const { assignSku, loadLedger } = await import("../src/mmm/skuLedger.js");

  const a = assignSku({ rng: () => 0.5 }); // deterministic base 550000
  assert.match(a, /^PL-\d{7}$/);
  assert.deepEqual(loadLedger(), [a]);

  // Same rng would collide → assignSku must advance to a different SKU.
  let calls = 0;
  const b = assignSku({ rng: () => (calls++ < 1 ? 0.5 : 0.6) });
  assert.notEqual(b, a);
  assert.deepEqual(loadLedger(), [a, b]);

  // Ledger survives re-import (persisted to disk).
  const raw = JSON.parse(fs.readFileSync(path.join(root, "web/data/sku-ledger.json"), "utf8"));
  assert.deepEqual(raw.issued, [a, b]);
});
