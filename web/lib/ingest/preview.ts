import crypto from "node:crypto";

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

/**
 * Mint a signed preview path for a draft plate's SKU, using the same HMAC
 * construction as validPreviewSig in web/app/plate/[sku]/page.tsx (sha256
 * HMAC of "<sku>.<exp>" keyed by PLATELAB_SCREENER_SECRET). Draft plates
 * 404 without a valid signature, so any preview link handed back to MMM
 * must carry one.
 *
 * `now` is injectable for deterministic tests; defaults to Date.now().
 */
export function mintPreviewPath(sku: string, secret: string, now: number = Date.now()): string {
  const exp = Math.floor(now / 1000) + SEVEN_DAYS_SEC;
  const sig = crypto.createHmac("sha256", secret).update(`${sku}.${exp}`).digest("hex");
  return `/plate/${sku}?exp=${exp}&sig=${sig}`;
}
