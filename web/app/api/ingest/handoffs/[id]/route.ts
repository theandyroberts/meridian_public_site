import { NextResponse } from "next/server";
import { getTransfer } from "@platelab/shared/server";
import { checkBearer } from "@/lib/ingest/auth";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkBearer(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const rec = getTransfer(TRANSFERS_DIR, id);
  if (!rec) return NextResponse.json({ error: "unknown transfer" }, { status: 404 });
  return NextResponse.json({
    transferId: rec.transferId,
    handoffId: rec.handoffId,
    state: rec.state,
    error: rec.error,
    clips: rec.clips.map((c) => ({
      stockClipId: c.stockClipId,
      state: c.state,
      sku: c.sku,
      preview: c.sku ? `/plate/${c.sku}` : undefined,
      error: c.error,
    })),
  });
}
