import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_COOKIE, verifySessionCookie } from "@/lib/admin/sessionCore";

/**
 * Review actions for stitch reports: approve / request changes / add a note.
 * State lives next to the published report (web/data/stitch-reports/<run>/):
 *   status.json  { state: "approved"|"changes-requested", by, at, note }
 *   notes.json   [ { by, at, note }, ... ]
 * The gallery and the report page both read these; the promotion flow checks
 * status.json on the server before any site swap.
 */

const REPORTS_ROOT = path.join(process.cwd(), "data", "stitch-reports");

export async function POST(req: Request) {
  const jar = await cookies();
  const session = jar.get(ADMIN_COOKIE)?.value;
  if (!session || !verifySessionCookie(session)) {
    return NextResponse.json({ error: "admin session required" }, { status: 401 });
  }

  let body: { run?: string; action?: string; by?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { run, action, by, note } = body;
  if (!run || !action || !by?.trim()) {
    return NextResponse.json({ error: "run, action, by required" }, { status: 400 });
  }
  const runDir = path.resolve(path.join(REPORTS_ROOT, run));
  if (!runDir.startsWith(path.resolve(REPORTS_ROOT) + path.sep) || !fs.existsSync(runDir)) {
    return NextResponse.json({ error: "unknown run" }, { status: 404 });
  }

  const at = new Date().toISOString();
  const entry = { by: by.trim(), at, note: (note ?? "").trim() };

  if (action === "note") {
    if (!entry.note) return NextResponse.json({ error: "empty note" }, { status: 400 });
  } else if (action === "approve" || action === "request-changes") {
    const status = {
      state: action === "approve" ? "approved" : "changes-requested",
      ...entry,
    };
    fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify(status, null, 2));
    // keep legacy approved.json in sync for older tooling
    if (action === "approve") {
      fs.writeFileSync(
        path.join(runDir, "approved.json"),
        JSON.stringify({ approvedBy: entry.by, at, note: entry.note }, null, 2),
      );
    } else {
      fs.rmSync(path.join(runDir, "approved.json"), { force: true });
    }
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  if (entry.note || action === "note") {
    const notesPath = path.join(runDir, "notes.json");
    let notes: unknown[] = [];
    try {
      notes = JSON.parse(fs.readFileSync(notesPath, "utf8"));
    } catch {
      /* first note */
    }
    notes.push({ ...entry, action });
    fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2));
  }

  return NextResponse.json({ ok: true, action, at });
}
