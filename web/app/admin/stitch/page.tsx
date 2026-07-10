import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/admin/session";

export const metadata = { title: "Stitch reviews — TPL Admin" };
export const dynamic = "force-dynamic";

const REPORTS_ROOT = path.join(process.cwd(), "data", "stitch-reports");

interface RunSummary {
  name: string;
  drop: string;
  frames?: number;
  renderFps?: number;
  generatedAt?: string;
  approvedBy?: string;
  worstSeamDiff?: number;
}

function listRuns(): RunSummary[] {
  if (!fs.existsSync(REPORTS_ROOT)) return [];
  return fs
    .readdirSync(REPORTS_ROOT)
    .filter((d) => fs.existsSync(path.join(REPORTS_ROOT, d, "index.html")))
    .map((name) => {
      const run: RunSummary = { name, drop: name };
      try {
        const m = JSON.parse(
          fs.readFileSync(path.join(REPORTS_ROOT, name, "metrics.json"), "utf8"),
        );
        run.drop = path.basename(m.drop ?? name);
        run.frames = m.full_frames_rendered;
        run.renderFps = m.achieved_fps_full
          ? Math.round(m.achieved_fps_full * 100) / 100
          : undefined;
        run.worstSeamDiff = Math.max(
          ...(m.seams ?? []).map((s: any) => s.mean_abs_linear_diff ?? 0),
        );
      } catch {
        /* report still usable without metrics */
      }
      try {
        const a = JSON.parse(
          fs.readFileSync(path.join(REPORTS_ROOT, name, "approved.json"), "utf8"),
        );
        run.approvedBy = a.approvedBy;
      } catch {
        /* not approved yet */
      }
      try {
        run.generatedAt = fs
          .statSync(path.join(REPORTS_ROOT, name, "index.html"))
          .mtime.toISOString()
          .slice(0, 16)
          .replace("T", " ");
      } catch {
        /* optional */
      }
      return run;
    })
    .sort((a, b) => (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""));
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
              borderLeft: r.approvedBy ? "4px solid #4a7c59" : "4px solid #c56b3e",
              padding: "16px 20px",
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <strong>{r.drop}</strong>{" "}
            <span style={{ color: "#8a8780", fontSize: 13 }}>
              · {r.frames ?? "?"} frames
              {r.renderFps ? ` · rendered @ ${r.renderFps} fps` : ""}
              {r.generatedAt ? ` · ${r.generatedAt}` : ""}
            </span>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {r.approvedBy ? (
                <span style={{ color: "#7fb08a" }}>
                  ✓ approved by {r.approvedBy}
                </span>
              ) : (
                <span style={{ color: "#c56b3e" }}>awaiting sign-off</span>
              )}
            </div>
          </a>
        ))}
      </div>
    </main>
  );
}
