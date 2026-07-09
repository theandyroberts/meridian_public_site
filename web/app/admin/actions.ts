"use server";
import { revalidatePath } from "next/cache";
import { updateTransfer } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";
import { publishDraft, rejectDraft } from "@/lib/admin/catalogAdmin";

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

export async function publishPlateAction(sku: string): Promise<void> {
  await requireAdmin();
  publishDraft(sku);
  revalidatePath("/admin/drafts");
}

export async function rejectPlateAction(sku: string, formData: FormData): Promise<void> {
  await requireAdmin();
  rejectDraft(sku, String(formData.get("reason") ?? "rejected from admin"));
  revalidatePath("/admin/drafts");
}
