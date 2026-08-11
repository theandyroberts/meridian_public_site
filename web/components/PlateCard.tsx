"use client";

import Link from "next/link";
import { useRef } from "react";
import type { Plate } from "@platelab/shared";
import { formatUsd } from "@platelab/shared";
import { publicMediaUrl } from "@/lib/publicMediaUrl";
import { buildStudioHref } from "@/lib/studioHref";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Catalog card: poster at rest, watermarked preview plays on hover. */
export function PlateCard({
  plate,
  browseReturnPath,
}: {
  plate: Plate;
  browseReturnPath?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const studioHref = plate.renditions.stagePreview
    ? buildStudioHref({
        video: publicMediaUrl(plate.renditions.stagePreview),
        label: `${plate.sku} · ${plate.title}`,
        fps: plate.media.fps,
        sourceTimecode: plate.media.timecode,
        sku: plate.sku,
      })
    : undefined;
  const detailHref = browseReturnPath
    ? `/plate/${plate.sku}?from=${encodeURIComponent(browseReturnPath)}`
    : `/plate/${plate.sku}`;

  const start = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play().then(() => v.classList.add("playing")).catch(() => {});
  };
  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    v.classList.remove("playing");
  };

  return (
    <article
      className="plate-card"
      onMouseEnter={start}
      onMouseLeave={stop}
      onFocus={start}
      onBlur={stop}
    >
      <Link href={detailHref} className="plate-card-main">
        <div className="frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={publicMediaUrl(plate.renditions.poster)}
            alt={plate.title}
            loading="lazy"
          />
          <video
            ref={videoRef}
            src={publicMediaUrl(plate.renditions.stitchedPreview)}
            muted
            loop
            playsInline
            preload="none"
          />
          <span className="sku-chip mono">{plate.sku}</span>
          <span className="dur-chip mono">{formatDuration(plate.media.durationSec)}</span>
        </div>
        <div className="body">
          <h3>{plate.title}</h3>
          <div className="meta">
            <span className="mono dimmer">
              {plate.location.city}, {plate.location.region}
            </span>
            <span className="mono accent">{formatUsd(plate.pricing.totalUsd)}</span>
          </div>
          <div className="badges">
            <span className="badge">{plate.shotType}</span>
            <span className="badge">{plate.timeOfDay}</span>
            {plate.imu.collected && <span className="badge imu">IMU</span>}
            {plate.stageCompat.includes("led-volume") && (
              <span className="badge">LED Volume</span>
            )}
          </div>
        </div>
      </Link>
      <div className="plate-card-actions">
        {studioHref ? (
          <Link href={studioHref} className="plate-card-studio mono">
            Open in Studio <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <span className="plate-card-studio is-unavailable mono">
            Studio preview pending
          </span>
        )}
      </div>
    </article>
  );
}
