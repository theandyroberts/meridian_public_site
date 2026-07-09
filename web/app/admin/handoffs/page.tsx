import Link from "next/link";
import { listTransfers } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";

export const dynamic = "force-dynamic";
export const metadata = { title: "Handoffs — TPL Admin" };

export default async function HandoffsPage() {
  await requireAdmin();
  const transfers = listTransfers(TRANSFERS_DIR);
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <div className="section-head">
        <h2>Ingest handoffs</h2>
        <Link className="mono dim" href="/admin/drafts">Draft queue →</Link>
      </div>
      {transfers.length === 0 && <div className="empty-state"><p className="mono">No transfers yet</p></div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr className="mono dim" style={{ textAlign: "left" }}>
          <th>Handoff</th><th>State</th><th>Clips</th><th>Size</th><th>Announced</th>
        </tr></thead>
        <tbody>
          {transfers.map((t) => {
            const drafted = t.clips.filter((c) => c.state === "draft").length;
            const failed = t.clips.filter((c) => c.state === "failed").length;
            return (
              <tr key={t.transferId} style={{ borderTop: "1px solid var(--hairline)" }}>
                <td><Link href={`/admin/handoffs/${t.transferId}`} className="mono">{t.handoffId}</Link></td>
                <td className="mono" style={failed || t.state === "failed" ? { color: "var(--orange)" } : {}}>{t.state}</td>
                <td className="mono">{drafted}/{t.clipCount} drafted{failed ? `, ${failed} failed` : ""}</td>
                <td className="mono dim">{(t.bytes / 1e9).toFixed(1)} GB</td>
                <td className="mono dim">{t.announcedAt.slice(0, 16).replace("T", " ")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
