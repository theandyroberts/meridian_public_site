import test from "node:test";
import assert from "node:assert/strict";
import { announceBodySchema, checkDiskGuard } from "../lib/ingest/announce";

test("announce body validation", () => {
  const ok = announceBodySchema.safeParse({
    handoffId: "SPH-STK-20260708-GLENDORA-001-web",
    bytes: 1000, manifestSha256: "a".repeat(64), clipCount: 12,
  });
  assert.equal(ok.success, true);
  assert.equal(announceBodySchema.safeParse({ handoffId: "../etc", bytes: 1, manifestSha256: "a".repeat(64), clipCount: 1 }).success, false); // path-unsafe
  assert.equal(announceBodySchema.safeParse({ handoffId: "h", bytes: 0, manifestSha256: "a".repeat(64), clipCount: 1 }).success, false);
  assert.equal(announceBodySchema.safeParse({ handoffId: "h", bytes: 1, manifestSha256: "zz", clipCount: 1 }).success, false);
});

test("disk guard: reservation-aware 2.5x headroom", () => {
  assert.equal(checkDiskGuard(1000, 0, 100), true);   // 1000 ≥ 250
  assert.equal(checkDiskGuard(1000, 800, 100), false); // 200 < 250 after reservations
  assert.equal(checkDiskGuard(260, 0, 100), true);
  assert.equal(checkDiskGuard(240, 0, 100), false);
});
