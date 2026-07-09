import fs from "node:fs";
import { NextResponse } from "next/server";
import { createTransfer, reservedBytes, DuplicateHandoffError } from "@platelab/shared/server";
import { checkBearer } from "@/lib/ingest/auth";
import { announceBodySchema, checkDiskGuard } from "@/lib/ingest/announce";
import { TRANSFERS_DIR, INBOX_INCOMING } from "@/lib/ingest/paths";

export async function POST(req: Request) {
  if (!checkBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const parsed = announceBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  fs.mkdirSync(INBOX_INCOMING, { recursive: true });
  const stat = fs.statfsSync(INBOX_INCOMING);
  const free = stat.bavail * stat.bsize;
  if (!checkDiskGuard(free, reservedBytes(TRANSFERS_DIR), parsed.data.bytes)) {
    return NextResponse.json({ error: "insufficient disk for transfer" }, { status: 507 });
  }
  try {
    const rec = createTransfer(TRANSFERS_DIR, parsed.data);
    return NextResponse.json({ transferId: rec.transferId }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateHandoffError) {
      return NextResponse.json({ error: "handoff already active or ingested" }, { status: 409 });
    }
    throw err;
  }
}
