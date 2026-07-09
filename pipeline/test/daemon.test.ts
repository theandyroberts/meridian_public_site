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

test("daemon fails a transfer on checksum mismatch and moves the package to failed", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-daemon-"));
  process.env.PLATELAB_ROOT = root;
  const { makeHandoff } = await import("./helpers/makeHandoff.js");
  const { createTransfer, updateTransfer, getTransfer } = await import("@platelab/shared/server");
  const { processTransfer } = await import("../src/daemon.js");
  const { INBOX_INCOMING, INBOX_FAILED, TRANSFERS_DIR } = await import("../src/paths.js");

  const handoffId = "SPH-STK-20260708-GLENDORA-002-web";
  const CLIP = "SPH-STK-20260708-GLENDORA-002-CLIP-0001";
  const dir = path.join(INBOX_INCOMING, handoffId);
  fs.mkdirSync(dir, { recursive: true });
  // Checksum verification only runs against real asset files, so this clip must
  // have actual assets on disk (not "unavailable") for us to corrupt one.
  await makeHandoff(dir, { clips: [{ stockClipId: CLIP }] });

  const manifestPath = path.join(dir, "website_handoff_manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const assetRelPath = manifest.clips[0].assets[0].package_relative_path;
  const assetAbsPath = path.join(dir, assetRelPath);
  fs.appendFileSync(assetAbsPath, Buffer.from("corruption"));

  const rec = createTransfer(TRANSFERS_DIR, {
    handoffId, bytes: 1000, manifestSha256: "0".repeat(64), clipCount: 1,
  });
  updateTransfer(TRANSFERS_DIR, rec.transferId, { state: "uploaded" });

  await processTransfer(rec.transferId);

  const done = getTransfer(TRANSFERS_DIR, rec.transferId)!;
  assert.equal(done.state, "failed");
  assert.equal(done.error!.code, "checksum");
  assert.equal(fs.existsSync(dir), false);
  const failedEntries = fs.existsSync(INBOX_FAILED) ? fs.readdirSync(INBOX_FAILED) : [];
  assert.ok(failedEntries.some((e) => e.includes(rec.transferId)), "package moved under INBOX_FAILED");
});

test("daemon rejects a duplicate stockClipId with error stage duplicate", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-daemon-"));
  process.env.PLATELAB_ROOT = root;
  const { makeHandoff } = await import("./helpers/makeHandoff.js");
  const { createTransfer, updateTransfer, getTransfer } = await import("@platelab/shared/server");
  const { processTransfer } = await import("../src/daemon.js");
  const { INBOX_INCOMING, TRANSFERS_DIR } = await import("../src/paths.js");

  const CLIP = "SPH-STK-20260708-GLENDORA-003-CLIP-0001";

  // First handoff: clip goes to draft.
  const handoffId1 = "SPH-STK-20260708-GLENDORA-003-web";
  const dir1 = path.join(INBOX_INCOMING, handoffId1);
  fs.mkdirSync(dir1, { recursive: true });
  await makeHandoff(dir1, { clips: [{ stockClipId: CLIP }] });
  const rec1 = createTransfer(TRANSFERS_DIR, {
    handoffId: handoffId1, bytes: 1000, manifestSha256: "0".repeat(64), clipCount: 1,
  });
  updateTransfer(TRANSFERS_DIR, rec1.transferId, { state: "uploaded" });
  await processTransfer(rec1.transferId);
  const done1 = getTransfer(TRANSFERS_DIR, rec1.transferId)!;
  assert.equal(done1.clips[0].state, "draft");

  // Second handoff: same stockClipId, different handoffId.
  const handoffId2 = "SPH-STK-20260708-GLENDORA-003-web-2";
  const dir2 = path.join(INBOX_INCOMING, handoffId2);
  fs.mkdirSync(dir2, { recursive: true });
  await makeHandoff(dir2, { clips: [{ stockClipId: CLIP }] });
  const rec2 = createTransfer(TRANSFERS_DIR, {
    handoffId: handoffId2, bytes: 1000, manifestSha256: "1".repeat(64), clipCount: 1,
  });
  updateTransfer(TRANSFERS_DIR, rec2.transferId, { state: "uploaded" });
  await processTransfer(rec2.transferId);

  const done2 = getTransfer(TRANSFERS_DIR, rec2.transferId)!;
  const dupClip = done2.clips.find((c) => c.stockClipId === CLIP)!;
  assert.equal(dupClip.state, "failed");
  assert.equal(dupClip.error!.stage, "duplicate");
});

test("recoverStale resets clips/transfers stuck in verifying/ingesting back to queued/uploaded", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tpl-daemon-"));
  process.env.PLATELAB_ROOT = root;
  const { createTransfer, updateTransfer, getTransfer } = await import("@platelab/shared/server");
  const { recoverStale } = await import("../src/daemon.js");
  const { TRANSFERS_DIR } = await import("../src/paths.js");

  const handoffId = "SPH-STK-20260708-GLENDORA-004-web";
  const rec = createTransfer(TRANSFERS_DIR, {
    handoffId, bytes: 1000, manifestSha256: "0".repeat(64), clipCount: 2,
  });
  updateTransfer(TRANSFERS_DIR, rec.transferId, {
    state: "ingesting",
    clips: [
      { stockClipId: "STUCK-CLIP", state: "ingesting" },
      { stockClipId: "DRAFT-CLIP", state: "draft", sku: "PL-0000001" },
    ],
  });

  recoverStale();

  const after = getTransfer(TRANSFERS_DIR, rec.transferId)!;
  assert.equal(after.state, "uploaded");
  const stuck = after.clips.find((c) => c.stockClipId === "STUCK-CLIP")!;
  assert.equal(stuck.state, "queued");
  const draft = after.clips.find((c) => c.stockClipId === "DRAFT-CLIP")!;
  assert.equal(draft.state, "draft");
  assert.equal(draft.sku, "PL-0000001");
});
