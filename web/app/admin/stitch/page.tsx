import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/admin/session";

export const metadata = { title: "Stitch reviews — TPL Admin" };
export const dynamic = "force-dynamic";

const REPORTS_ROOT = path.join(process.cwd(), "data", "stitch-reports");
const CATALOG_PATH = path.join(process.cwd(), "data", "catalog.json");

interface RunSummary {
  name: string;
  plateTitle?: string;
  sku?: string;
  drop: string;
  cameras?: number;
  version?: string;
  frames?: number;
  renderFps?: number;
  completedAt?: string;
  reviewState?: string;
  reviewBy?: string;
  reviewNote?: string;
  lastNote?: { by: string; at: string; note: string };
}

function catalogTitles(): Record<string, string> {
  try {
    const c = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
    return Object.fromEntries(c.plates.map((p: any) => [p.sku, p.title]));
  } catch {
    return {};
  }
}

function listRuns(): RunSummary[] {
  if (!fs.existsSync(REPORTS_ROOT)) return [];
  const titles = catalogTitles();
  return fs
    .readdirSync(REPORTS_ROOT)
    .filter((d) => fs.existsSync(path.join(REPORTS_ROOT, d, "index.html")))
    .map((name) => {
      const run: RunSummary = { name, drop: name };
      const read = (f: string) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(REPORTS_ROOT, name, f), "utf8"));
        } catch {
          return null;
        }
      };

      const m = read("metrics.json");
      if (m) {
        run.drop = path.basename(m.drop ?? name);
        run.frames = m.full_frames_rendered;
        run.renderFps = m.achieved_fps_full
          ? Math.round(m.achieved_fps_full * 100) / 100
          : undefined;
        run.cameras = m.cams ? Object.keys(m.cams).length : undefined;
      }
      // completion = when the master's metrics were finalized
      try {
        run.completedAt = fs
          .statSync(path.join(REPORTS_ROOT, name, "metrics.json"))
          .mtime.toISOString()
          .slice(0, 16)
          .replace("T", " ") + " UTC";
      } catch {
        /* optional */
      }

      const promoted = read("promoted.json");
      if (promoted) {
        run.sku = promoted.sku;
        run.version = promoted.label;
      } else if (run.cameras) {
        // not yet promoted — infer from the pipeline shape
        run.version =
          run.cameras === 9 ? "ALL-9 STITCH 1.0+3 (unpromoted)" : "RING STITCH 1.0 (unpromoted)";
      }
      if (run.sku && titles[run.sku]) run.plateTitle = titles[run.sku];

      const status = read("status.json");
      const approved = read("approved.json");
      if (status) {
        run.reviewState = status.state;
        run.reviewBy = status.by;
        run.reviewNote = status.note;
      } else if (approved) {
        run.reviewState = "approved";
        run.reviewBy = approved.approvedBy;
      }
      const notes = read("notes.json");
      if (Array.isArray(notes) && notes.length) run.lastNote = notes[notes.length - 1];
      return run;
    })
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
}

export default async function StitchReviewsPage() {
  await requireAdmin();
  const runs = listRuns();

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ borderBottom: "2px solid #c56b3e", paddingBottom: 12 }}>
        Stitch reviews
      </h1>
      <p style={{ color: "#8a8780", fontSize: 14 }}>
        True-stitch candidates awaiting sign-off. Reports contain unwatermarked
        preview footage — do not share links outside the team; viewers need an
        admin session.
      </p>
      {runs.length === 0 && (
        <p style={{ marginTop: 32 }}>
          No reports uploaded yet. Publish one with{" "}
          <code>pipeline/stitch/publish-report.sh &lt;run-dir&gt;</code>.
        </p>
      )}
      <div style={{ display: "grid", gap: 16, marginTop: 32 }}>
        {runs.map((r) => (
          <a
            key={r.name}
            href={`/api/admin/stitch/${encodeURIComponent(r.name)}/index.html`}
            style={{
              border: "1px solid #26262c",
              borderLeft:
                r.reviewState === "approved"
                  ? "4px solid #4a7c59"
                  : r.reviewState === "changes-requested"
                    ? "4px solid #a33d2e"
                    : "4px solid #c56b3e",
              padding: "16px 20px",
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <strong style={{ fontSize: 16 }}>
                {r.plateTitle ?? r.drop}
                {r.sku && (
                  <span style={{ color: "#c56b3e", fontWeight: 400 }}> · {r.sku}</span>
                )}
              </strong>
              <span
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  color: "#f4f1ea",
                  background: r.cameras === 9 ? "#3a2a14" : "#1f2733",
                  border: "1px solid #4a3a24",
                  padding: "3px 10px",
                  alignSelf: "center",
                }}
              >
                {r.cameras ? `${r.cameras} CAM` : "?"} · {r.version ?? "unknown version"}
              </span>
            </div>
            <div style={{ color: "#8a8780", fontSize: 13, marginTop: 8 }}>
              run <code>{r.name}</code> · {r.frames ?? "?"} frames
              {r.renderFps ? ` · rendered @ ${r.renderFps} fps` : ""}
              {r.completedAt ? ` · completed ${r.completedAt}` : ""}
            </div>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {r.reviewState === "approved" ? (
                <span style={{ color: "#7fb08a" }}>✓ approved by {r.reviewBy}</span>
              ) : r.reviewState === "changes-requested" ? (
                <span style={{ color: "#e06c4f" }}>✗ changes requested by {r.reviewBy}</span>
              ) : (
                <span style={{ color: "#c56b3e" }}>awaiting sign-off</span>
              )}
              {r.lastNote?.note && (
                <span style={{ color: "#8a8780" }}>
                  {" — "}“{r.lastNote.note.slice(0, 120)}{r.lastNote.note.length > 120 ? "…" : ""}”
                </span>
              )}
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
