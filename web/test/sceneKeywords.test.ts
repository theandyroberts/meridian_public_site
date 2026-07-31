import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSceneKeywords } from "../lib/sceneKeywords";

test("AI scene keywords are normalized, deduplicated, and bounded", () => {
  const keywords = normalizeSceneKeywords([
    " Private Road ",
    "private road",
    "MIDNIGHT",
    "cold mist",
    ...Array.from({ length: 30 }, (_, index) => `keyword ${index}`),
  ]);

  assert.equal(keywords.length, 16);
  assert.ok(keywords.includes("private road"));
  assert.ok(keywords.includes("midnight"));
  assert.equal(new Set(keywords).size, keywords.length);
});

test("AI scene keyword normalization ignores non-string values", () => {
  assert.deepEqual(
    normalizeSceneKeywords(["road", null, 14, "", " road "]),
    ["road"],
  );
});
