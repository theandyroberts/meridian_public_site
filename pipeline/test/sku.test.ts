import test from "node:test";
import assert from "node:assert/strict";
import { dammCheckDigit, makeRandomSku, isValidSku, SKU_REGEX } from "@platelab/shared";

test("damm check digit: known values and self-check property", () => {
  // Verified against the standard Damm quasigroup table.
  assert.equal(dammCheckDigit("483920"), 8);
  assert.equal(dammCheckDigit("100000"), 2);
  assert.equal(dammCheckDigit("999999"), 0);
  // Appending the check digit always yields interim digit 0.
  for (const base of ["483920", "100000", "999999", "572431"]) {
    assert.equal(dammCheckDigit(base + String(dammCheckDigit(base))), 0);
  }
  assert.throws(() => dammCheckDigit("12a4"));
  assert.throws(() => dammCheckDigit(""));
});

test("makeRandomSku: format, range, deterministic with injected rng", () => {
  const sku = makeRandomSku(() => 0.5);
  assert.match(sku, SKU_REGEX);
  // rng 0.5 → base 100000 + floor(0.5*900000) = 550000; damm(550000) computed by lib
  assert.equal(sku.slice(0, 9), `PL-550000`.slice(0, 9));
  assert.equal(isValidSku(sku), true);
});

test("isValidSku: rejects bad check digit, transpositions, format", () => {
  assert.equal(isValidSku("PL-4839208"), true);
  assert.equal(isValidSku("PL-4839207"), false); // wrong check digit
  assert.equal(isValidSku("PL-4893208"), false); // adjacent transposition
  assert.equal(isValidSku("PL-483920"), false);  // 6 digits
  assert.equal(isValidSku("PL26161-0042"), false); // legacy format
  assert.equal(isValidSku("pl-4839208"), false);
});
