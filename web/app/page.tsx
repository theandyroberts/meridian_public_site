import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { GlobeMark } from "@/components/Logo";
import { PlateCard } from "@/components/PlateCard";
import { PER_MINUTE_USD, formatUsd } from "@platelab/shared";

export default function HomePage() {
  const { plates } = getCatalog();
  const featured = plates.slice(0, 6);
  const strip = plates.slice(0, 3);

  return (
    <main>
      <section className="hero">
        <div className="wrap" style={{ position: "relative" }}>
          <div className="hero-globe">
            <GlobeMark size={420} />
          </div>
          <p className="mono accent" style={{ marginBottom: 24 }}>
            360×180 Environments · VFX · LED Volumes · Virtual Production
          </p>
          <h1>
            More than <em>just plates.</em>
          </h1>
          <p className="sub">
            Full-dome driving environments captured on the Spheris 9-camera
            array — six-camera horizontal ring, three-camera sky tier, RTK GPS
            and fused IMU on every take. Pro-stitched, metadata-rich, ready for
            your volume.
          </p>
          <div className="hero-meta">
            <div>
              <strong>{formatUsd(PER_MINUTE_USD)}/min</strong>
              <span className="mono dimmer">Pro stitched · licensed</span>
            </div>
            <div>
              <strong>3840×1920</strong>
              <span className="mono dimmer">Equirect master · 23.98</span>
            </div>
            <div>
              <strong>9× Komodo 6K</strong>
              <span className="mono dimmer">R3D originals available</span>
            </div>
            <div>
              <strong>GPS + IMU</strong>
              <span className="mono dimmer">u-blox F9R RTK telemetry</span>
            </div>
          </div>
        </div>
      </section>

      {strip.length > 0 && (
        <section className="pano-strip" aria-label="Recent captures">
          <div className="strip">
            {strip.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.sku} src={p.renditions.poster} alt={p.title} />
            ))}
          </div>
        </section>
      )}

      <section className="wrap">
        <div className="section-head">
          <h2>Fresh off the array</h2>
          <Link href="/browse" className="mono dim">
            Browse all plates →
          </Link>
        </div>
        <div className="plate-grid">
          {featured.map((p) => (
            <PlateCard key={p.sku} plate={p} />
          ))}
        </div>
        {featured.length === 0 && (
          <div className="empty-state">
            <p className="mono">Catalog is empty</p>
            <p style={{ marginTop: 12 }}>
              Run <code className="mono-md">npm run demo:generate && npm run demo:ingest</code>{" "}
              to populate the demo catalog.
            </p>
          </div>
        )}
      </section>

      <section className="wrap">
        <div className="section-head">
          <h2>Built for the volume</h2>
        </div>
        <div className="props">
          <div className="prop">
            <span className="big accent">{formatUsd(PER_MINUTE_USD)}</span>
            <h3>Per minute, pro stitched</h3>
            <p>
              Every plate ships as a seam-refined 360×180 equirect master —
              optical-flow stitched, color-managed Log3G10/RWG, with per-camera
              R3D originals available for finishing.
            </p>
          </div>
          <div className="prop">
            <span className="big">9 + 1</span>
            <h3>Nine cameras, one world</h3>
            <p>
              The full sky tier most plate libraries skip. Preview the stitched
              environment and all nine camera feeds in frame-locked sync before
              you license a single second.
            </p>
          </div>
          <div className="prop">
            <span className="big">Your stage</span>
            <h3>Custom built for your volumetric stage</h3>
            <p>
              We re-project, re-grade, and re-tile every delivery to your LED
              volume&apos;s exact geometry and pipeline — or capture a route to
              order with the array on your schedule.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
