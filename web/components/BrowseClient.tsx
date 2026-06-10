"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Plate } from "@platelab/shared";
import {
  SHOT_TYPES,
  TIMES_OF_DAY,
  WEATHER,
  SPEED_BANDS,
  STAGE_COMPAT,
} from "@platelab/shared";
import { PlateCard } from "./PlateCard";

/**
 * Client-side faceted search over the static catalog. Single-select per
 * facet group keeps the mental model simple; free text covers everything
 * else (title, location, tags, object labels).
 */

interface Filters {
  q: string;
  shotType: string | null;
  timeOfDay: string | null;
  weather: string | null;
  speedBand: string | null;
  stage: string | null;
  imuOnly: boolean;
  tag: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  "led-volume": "LED Volume",
  "green-screen": "Green Screen",
  projection: "Projection",
};

function matches(p: Plate, f: Filters): boolean {
  if (f.shotType && p.shotType !== f.shotType) return false;
  if (f.timeOfDay && p.timeOfDay !== f.timeOfDay) return false;
  if (f.weather && p.weather !== f.weather) return false;
  if (f.speedBand && p.speedBand !== f.speedBand) return false;
  if (f.stage && !p.stageCompat.includes(f.stage as any)) return false;
  if (f.imuOnly && !p.imu.collected) return false;
  if (f.tag && !p.tags.includes(f.tag)) return false;
  if (f.q) {
    const hay = [
      p.sku,
      p.title,
      p.description,
      p.location.name,
      p.location.city,
      p.location.region,
      ...p.tags,
      ...p.objects.map((o) => o.label),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of f.q.toLowerCase().split(/\s+/).filter(Boolean)) {
      if (!hay.includes(word)) return false;
    }
  }
  return true;
}

function FacetGroup({
  label,
  options,
  value,
  onChange,
  display,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string | null) => void;
  display?: Record<string, string>;
}) {
  return (
    <div className="filter-group">
      <span className="mono">{label}</span>
      <div className="filter-options">
        {options.map((opt) => (
          <button
            key={opt}
            className="filter-chip"
            data-on={value === opt}
            onClick={() => onChange(value === opt ? null : opt)}
          >
            {display?.[opt] ?? opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BrowseClient({ plates }: { plates: Plate[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const [filters, setFilters] = useState<Filters>({
    q: params.get("q") ?? "",
    shotType: params.get("shotType"),
    timeOfDay: params.get("timeOfDay"),
    weather: params.get("weather"),
    speedBand: params.get("speedBand"),
    stage: params.get("stage"),
    imuOnly: params.get("imu") === "1",
    tag: params.get("tag"),
  });

  const set = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const sp = new URLSearchParams();
    if (next.q) sp.set("q", next.q);
    if (next.shotType) sp.set("shotType", next.shotType);
    if (next.timeOfDay) sp.set("timeOfDay", next.timeOfDay);
    if (next.weather) sp.set("weather", next.weather);
    if (next.speedBand) sp.set("speedBand", next.speedBand);
    if (next.stage) sp.set("stage", next.stage);
    if (next.imuOnly) sp.set("imu", "1");
    if (next.tag) sp.set("tag", next.tag);
    router.replace(`/browse${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  const active =
    !!filters.q ||
    !!filters.shotType ||
    !!filters.timeOfDay ||
    !!filters.weather ||
    !!filters.speedBand ||
    !!filters.stage ||
    !!filters.tag ||
    filters.imuOnly;

  const results = useMemo(
    () => plates.filter((p) => matches(p, filters)),
    [plates, filters],
  );

  return (
    <div className="browse-layout">
      <aside className="filter-rail">
        <input
          className="search-input"
          placeholder="SEARCH PLATES, TAGS, OBJECTS…"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label="Search plates"
        />
        <FacetGroup
          label="Shot type"
          options={SHOT_TYPES}
          value={filters.shotType}
          onChange={(v) => set({ shotType: v })}
        />
        <FacetGroup
          label="Time of day"
          options={TIMES_OF_DAY}
          value={filters.timeOfDay}
          onChange={(v) => set({ timeOfDay: v })}
        />
        <FacetGroup
          label="Weather"
          options={WEATHER}
          value={filters.weather}
          onChange={(v) => set({ weather: v })}
        />
        <FacetGroup
          label="Speed"
          options={SPEED_BANDS}
          value={filters.speedBand}
          onChange={(v) => set({ speedBand: v })}
        />
        <FacetGroup
          label="Stage compatibility"
          options={STAGE_COMPAT}
          value={filters.stage}
          onChange={(v) => set({ stage: v })}
          display={STAGE_LABELS}
        />
        <div className="filter-group">
          <span className="mono">Telemetry</span>
          <div className="filter-options">
            <button
              className="filter-chip"
              data-on={filters.imuOnly}
              onClick={() => set({ imuOnly: !filters.imuOnly })}
            >
              IMU collected
            </button>
          </div>
        </div>
        {filters.tag && (
          <div className="filter-group">
            <span className="mono">Tag</span>
            <div className="filter-options">
              <button
                className="filter-chip"
                data-on
                onClick={() => set({ tag: null })}
              >
                {filters.tag} ✕
              </button>
            </div>
          </div>
        )}
      </aside>

      <div>
        <div className="results-head">
          <span className="mono dim">
            {results.length} plate{results.length === 1 ? "" : "s"}
            {active ? " · filtered" : ""}
          </span>
          {active && (
            <button
              className="mono dim clear-filters"
              onClick={() =>
                set({
                  q: "",
                  shotType: null,
                  timeOfDay: null,
                  weather: null,
                  speedBand: null,
                  stage: null,
                  imuOnly: false,
                  tag: null,
                })
              }
            >
              Clear all ✕
            </button>
          )}
        </div>
        {results.length ? (
          <div className="plate-grid">
            {results.map((p) => (
              <PlateCard key={p.sku} plate={p} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p className="mono">No plates match</p>
            <p style={{ marginTop: 10 }}>
              Loosen a filter, or ask us to capture it — routes are shot to
              order.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
