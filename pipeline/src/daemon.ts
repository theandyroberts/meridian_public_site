import fs from "node:fs";
import path from "node:path";
import {
  getTransfer, listTransfers, updateTransfer,
  type TransferRecord, type ClipRecord,
} from "@platelab/shared/server";
import { audit } from "./audit.js";
import {
  TRANSFERS_DIR, INBOX_INCOMING, INBOX_ARCHIVE, INBOX_FAILED,
} from "./paths.js";
import { verifyHandoff, HandoffVerifyError } from "./mmm/verify.js";
import { adaptClip, ClipAdaptError } from "./mmm/adapter.js";
import { assignSku } from "./mmm/skuLedger.js";
import { ingestDiscovered } from "./ingest.js";
import { loadCatalog } from "./stages/publish.js";
import { notifyHandoffComplete, notifyHandoffFailed } from "./notify.js";

const POLL_MS = 3000;
const ARCHIVE_DAYS = 14;

function setClip(id: string, stockClipId: string, patch: Partial<ClipRecord>): void {
  updateTransfer(TRANSFERS_DIR, id, (rec) => ({
    ...rec,
    clips: rec.clips.map((c) => (c.stockClipId === stockClipId ? { ...c, ...patch } : c)),
  }));
}

/** Process one uploaded transfer to a terminal state. Exported for tests. */
export async function processTransfer(transferId: string): Promise<void> {
  const rec = getTransfer(TRANSFERS_DIR, transferId);
  if (!rec) return;
  const handoffDir = [
    path.join(INBOX_INCOMING, rec.handoffId),
    path.join(INBOX_ARCHIVE, rec.transferId),
  ].find(fs.existsSync) ?? path.join(INBOX_INCOMING, rec.handoffId);
  const alreadyArchived = handoffDir === path.join(INBOX_ARCHIVE, rec.transferId);

  updateTransfer(TRANSFERS_DIR, transferId, { state: "verifying" });
  audit("daemon.verify.start", { transferId, handoffId: rec.handoffId });

  let manifest;
  try {
    manifest = await verifyHandoff(handoffDir);
  } catch (err) {
    const e = err as HandoffVerifyError;
    updateTransfer(TRANSFERS_DIR, transferId, {
      state: "failed", error: { code: e.code ?? "manifest", message: e.message },
    });
    if (fs.existsSync(handoffDir)) {
      fs.mkdirSync(INBOX_FAILED, { recursive: true });
      fs.renameSync(handoffDir, path.join(INBOX_FAILED, `${transferId}-${rec.handoffId}`));
    }
    audit("daemon.verify.failed", { transferId, error: e.message });
    await notifyHandoffFailed(rec, e.message);
    return;
  }

  // Seed clip records on first pass; retries keep prior per-clip states.
  let current = getTransfer(TRANSFERS_DIR, transferId)!;
  if (current.clips.length === 0) {
    current = updateTransfer(TRANSFERS_DIR, transferId, {
      clips: [
        ...manifest.clips.map((c): ClipRecord => ({ stockClipId: c.stock_clip_id, state: "queued" })),
        ...manifest.excluded_clips.map((c): ClipRecord => ({
          stockClipId: c.stock_clip_id, state: "excluded",
          error: { stage: c.reason, message: c.detail },
        })),
      ],
    });
  }

  updateTransfer(TRANSFERS_DIR, transferId, { state: "ingesting" });
  const catalogIds = new Set(
    loadCatalog().plates.map((p) => p.mmm?.stockClipId).filter(Boolean),
  );

  for (const clipRec of current.clips.filter((c) => c.state === "queued")) {
    const clip = manifest.clips.find((c) => c.stock_clip_id === clipRec.stockClipId);
    if (!clip) continue;
    if (catalogIds.has(clip.stock_clip_id)) {
      setClip(transferId, clip.stock_clip_id, {
        state: "failed",
        error: { stage: "duplicate", message: "stockClipId already in catalog" },
      });
      audit("daemon.clip.failed", {
        transferId, stockClipId: clip.stock_clip_id, stage: "duplicate",
        message: "stockClipId already in catalog",
      });
      continue;
    }
    setClip(transferId, clip.stock_clip_id, { state: "verifying" });
    try {
      const { drop, stockClipId } = adaptClip(handoffDir, clip);
      setClip(transferId, stockClipId, { state: "ingesting" });
      const plate = await ingestDiscovered(drop, {
        sku: assignSku(), status: "draft", stockClipId,
      });
      setClip(transferId, stockClipId, { state: "draft", sku: plate.sku });
      audit("daemon.clip.draft", { transferId, stockClipId, sku: plate.sku });
    } catch (err) {
      const stage = err instanceof ClipAdaptError ? err.stage : "ingest";
      setClip(transferId, clip.stock_clip_id, {
        state: "failed", error: { stage, message: (err as Error).message },
      });
      audit("daemon.clip.failed", { transferId, stockClipId: clip.stock_clip_id, stage, message: (err as Error).message });
    }
  }

  const final = updateTransfer(TRANSFERS_DIR, transferId, { state: "complete" });
  fs.mkdirSync(INBOX_ARCHIVE, { recursive: true });
  if (!alreadyArchived && fs.existsSync(handoffDir)) {
    fs.renameSync(handoffDir, path.join(INBOX_ARCHIVE, transferId));
  }
  audit("daemon.complete", {
    transferId,
    drafted: final.clips.filter((c) => c.state === "draft").length,
    failed: final.clips.filter((c) => c.state === "failed").length,
  });
  await notifyHandoffComplete(final);
}

