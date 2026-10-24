import assert from "node:assert/strict";
import test from "node:test";
import type { Plate } from "@platelab/shared";
import {
  browseFiltersFromParams,
  browsePageFromParams,
  browseParams,
  browseSortFromParams,
  paginateBrowseResults,
  safeBrowseReturnPath,
  sortBrowseResults,
  summarizeBrowseFilters,
} from "../lib/browseSearch";

function plate(
  sku: string,
  title: string,
  shootDate: string,
  durationSec: number,
): Plate {
  return {
    sku,
    title,
    shootDate,
    media: { durationSec },
  } as Plate;
}

test("browse state round-trips through the URL", () => {
  const filters = {
    q: "rain at night",
    shotType: "driving" as string,
    timeOfDay: "night" as string,
    weather: "rain" as string,
    speedBand: "city" as string,
    stage: "led-volume" as string,
    imuOnly: true,
    tag: "wet-road",
  };
  const params = browseParams({
    filters,
    sort: "duration-longest",
    page: 3,
  });

  assert.deepEqual(browseFiltersFromParams(params), filters);
  assert.equal(browseSortFromParams(params), "duration-longest");
  assert.equal(browsePageFromParams(params), 3);
});

test("browse defaults reject unknown sort and page values", () => {
  const params = new URLSearchParams("sort=price&page=-4");
  assert.equal(browseSortFromParams(params), "relevance");
  assert.equal(browsePageFromParams(params), 1);
});

test("plate results sort without mutating search relevance order", () => {
  const original = [
    plate("PL-0000000", "Middle", "2026-05-01", 40),
    plate("PL-0000019", "Newest", "2026-06-01", 80),
    plate("PL-0000027", "Shortest", "2026-04-01", 20),
  ];

  assert.deepEqual(
    sortBrowseResults(original, "relevance").map((item) => item.title),
    ["Middle", "Newest", "Shortest"],
  );
  assert.deepEqual(
    sortBrowseResults(original, "newest").map((item) => item.title),
    ["Newest", "Middle", "Shortest"],
  );
  assert.deepEqual(
    sortBrowseResults(original, "duration-shortest").map(
      (item) => item.title,
    ),
    ["Shortest", "Middle", "Newest"],
  );
  assert.deepEqual(
    sortBrowseResults(original, "duration-longest").map(
      (item) => item.title,
    ),
    ["Newest", "Middle", "Shortest"],
  );
  assert.equal(original[0]?.title, "Middle");
});

test("pagination reports the visible range and clamps invalid pages", () => {
  const results = Array.from({ length: 25 }, (_, index) => index + 1);
  assert.deepEqual(paginateBrowseResults(results, 2, 12), {
    items: results.slice(12, 24),
    page: 2,
    pageCount: 3,
    start: 13,
    end: 24,
  });
  assert.deepEqual(paginateBrowseResults(results, 99, 12), {
    items: [25],
    page: 3,
    pageCount: 3,
    start: 25,
    end: 25,
  });
});

test("plate detail accepts only local browse return paths", () => {
  assert.equal(
    safeBrowseReturnPath("/browse?q=coast&sort=newest&page=2"),
    "/browse?q=coast&sort=newest&page=2",
  );
  assert.equal(safeBrowseReturnPath("https://example.com"), "/browse");
  assert.equal(safeBrowseReturnPath("/projects"), "/browse");
  assert.equal(safeBrowseReturnPath(["/browse", "/projects"]), "/browse");
});

test("active filters are summarized with user-facing stage and telemetry labels", () => {
  assert.deepEqual(
    summarizeBrowseFilters({
      q: "coast",
      shotType: "driving",
      timeOfDay: null,
      weather: null,
      speedBand: null,
      stage: "led-volume",
      imuOnly: true,
      tag: null,
    }),
    [
      { key: "q", label: "Search", value: "coast" },
      { key: "shotType", label: "Shot", value: "driving" },
      { key: "stage", label: "Stage", value: "LED Volume" },
      { key: "imuOnly", label: "Telemetry", value: "IMU collected" },
    ],
  );
});
