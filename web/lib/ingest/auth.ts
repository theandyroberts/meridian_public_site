import crypto from "node:crypto";

export function checkBearer(req: Request): boolean {
  const token = process.env.PLATELAB_INGEST_TOKEN;
  if (!token) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
