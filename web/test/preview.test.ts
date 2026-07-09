import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mintPreviewPath } from "../lib/ingest/preview";

test("mintPreviewPath: path shape and sig verifies with the same HMAC construction", () => {
  const secret = "test-secret";
  const sku = "PL-4839208";
  const now = Date.parse("2026-07-08T00:00:00Z");
  const path = mintPreviewPath(sku, secret, now);

  const match = /^\/plate\/(PL-\d{7})\?exp=(\d+)&sig=([0-9a-f]+)$/.exec(path);
  assert.ok(match, `unexpected path shape: ${path}`);
  const [, pathSku, expStr, sig] = match!;
  assert.equal(pathSku, sku);

  const exp = Number(expStr);
  const nowSec = Math.floor(now / 1000);
  assert.equal(exp, nowSec + 7 * 24 * 60 * 60);

  // Same HMAC construction as validPreviewSig in web/app/plate/[sku]/page.tsx
  // and web/app/api/screener/route.ts: sha256 HMAC of "<sku>.<exp>".
  const expected = crypto.createHmac("sha256", secret).update(`${sku}.${exp}`).digest("hex");
  assert.equal(sig, expected);
});

test("mintPreviewPath: different secrets produce different signatures", () => {
  const now = Date.parse("2026-07-08T00:00:00Z");
  const a = mintPreviewPath("PL-4839208", "secret-a", now);
  const b = mintPreviewPath("PL-4839208", "secret-b", now);
  assert.notEqual(a, b);
});
