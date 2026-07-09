import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTransfer, getTransfer, listTransfers, updateTransfer, reservedBytes,
  DuplicateHandoffError,
} from "@platelab/shared/server";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tpl-transfers-"));

test("create/get/list/update round-trip with atomic persistence", () => {
  const dir = tmp();
  const t = createTransfer(dir, {
    handoffId: "SPH-STK-20260708-GLENDORA-001-web",
    bytes: 40_000_000_000, manifestSha256: "b".repeat(64), clipCount: 12,
  });
  assert.match(t.transferId, /^t-[0-9a-f]{8}$/);
  assert.equal(t.state, "announced");
  assert.equal(getTransfer(dir, t.transferId)?.handoffId, t.handoffId);
  const u = updateTransfer(dir, t.transferId, { state: "uploaded" });
  assert.equal(u.state, "uploaded");
  assert.equal(listTransfers(dir)[0].state, "uploaded");
});

test("duplicate handoffId: rejected while active, replaces a failed record", () => {
  const dir = tmp();
  const input = { handoffId: "h1", bytes: 10, manifestSha256: "c".repeat(64), clipCount: 1 };
  const t1 = createTransfer(dir, input);
  assert.throws(() => createTransfer(dir, input), DuplicateHandoffError);
  updateTransfer(dir, t1.transferId, { state: "failed" });
  const t2 = createTransfer(dir, input); // replaces failed
  assert.notEqual(t2.transferId, t1.transferId);
  assert.equal(listTransfers(dir).length, 1);
});

test("reservedBytes sums only non-terminal transfers (burst disk guard)", () => {
  const dir = tmp();
  const a = createTransfer(dir, { handoffId: "a", bytes: 100, manifestSha256: "d".repeat(64), clipCount: 1 });
  const b = createTransfer(dir, { handoffId: "b", bytes: 50, manifestSha256: "e".repeat(64), clipCount: 1 });
  assert.equal(reservedBytes(dir), 150);
  updateTransfer(dir, a.transferId, { state: "complete" });
  assert.equal(reservedBytes(dir), 50);
  updateTransfer(dir, b.transferId, { state: "failed" });
  assert.equal(reservedBytes(dir), 0);
});
