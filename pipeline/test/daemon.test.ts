import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("daemon processes an uploaded handoff end to end into draft plates", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-daemon-"));
  process.env.PLATELAB_ROOT = root;
  // dynamic imports AFTER env is set (paths bind at import)
  const { makeHandoff } = await import("./helpers/makeHandoff.js");
  const { createTransfer, updateTransfer, getTransfer } = await import("@platelab/shared/server");
  const { processTransfer } = await import("../src/daemon.js");
  const { INBOX_INCOMING, TRANSFERS_DIR, CATALOG_PATH } = await import("../src/paths.js");

  const handoffId = "SPH-STK-20260708-GLENDORA-001-web";
  const CLIP = "SPH-STK-20260708-GLENDORA-001-CLIP-0001";
  const dir = path.join(INBOX_INCOMING, handoffId);
  fs.mkdirSync(dir, { recursive: true });
  await makeHandoff(dir, { clips: [
    { stockClipId: CLIP },
    { stockClipId: CLIP.replace("0001", "0002"), assetType: "unavailable" },
  ]});

  const rec = createTransfer(TRANSFERS_DIR, {
    handoffId, bytes: 1000, manifestSha256: "0".repeat(64), clipCount: 2,
  });
  updateTransfer(TRANSFERS_DIR, rec.transferId, { state: "uploaded" });

  await processTransfer(rec.transferId);

  const done = getTransfer(TRANSFERS_DIR, rec.transferId)!;
  assert.equal(done.state, "complete");
  const good = done.clips.find((c) => c.stockClipId === CLIP)!;
  assert.equal(good.state, "draft");
  assert.match(good.sku!, /^PL-\d{7}$/);
  const bad = done.clips.find((c) => c.stockClipId.endsWith("0002"))!;
  assert.equal(bad.state, "failed");
  assert.equal(bad.error!.stage, "no_publishable_asset");

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const plate = catalog.plates.find((p: any) => p.sku === good.sku);
  assert.equal(plate.status, "draft");
  assert.equal(plate.mmm.stockClipId, CLIP);
  // package archived out of incoming
  assert.equal(fs.existsSync(dir), false);
});
