import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getPlate } from "@/lib/catalog";

const RESERVATIONS = path.join(
  process.cwd(),
  "..",
  "sample-data",
  "reservations.jsonl",
);

/**
 * Demo reservation endpoint: validates the SKU and appends a 72h hold to a
 * JSONL log. Production swaps the log for a real orders store + notification.
 */
export async function POST(req: Request) {
  let body: { sku?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const plate = body.sku ? getPlate(body.sku) : undefined;
  if (!plate) {
    return NextResponse.json({ error: "unknown sku" }, { status: 404 });
  }
  if (plate.availability !== "available") {
    return NextResponse.json({ error: "not available" }, { status: 409 });
  }
  const hold = {
    sku: plate.sku,
    heldAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
  };
  fs.mkdirSync(path.dirname(RESERVATIONS), { recursive: true });
  fs.appendFileSync(RESERVATIONS, JSON.stringify(hold) + "\n");
  return NextResponse.json({ ok: true, hold });
}
