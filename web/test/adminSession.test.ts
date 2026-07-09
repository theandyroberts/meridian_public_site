import test from "node:test";
import assert from "node:assert/strict";
process.env.ADMIN_PASSWORD = "correct-horse";

test("session cookie round-trips and expires", async () => {
  const { createSessionCookie, verifySessionCookie } = await import("../lib/admin/sessionCore");
  const v = createSessionCookie(1_000_000);
  assert.equal(verifySessionCookie(v, 1_000_000), true);
  assert.equal(verifySessionCookie(v, 1_000_000 + 8 * 86400), false); // 8 days later
  assert.equal(verifySessionCookie("123.deadbeef", 1_000_000), false); // forged
});

test("password check is exact", async () => {
  const { checkPassword } = await import("../lib/admin/sessionCore");
  assert.equal(checkPassword("correct-horse"), true);
  assert.equal(checkPassword("wrong"), false);
  assert.equal(checkPassword(""), false);
});
