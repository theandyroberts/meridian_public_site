import Link from "next/link";
import crypto from "node:crypto";
import { notFound } from "next/navigation";
import { getPlate, getLivePlates, formatDuration } from "@/lib/catalog";
import { SyncedPlayer } from "@/components/SyncedPlayer";
import { GpsPanel } from "@/components/GpsPanel";
import { PriceBlock } from "@/components/PriceBlock";
import { PlateCard } from "@/components/PlateCard";

export const dynamic = "force-dynamic";

function validPreviewSig(sku: string, exp?: string, sig?: string): boolean {
  const secret = process.env.PLATELAB_SCREENER_SECRET;
  if (!secret || !exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${sku}.${exp}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function PlatePage({
  params,
  searchParams,
}: {
  params: Promise<{ sku: string }>;
  searchParams: Promise<{ exp?: string; sig?: string }>;
}) {
  const { sku } = await params;
  const plate = getPlate(sku);
  if (!plate) notFound();
  if (plate.status === "draft") {
    const { exp, sig } = await searchParams;
    if (!validPreviewSig(sku, exp, sig)) notFound();
  }

  const related = getLivePlates()
    .filter(
      (p) =>
        p.sku !== plate.sku &&
        (p.shotType === plate.shotType || p.timeOfDay === plate.timeOfDay),
    )
    .slice(0, 3);

  const stageLabels: Record<string, string> = {
    "led-volume": "LED Volume",
    "green-screen": "Green Screen",
    projection: "Projection",
  };

  return (
    <main className="wrap">
      <div className="detail-head">
        <div>
          <div className="crumbs mono dimmer">
            <Link href="/browse">Plates</Link>
            <span>/</span>
            <span className="accent">{plate.sku}</span>
          </div>
          <h1>{plate.title}</h1>
        </div>
        <div className="mono dim" style={{ textAlign: "right", lineHeight: 2 }}>
          {plate.location.name} · {plate.location.city}, {plate.location.region}
          <br />
          Shot {plate.shootDate} · Rig {plate.rig} ·{" "}
          {formatDuration(plate.media.durationSec)}
        </div>
      </div>

      <SyncedPlayer plate={plate} />

      <div className="detail-cols">
        <div>
          <p style={{ fontSize: 18, maxWidth: "62ch", color: "var(--paper-60)" }}>
            {plate.description}
          </p>

          <div className="badges" style={{ marginTop: 24, display: "flex", gap: 8 }}>
            {plate.stageCompat.map((s) => (
              <span key={s} className="badge">
                ● {stageLabels[s]}
              </span>
            ))}
            {plate.imu.collected && <span className="badge imu">IMU data</span>}
            <span className="badge">{plate.availability}</span>
          </div>

          <div className="spec-block" style={{ marginTop: 48 }}>
            <h2>Technical</h2>
            <span className="mono block-label">As-delivered master specs</span>
            <table className="spec-table">
              <tbody>
                <tr>
                  <td>SKU</td>
                  <td>{plate.sku}</td>
                </tr>
                <tr>
                  <td>Stitched master</td>
                  <td>
                    {plate.media.stitchedResolution} equirect ·{" "}
                    {plate.media.masterFormat}
                  </td>
                </tr>
                <tr>
                  <td>Color pipeline</td>
                  <td>{plate.media.colorPipeline}</td>
                </tr>
                <tr>
                  <td>Frame rate</td>
                  <td>{plate.media.fps} fps</td>
                </tr>
                <tr>
                  <td>Runtime</td>
                  <td>
                    {formatDuration(plate.media.durationSec)} (
                    {Math.round(plate.media.durationSec)}s)
                  </td>
                </tr>
                <tr>
                  <td>Camera originals</td>
                  <td>{plate.media.cameraOriginals}</td>
                </tr>
                {plate.media.timecode && (
                  <tr>
                    <td>Start TC</td>
                    <td>{plate.media.timecode}</td>
                  </tr>
                )}
                <tr>
                  <td>Master checksum</td>
                  <td style={{ wordBreak: "break-all" }}>
                    sha256:{plate.security.masterSha256.slice(0, 16)}…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="spec-block" style={{ marginTop: 48 }}>
            <h2>Detected objects</h2>
            <span className="mono block-label">
              Automated labeling run · confidence
            </span>
            <div className="objects-list">
              {plate.objects.map((o) => (
                <div className="object-row" key={o.label}>
                  <span className="label">{o.label}</span>
                  <span className="bar">
                    <i style={{ width: `${o.confidence * 100}%` }} />
                  </span>
                  <span className="conf">{Math.round(o.confidence * 100)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="spec-block" style={{ marginTop: 48 }}>
            <h2>Tags</h2>
            <span className="mono block-label">Click to find similar</span>
            <div className="tag-cloud">
              {plate.tags.map((t) => (
                <Link
                  key={t}
                  className="filter-chip"
                  href={`/browse?tag=${encodeURIComponent(t)}`}
                >
                  {t}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="side-stack">
          <PriceBlock plate={plate} />
          {plate.gps && <GpsPanel gps={plate.gps} plate={plate} />}
        </div>
      </div>

      {related.length > 0 && (
        <section className="related">
          <div className="section-head">
            <h2>Similar plates</h2>
            <Link href="/browse" className="mono dim">
              Browse all →
            </Link>
          </div>
          <div className="plate-grid">
            {related.map((p) => (
              <PlateCard key={p.sku} plate={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
