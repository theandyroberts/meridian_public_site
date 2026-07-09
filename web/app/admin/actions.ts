"use server";
import { revalidatePath } from "next/cache";
import { updateTransfer } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export async function retryClip(transferId: string, stockClipId: string): Promise<void> {
  await requireAdmin();
  updateTransfer(TRANSFERS_DIR, transferId, (rec) => {
    const clip = rec.clips.find((c) => c.stockClipId === stockClipId);
    if (clip?.state !== "failed") {
      return rec;
    }
    return {
      ...rec,
      state: "uploaded", // daemon re-picks; only `queued` clips are processed
      error: undefined,
      clips: rec.clips.map((c) =>
        c.stockClipId === stockClipId ? { ...c, state: "queued", error: undefined } : c),
    };
  });
  revalidatePath(`/admin/handoffs/${transferId}`);
}

export async function reverifyHandoff(transferId: string): Promise<void> {
  await requireAdmin();
  updateTransfer(TRANSFERS_DIR, transferId, (rec) => {
    const hasFailedClips = rec.clips.some((c) => c.state === "failed");
    if (rec.state !== "failed" && !hasFailedClips) {
      return rec;
    }
    return {
      ...rec,
      state: "uploaded",
      error: undefined,
      clips: rec.clips.map((c) => (c.state === "failed" ? { ...c, state: "queued", error: undefined } : c)),
    };
  });
  revalidatePath(`/admin/handoffs/${transferId}`);
}
