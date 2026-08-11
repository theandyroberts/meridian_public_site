import type { Plate } from "@platelab/shared";

export interface BrowseFilters {
  q: string;
  shotType: string | null;
  timeOfDay: string | null;
  weather: string | null;
  speedBand: string | null;
  stage: string | null;
  imuOnly: boolean;
  tag: string | null;
}

export type BrowseSort =
  | "relevance"
  | "newest"
  | "duration-shortest"
  | "duration-longest";

export const BROWSE_PAGE_SIZE = 12;

export function browseFiltersFromParams(
  params: Pick<URLSearchParams, "get">,
): BrowseFilters {
  return {
    q: params.get("q") ?? "",
    shotType: params.get("shotType"),
    timeOfDay: params.get("timeOfDay"),
    weather: params.get("weather"),
    speedBand: params.get("speedBand"),
    stage: params.get("stage"),
    imuOnly: params.get("imu") === "1",
    tag: params.get("tag"),
  };
}

export function browseSortFromParams(
  params: Pick<URLSearchParams, "get">,
): BrowseSort {
  const value = params.get("sort");
  return value === "newest" ||
    value === "duration-shortest" ||
    value === "duration-longest"
    ? value
    : "relevance";
}

export function browsePageFromParams(
  params: Pick<URLSearchParams, "get">,
): number {
  const value = Number(params.get("page"));
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function browseParams({
  filters,
  sort = "relevance",
  page = 1,
}: {
  filters: BrowseFilters;
  sort?: BrowseSort;
  page?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.shotType) params.set("shotType", filters.shotType);
  if (filters.timeOfDay) params.set("timeOfDay", filters.timeOfDay);
  if (filters.weather) params.set("weather", filters.weather);
  if (filters.speedBand) params.set("speedBand", filters.speedBand);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.imuOnly) params.set("imu", "1");
  if (filters.tag) params.set("tag", filters.tag);
  if (sort !== "relevance") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  return params;
}

export function searchParamsForFilters(
  filters: BrowseFilters,
): URLSearchParams {
  return browseParams({ filters });
}

export function sortBrowseResults(
  plates: readonly Plate[],
  sort: BrowseSort,
): Plate[] {
  const sorted = [...plates];
  if (sort === "relevance") return sorted;

  sorted.sort((left, right) => {
    if (sort === "newest") {
      return (
        right.shootDate.localeCompare(left.shootDate) ||
        left.title.localeCompare(right.title)
      );
    }
    const durationOrder = left.media.durationSec - right.media.durationSec;
    return (
      (sort === "duration-longest" ? -durationOrder : durationOrder) ||
      left.title.localeCompare(right.title)
    );
  });
  return sorted;
}

export function paginateBrowseResults<T>(
  results: readonly T[],
  page: number,
  pageSize = BROWSE_PAGE_SIZE,
): { items: T[]; page: number; pageCount: number; start: number; end: number } {
  const safePageSize = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(results.length / safePageSize));
  const safePage = Math.max(1, Math.min(Math.trunc(page) || 1, pageCount));
  const startIndex = (safePage - 1) * safePageSize;
  const items = results.slice(startIndex, startIndex + safePageSize);
  return {
    items,
    page: safePage,
    pageCount,
    start: results.length ? startIndex + 1 : 0,
    end: Math.min(startIndex + safePageSize, results.length),
  };
}

export function safeBrowseReturnPath(
  value: string | string[] | null | undefined,
): string {
  if (typeof value !== "string" || !value) return "/browse";
  return value === "/browse" || value.startsWith("/browse?")
    ? value
    : "/browse";
}
