"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  browseFiltersFromParams,
  browsePageFromParams,
  browseParams,
  browseSortFromParams,
  paginateBrowseResults,
  searchParamsForFilters,
  sortBrowseResults,
  type BrowseFilters,
  type BrowseSort,
} from "@/lib/browseSearch";
import styles from "./BrowseClient.module.css";

/**
 * Faceted hybrid search. The initial database catalog renders immediately,
 * then active filters are ranked through the server-side Postgres/pgvector
 * search endpoint.
 */

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

  const [filters, setFilters] = useState<BrowseFilters>(() =>
    browseFiltersFromParams(params),
  );
  const [sort, setSort] = useState<BrowseSort>(() =>
    browseSortFromParams(params),
  );
  const [page, setPage] = useState(() => browsePageFromParams(params));
  const [results, setResults] = useState(plates);
  const [searching, setSearching] = useState(false);
  const [semantic, setSemantic] = useState(false);
  const [degraded, setDegraded] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);

  const set = (patch: Partial<BrowseFilters>) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  // Mirror the active filters into the URL. Done in an effect, not inside the
  // state updater, so we never trigger a Router update during render.
  useEffect(() => {
    const sp = browseParams({ filters, sort, page });
    router.replace(`/browse${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }, [filters, page, router, sort]);

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
      setDegraded(null);
      setSearching(false);
      return;
    }

    const abortController = new AbortController();
    setSearching(true);
    setDegraded(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/catalog/search?${searchParamsForFilters(filters)}`,
          { signal: abortController.signal },
        );
        if (!response.ok) throw new Error("search failed");
        const body = (await response.json()) as {
          plates: Plate[];
          semantic: boolean;
          degraded?: boolean;
        };
        setResults(body.plates);
        setSemantic(body.semantic);
        setDegraded(
          body.degraded
            ? {
                message:
                  "Semantic matching is temporarily unavailable. Results use exact words and metadata filters.",
                retryable: false,
              }
            : null,
        );
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.warn(error);
          setSemantic(false);
          setDegraded({
            message:
              "Live search is temporarily unavailable. The catalog remains visible; try again in a moment.",
            retryable: true,
          });
          setResults(plates);
        }
      } finally {
        if (!abortController.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [active, filters, plates, searchAttempt]);

  const sortedResults = useMemo(
    () => sortBrowseResults(results, sort),
    [results, sort],
  );
  const paginated = useMemo(
    () => paginateBrowseResults(sortedResults, page),
    [page, sortedResults],
  );
  const browseReturnParams = browseParams({
    filters,
    sort,
    page: paginated.page,
  });
  const browseReturnPath = `/browse${
    browseReturnParams.size ? `?${browseReturnParams}` : ""
  }`;

  useEffect(() => {
    if (page !== paginated.page) setPage(paginated.page);
  }, [page, paginated.page]);

  const clearAll = () => {
    set({
      q: "",
      shotType: null,
      timeOfDay: null,
      weather: null,
      speedBand: null,
      stage: null,
      imuOnly: false,
      tag: null,
    });
  };

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
        <div className={`results-head ${styles.resultsHead}`}>
          <div>
            <span className="mono dim">
              {sortedResults.length
                ? `${paginated.start}–${paginated.end} of `
                : ""}
              {sortedResults.length} plate{sortedResults.length === 1 ? "" : "s"}
              {active ? " · filtered" : ""}
              {semantic ? " · semantic" : ""}
            </span>
            <span className="sr-only" aria-live="polite">
              {searching
                ? "Searching plates"
                : `${sortedResults.length} plates found`}
            </span>
            {searching && (
              <span className={`${styles.status} mono`} aria-hidden="true">
                <span className={styles.spinner} /> Searching
              </span>
            )}
          </div>
          <div className={styles.toolbar}>
            <label className={`${styles.sortLabel} mono`}>
              Sort
              <select
                className={styles.sortSelect}
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as BrowseSort);
                  setPage(1);
                }}
                aria-label="Sort plate results"
              >
                <option value="relevance">Best match</option>
                <option value="newest">Newest shoot</option>
                <option value="duration-shortest">Shortest duration</option>
                <option value="duration-longest">Longest duration</option>
              </select>
            </label>
            {active && (
              <button className="mono dim clear-filters" onClick={clearAll}>
                Clear all ✕
              </button>
            )}
          </div>
        </div>
        {degraded && (
          <div className={styles.notice} role="status">
            <span>
              <strong>Limited search:</strong> {degraded.message}
            </span>
            {degraded.retryable && (
              <button
                className={styles.retryButton}
                onClick={() => setSearchAttempt((attempt) => attempt + 1)}
              >
                Retry search
              </button>
            )}
          </div>
        )}
        {sortedResults.length ? (
          <div
            className={styles.resultRegion}
            data-loading={searching}
            aria-busy={searching}
          >
            <div className="plate-grid">
              {paginated.items.map((p) => (
                <PlateCard
                  key={p.sku}
                  plate={p}
                  browseReturnPath={browseReturnPath}
                />
              ))}
            </div>
            {paginated.pageCount > 1 && (
              <nav className={styles.pagination} aria-label="Plate result pages">
                <button
                  className={styles.pageButton}
                  disabled={paginated.page === 1}
                  onClick={() => setPage(paginated.page - 1)}
                >
                  Previous
                </button>
                {Array.from({ length: paginated.pageCount }, (_, index) => {
                  const pageNumber = index + 1;
                  return (
                    <button
                      key={pageNumber}
                      className={styles.pageButton}
                      data-current={pageNumber === paginated.page}
                      aria-current={
                        pageNumber === paginated.page ? "page" : undefined
                      }
                      aria-label={`Page ${pageNumber}`}
                      onClick={() => setPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
                <button
                  className={styles.pageButton}
                  disabled={paginated.page === paginated.pageCount}
                  onClick={() => setPage(paginated.page + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </div>
        ) : (
          <div className="empty-state" role="status">
            <p className="mono">No plates match</p>
            <p style={{ marginTop: 10 }}>
              Try fewer words or remove a filter. The Plate Lab can also plan a
              route when the catalog does not yet cover the shot.
            </p>
            <div className={styles.emptyActions}>
              <button className="secondary-button" onClick={clearAll}>
                Clear search and filters
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
