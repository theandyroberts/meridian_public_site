/**
 * SKU format: PL<yy><jjj>-<nnnn>
 *   yy   two-digit capture year
 *   jjj  Julian day of year (001-366)
 *   nnnn clip sequence within the shoot day
 * Example: PL26161-0042 — 42nd clip captured 2026-06-10.
 */

export function julianDay(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86_400_000);
}

export function makeSku(shootDate: string, sequence: number): string {
  const date = new Date(`${shootDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`bad shootDate: ${shootDate}`);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new Error(`bad sequence: ${sequence}`);
  }
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const jjj = String(julianDay(date)).padStart(3, "0");
  return `PL${yy}${jjj}-${String(sequence).padStart(4, "0")}`;
}

/** First free sequence number for the shoot day, given existing SKUs. */
export function nextSequence(shootDate: string, existing: Iterable<string>): number {
  const prefix = makeSku(shootDate, 1).slice(0, 7); // "PLyyjjj"
  let max = 0;
  for (const sku of existing) {
    if (sku.startsWith(prefix)) {
      max = Math.max(max, Number(sku.slice(8)));
    }
  }
  return max + 1;
}
