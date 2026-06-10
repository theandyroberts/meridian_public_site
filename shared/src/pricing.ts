/** $8,000 per stitched minute, prorated per second after a 1-minute minimum. */
export const PER_MINUTE_USD = 8000;
export const MINIMUM_MINUTES = 1;

export function priceForDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`invalid duration: ${durationSec}`);
  }
  const billableMinutes = Math.max(MINIMUM_MINUTES, durationSec / 60);
  // Prorate to the second, round to whole dollars.
  return Math.round(billableMinutes * PER_MINUTE_USD);
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}
