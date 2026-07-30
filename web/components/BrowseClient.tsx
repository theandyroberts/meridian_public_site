"use client";

import { useEffect, useRef, useState } from "react";
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
 * Faceted hybrid search. The initial database catalog renders immediately,
 * then active filters are ranked through the server-side Postgres/pgvector
 * search endpoint.
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
  const searchRef = useRef<HTMLInputElement>(null);

  // Arriving from the home hero search (focus=1): take focus so the user's
  // keystrokes flow straight into this field, cursor parked after any text
  // already carried over via ?q=.
  useEffect(() => {
    if (params.get("focus") !== "1") return;
    const el = searchRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [results, setResults] = useState(plates);
  const [searching, setSearching] = useState(false);
  const [semantic, setSemantic] = useState(false);

  const set = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  // Mirror the active filters into the URL. Done in an effect, not inside the
  // state updater, so we never trigger a Router update during render.
  useEffect(() => {
    const sp = searchParamsForFilters(filters);
    router.replace(`/browse${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }, [filters, router]);

  const active =
    !!filters.q ||
    !!filters.shotType ||
    !!filters.timeOfDay ||
    !!filters.weather ||
    !!filters.speedBand ||
    !!filters.stage ||
    !!filters.tag ||
    filters.imuOnly;

  useEffect(() => {
    if (!active) {
      setResults(plates);
      setSemantic(false);
      setSearching(false);
      return;
    }

    const abortController = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `/api/catalog/search?${searchParamsForFilters(filters)}`,
          { signal: abortController.signal },
        );
        if (!response.ok) throw new Error("search failed");
        const body = (await response.json()) as {
          plates: Plate[];
          semantic: boolean;
        };
        setResults(body.plates);
        setSemantic(body.semantic);
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn(error);
        }
      } finally {
        if (!abortController.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [active, filters, plates]);

  return (
    <div className="browse-layout">
      <aside className="filter-rail">
        <input
          ref={searchRef}
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
            {searching ? " · searching" : ""}
            {semantic ? " · semantic" : ""}
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

function searchParamsForFilters(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.shotType) params.set("shotType", filters.shotType);
  if (filters.timeOfDay) params.set("timeOfDay", filters.timeOfDay);
  if (filters.weather) params.set("weather", filters.weather);
  if (filters.speedBand) params.set("speedBand", filters.speedBand);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.imuOnly) params.set("imu", "1");
  if (filters.tag) params.set("tag", filters.tag);
  return params;
}
