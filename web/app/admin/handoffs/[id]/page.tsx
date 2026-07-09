import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransfer } from "@platelab/shared/server";
import { requireAdmin } from "@/lib/admin/session";
import { TRANSFERS_DIR } from "@/lib/ingest/paths";
import { retryClip, reverifyHandoff } from "../../actions";

export const dynamic = "force-dynamic";

export default async function HandoffDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const t = getTransfer(TRANSFERS_DIR, id);
  if (!t) notFound();
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <p className="mono dim"><Link href="/admin/handoffs">← handoffs</Link></p>
      <h2 style={{ margin: "12px 0" }}>{t.handoffId}</h2>
      <p className="mono">state: {t.state}{t.error ? ` — ${t.error.code}: ${t.error.message}` : ""}</p>
      {t.state === "failed" && (
        <form action={reverifyHandoff.bind(null, t.transferId)} style={{ margin: "12px 0" }}>
          <button className="cta mono" type="submit">Re-verify (after re-send)</button>
        </form>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24 }}>
        <thead><tr className="mono dim" style={{ textAlign: "left" }}>
          <th>Stock clip ID</th><th>State</th><th>SKU</th><th>Error</th><th></th>
        </tr></thead>
        <tbody>
          {t.clips.map((c) => (
            <tr key={c.stockClipId} style={{ borderTop: "1px solid var(--hairline)" }}>
              <td className="mono">{c.stockClipId}</td>
              <td className="mono" style={c.state === "failed" ? { color: "var(--orange)" } : {}}>{c.state}</td>
              <td className="mono">{c.sku ? <Link href={`/plate/${c.sku}`}>{c.sku}</Link> : "—"}</td>
              <td className="mono dim">{c.error ? `${c.error.stage}: ${c.error.message}` : "—"}</td>
              <td>{c.state === "failed" && (
                <form action={retryClip.bind(null, t.transferId, c.stockClipId)}>
                  <button className="filter-chip" type="submit">Retry</button>
                </form>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
