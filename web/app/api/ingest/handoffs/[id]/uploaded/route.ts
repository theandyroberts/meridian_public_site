import { NextResponse } from "next/server";
import { getTransfer, updateTransfer } from "@platelab/shared/server";
import { checkBearer } from "@/lib/ingest/auth";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const rec = getTransfer(TRANSFERS_DIR, id);
  if (!rec) return NextResponse.json({ error: "unknown transfer" }, { status: 404 });
  if (rec.state !== "announced") {
    return NextResponse.json({ error: `not awaiting upload (state: ${rec.state})` }, { status: 409 });
  }
  updateTransfer(TRANSFERS_DIR, id, { state: "uploaded", uploadedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
