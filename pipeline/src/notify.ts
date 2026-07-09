import nodemailer from "nodemailer";
import type { TransferRecord } from "@platelab/shared/server";

/**
 * Notifications point at the dashboard; they never carry state of their own.
 * The dashboard (/admin/handoffs/<id>) is the single source of truth.
 */

export function buildSummary(rec: TransferRecord): { subject: string; text: string } {
  const drafted = rec.clips.filter((c) => c.state === "draft").length;
  const failed = rec.clips.filter((c) => c.state === "failed").length;
  const base = process.env.PLATELAB_PUBLIC_URL ?? "";
  const subject = `[Plate Lab] ${rec.handoffId}: ${drafted} drafted, ${failed} failed`;
  const text = [
    `Handoff ${rec.handoffId} finished: ${rec.clipCount} clips — ${drafted} drafted, ${failed} failed.`,
    ``,
    `Status and actions (single source of truth):`,
    `${base}/admin/handoffs/${rec.transferId}`,
    drafted > 0 ? `Review drafts: ${base}/admin/drafts` : ``,
  ].filter(Boolean).join("\n");
  return { subject, text };
}

async function send(subject: string, text: string): Promise<void> {
  const { SMTP_URL, NOTIFY_EMAIL_TO, NOTIFY_EMAIL_FROM } = process.env;
  if (!SMTP_URL || !NOTIFY_EMAIL_TO || !NOTIFY_EMAIL_FROM) {
    console.log(`[notify:log-only] ${subject}\n${text}`);
    return;
  }
  try {
    await nodemailer.createTransport(SMTP_URL).sendMail({
      from: NOTIFY_EMAIL_FROM, to: NOTIFY_EMAIL_TO, subject, text,
    });
  } catch (err) {
    console.error(`[notify] email failed: ${(err as Error).message}`); // never block ingest
  }
}

export async function notifyHandoffComplete(rec: TransferRecord): Promise<void> {
  const { subject, text } = buildSummary(rec);
  await send(subject, text);
}

export async function notifyHandoffFailed(rec: TransferRecord, message: string): Promise<void> {
  const base = process.env.PLATELAB_PUBLIC_URL ?? "";
  await send(
    `[Plate Lab] ${rec.handoffId}: handoff FAILED`,
    `Handoff ${rec.handoffId} failed verification: ${message}\n\n${base}/admin/handoffs/${rec.transferId}`,
  );
}
