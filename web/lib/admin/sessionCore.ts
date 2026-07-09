import crypto from "node:crypto";

export const ADMIN_COOKIE = "tpl_admin";
const TTL_SECONDS = 7 * 86400;

function secret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("ADMIN_PASSWORD not configured");
  return s;
}

const hmac = (payload: string) =>
  crypto.createHmac("sha256", secret()).update(payload).digest("hex");

export function createSessionCookie(now = Math.floor(Date.now() / 1000)): string {
  const exp = now + TTL_SECONDS;
  return `${exp}.${hmac(String(exp))}`;
}

export function verifySessionCookie(value: string, now = Math.floor(Date.now() / 1000)): boolean {
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < now) return false;
  const a = Buffer.from(sig, "hex"); const b = Buffer.from(hmac(exp), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function checkPassword(candidate: string): boolean {
  const a = Buffer.from(candidate); const b = Buffer.from(secret());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
