import crypto from "node:crypto";

/**
 * HMAC-signed expiring URLs for screening-room access to full-resolution
 * masters. The public site never links originals directly; a sales tool
 * mints one of these and the server route verifies before streaming.
 */

export interface SignedAccess {
  sku: string;
  expiresAt: number; // unix seconds
  signature: string;
}

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function signScreenerAccess(
  secret: string,
  sku: string,
  ttlSeconds = 3600,
  now = Math.floor(Date.now() / 1000),
): SignedAccess {
  const expiresAt = now + ttlSeconds;
  return { sku, expiresAt, signature: hmac(secret, `${sku}.${expiresAt}`) };
}

export function verifyScreenerAccess(
  secret: string,
  access: SignedAccess,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (access.expiresAt < now) return false;
  const expected = hmac(secret, `${access.sku}.${access.expiresAt}`);
  const a = Buffer.from(access.signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