function pruneArchive(): void {
  if (!fs.existsSync(INBOX_ARCHIVE)) return;
  const cutoff = Date.now() - ARCHIVE_DAYS * 86_400_000;
  for (const entry of fs.readdirSync(INBOX_ARCHIVE)) {
    const p = path.join(INBOX_ARCHIVE, entry);
    if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
  }
}

/**
 * A daemon crash mid-processing can leave a transfer stuck in "verifying" or
 * "ingesting" forever, since the poll loop only re-picks "uploaded" transfers.
 * Run once at startup: reset any clips stuck in "verifying"/"ingesting" back
 * to "queued" (draft/failed/excluded are left untouched) and put the transfer
 * back to "uploaded" so the loop re-picks it.
 *
 * Known rare edge: a crash between publishPlate() writing the plate to the
 * catalog and the clip-state write persisting "draft" will re-run that clip
 * on recovery, which trips the duplicate check in processTransfer and yields
 * a visible failed(duplicate) on the dashboard. That's an acceptable outcome
 * for a human to resolve — consistent with the dashboard-as-source-of-truth
 * design, rather than trying to make recovery perfectly transactional here.
 */
export function recoverStale(): void {
  const stuckStates = new Set(["verifying", "ingesting"]);
  for (const t of listTransfers(TRANSFERS_DIR)) {
    if (!stuckStates.has(t.state)) continue;
    updateTransfer(TRANSFERS_DIR, t.transferId, (rec) => ({
      ...rec,
      state: "uploaded",
      clips: rec.clips.map((c) =>
        stuckStates.has(c.state) ? { ...c, state: "queued" } : c),
    }));
    audit("daemon.recover.stale", { transferId: t.transferId });
  }
}

export async function runDaemon(): Promise<never> {
  audit("daemon.start", { pid: process.pid });
  pruneArchive();
  recoverStale();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const next = listTransfers(TRANSFERS_DIR)
      .filter((t) => t.state === "uploaded")
      .sort((a, b) => a.announcedAt.localeCompare(b.announcedAt))[0];
    if (next) {
      try { await processTransfer(next.transferId); }
      catch (err) {
        updateTransfer(TRANSFERS_DIR, next.transferId, {
          state: "failed", error: { code: "daemon", message: (err as Error).message },
        });
        audit("daemon.error", { transferId: next.transferId, message: (err as Error).message });
      }
    } else {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

if (process.argv[1]?.endsWith("daemon.ts") || process.argv[1]?.endsWith("daemon.js")) {
  runDaemon().catch((err) => { console.error(err); process.exit(1); });
}
