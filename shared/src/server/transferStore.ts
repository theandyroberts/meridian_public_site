import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * One JSON file per transfer under <dir>. This is THE single source of
 * truth for handoff status: the daemon writes it, the MMM-facing API and
 * the admin dashboard read it. Writes are atomic (tmp + rename).
 */

export type TransferState =
  | "announced" | "uploaded" | "verifying" | "ingesting" | "complete" | "failed";
export type ClipState =
  | "queued" | "verifying" | "ingesting" | "draft" | "failed" | "excluded";

export interface ClipRecord {
  stockClipId: string;
  state: ClipState;
  sku?: string;
  error?: { stage: string; message: string };
}

export interface TransferRecord {
  transferId: string;
  handoffId: string;
  bytes: number;
  manifestSha256: string;
  clipCount: number;
  state: TransferState;
  error?: { code: string; message: string };
  clips: ClipRecord[];
  announcedAt: string;
  uploadedAt?: string;
  updatedAt: string;
}

export class DuplicateHandoffError extends Error {
  constructor(handoffId: string) { super(`handoff already active: ${handoffId}`); }
}

const NON_TERMINAL: TransferState[] = ["announced", "uploaded", "verifying", "ingesting"];
const file = (dir: string, id: string) => path.join(dir, `${id}.json`);

function write(dir: string, rec: TransferRecord): void {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file(dir, rec.transferId) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, file(dir, rec.transferId));
}

export function getTransfer(dir: string, id: string): TransferRecord | undefined {
  const p = file(dir, id);
  if (!/^t-[0-9a-f]{8}$/.test(id) || !fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, "utf8")) as TransferRecord;
}

export function listTransfers(dir: string): TransferRecord[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as TransferRecord)
    .sort((a, b) => b.announcedAt.localeCompare(a.announcedAt));
}

export function createTransfer(
  dir: string,
  input: { handoffId: string; bytes: number; manifestSha256: string; clipCount: number },
): TransferRecord {
  const existing = listTransfers(dir).find((t) => t.handoffId === input.handoffId);
  if (existing && existing.state !== "failed") throw new DuplicateHandoffError(input.handoffId);
  if (existing) fs.rmSync(file(dir, existing.transferId));
  const now = new Date().toISOString();
  const rec: TransferRecord = {
    transferId: `t-${crypto.randomBytes(4).toString("hex")}`,
    ...input,
    state: "announced",
    clips: [],
    announcedAt: now,
    updatedAt: now,
  };
  write(dir, rec);
  return rec;
}

export function updateTransfer(
  dir: string,
  id: string,
  patch: Partial<TransferRecord> | ((rec: TransferRecord) => TransferRecord),
): TransferRecord {
  const rec = getTransfer(dir, id);
  if (!rec) throw new Error(`unknown transfer: ${id}`);
  const next = typeof patch === "function" ? patch(rec) : { ...rec, ...patch };
  next.updatedAt = new Date().toISOString();
  write(dir, next);
  return next;
}

export function reservedBytes(dir: string): number {
  return listTransfers(dir)
    .filter((t) => NON_TERMINAL.includes(t.state))
    .reduce((sum, t) => sum + t.bytes, 0);
}
