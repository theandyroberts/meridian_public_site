import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getPlate } from "@/lib/catalog";

/**
 * Screening-room access check. Sales mints a signed link offline
 * (pipeline/src/sign.ts); this route verifies signature + expiry before any
 * full-resolution master would be streamed. The demo returns the grant
 * decision; production would respond with a short-lived CDN URL.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sku = url.searchParams.get("sku") ?? "";
  const expiresAt = Number(url.searchParams.get("exp") ?? 0);
  const signature = url.searchParams.get("sig") ?? "";

  const secret = process.env.PLATELAB_SCREENER_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "screener not configured" }, { status: 503 });
  }
  if (!getPlate(sku)) {
    return NextResponse.json({ error: "unknown sku" }, { status: 404 });
  }
  if (expiresAt < Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: "link expired" }, { status: 403 });
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${sku}.${expiresAt}`)
    .digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "bad signature" }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    sku,
    grant: "screening-room access granted — production streams master here",
  });
}
