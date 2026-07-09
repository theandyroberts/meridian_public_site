/**
 * Retail SKU: "PL-" + 6 random digits + 1 Damm check digit → PL-4839208.
 * Opaque by design: no dates, locations, or sequence (sequential serials
 * leak catalog size/growth — German tank problem). The Damm check digit
 * catches any single mistyped digit and any adjacent transposition; every
 * surface that accepts a typed SKU must call isValidSku() before lookup.
 */

export const SKU_REGEX = /^PL-\d{7}$/;

// Damm quasigroup table (standard, weakly totally anti-symmetric).
const DAMM: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

export function dammCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error(`digits only: "${digits}"`);
  let interim = 0;
  for (const ch of digits) interim = DAMM[interim][Number(ch)];
  return interim;
}

/** Random SKU. Inject rng for tests; collision checking is the ledger's job. */
export function makeRandomSku(rng: () => number = Math.random): string {
  const base = 100000 + Math.floor(rng() * 900000); // 100000..999999
  return `PL-${base}${dammCheckDigit(String(base))}`;
}

export function isValidSku(sku: string): boolean {
  if (!SKU_REGEX.test(sku)) return false;
  return dammCheckDigit(sku.slice(3)) === 0;
}
