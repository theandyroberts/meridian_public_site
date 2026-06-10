"use client";

import { useState } from "react";
import type { Plate } from "@platelab/shared";
import { formatUsd } from "@platelab/shared";

export function PriceBlock({ plate }: { plate: Plate }) {
  const [state, setState] = useState<"idle" | "busy" | "reserved" | "error">(
    plate.availability === "reserved" ? "reserved" : "idle",
  );
  const minutes = plate.media.durationSec / 60;

  const reserve = async () => {
    setState("busy");
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku: plate.sku }),
      });
      setState(res.ok ? "reserved" : "error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="side-card price">
      <h2>License this plate</h2>
      <span className="mono block-label">Single-production · worldwide</span>
      <div className="amount accent">{formatUsd(plate.pricing.totalUsd)}</div>
      <span className="mono formula">
        {formatUsd(plate.pricing.perMinuteUsd)}/min · pro stitched
      </span>
      <div className="price-rows">
        <div className="row">
          <span>Runtime</span>
          <span>
            {minutes < 1
              ? `${Math.round(plate.media.durationSec)}s (1 min minimum)`
              : `${minutes.toFixed(2)} min`}
          </span>
        </div>
        <div className="row">
          <span>Stitched 360×180 master</span>
          <span>included</span>
        </div>
        <div className="row">
          <span>9× R3D camera originals</span>
          <span>on request</span>
        </div>
        <div className="row">
          <span>GPS / IMU telemetry files</span>
          <span>included</span>
        </div>
      </div>
      <div className="cta-stack">
        <button
          className="btn primary"
          onClick={reserve}
          disabled={state === "busy" || state === "reserved"}
        >
          {state === "reserved"
            ? "Reserved · 72h hold"
            : state === "busy"
              ? "Reserving…"
              : "Reserve · 72h hold"}
        </button>
        <a className="btn" href={`mailto:plates@theplatelab.com?subject=License ${plate.sku}`}>
          License now
        </a>
      </div>
      {state === "error" && (
        <p className="mono" style={{ color: "#c56b3e", marginTop: 12 }}>
          Reservation failed — try again
        </p>
      )}
      <p className="custom-note">
        Running an LED volume?{" "}
        <a href={`mailto:plates@theplatelab.com?subject=Custom delivery ${plate.sku}`}>
          Custom built for your volumetric stage
        </a>{" "}
        — re-projected, re-graded, and tiled to your wall geometry.
      </p>
    </div>
  );
}
