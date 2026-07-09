import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { requireAdmin } from "@/lib/admin/session";
import { publishPlateAction, rejectPlateAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drafts — TPL Admin" };

export default async function DraftsPage() {
  await requireAdmin();
  const drafts = getCatalog().plates.filter((p) => p.status === "draft");
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <div className="section-head">
        <h2>Draft plates ({drafts.length})</h2>
        <Link className="mono dim" href="/admin/handoffs">← handoffs</Link>
      </div>
      {drafts.length === 0 && <div className="empty-state"><p className="mono">Nothing pending</p></div>}
      <div className="plate-grid">
        {drafts.map((p) => (
          <div key={p.sku} style={{ border: "1px solid var(--hairline)", padding: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.renditions.poster} alt={p.title} style={{ width: "100%" }} />
            <p className="mono" style={{ margin: "10px 0 4px" }}>{p.sku} · {p.mmm?.stockClipId}</p>
            <h3>{p.title}</h3>
            <p className="dim" style={{ fontSize: 14, margin: "6px 0 12px" }}>{p.description}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <form action={publishPlateAction.bind(null, p.sku)}>
                <button className="cta mono" type="submit">Publish</button>
              </form>
              <form action={rejectPlateAction.bind(null, p.sku)} style={{ display: "flex", gap: 6 }}>
                <input className="search-input" name="reason" placeholder="reason" style={{ width: 140 }} />
                <button className="filter-chip" type="submit">Reject</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
