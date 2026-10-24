import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTINUITY_RANK_WEIGHT,
  NICE_TO_HAVE_RANK_WEIGHT,
  rankPrioritizedSceneMatches,
} from "../lib/sceneSearchRanking";

test("Must Have evidence receives full weight and Nice to Have a bounded boost", () => {
  const ranked = rankPrioritizedSceneMatches(
    [
      { id: "must-only", hybrid_score: 0.01 },
      { id: "both", hybrid_score: 0.009 },
    ],
    [
      { id: "nice-only", hybrid_score: 0.02 },
      { id: "both", hybrid_score: 0.01 },
    ],
  );

  assert.equal(NICE_TO_HAVE_RANK_WEIGHT, 0.25);
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["both", "must-only", "nice-only"],
  );
});

test("continuity provides a soft boost without filtering primary candidates", () => {
  const ranked = rankPrioritizedSceneMatches(
    [
      { id: "primary", hybrid_score: 0.4 },
      { id: "continuous-primary", hybrid_score: 0.36 },
    ],
    [],
    [
      { id: "continuous-primary", hybrid_score: 0.4 },
      { id: "continuity-only", hybrid_score: 0.5 },
    ],
  );

  assert.equal(CONTINUITY_RANK_WEIGHT, 0.12);
  assert.deepEqual(
    ranked.map((row) => row.id),
    ["continuous-primary", "primary", "continuity-only"],
  );
});

test("priority ranking uses stable ids to break equal scores", () => {
  const ranked = rankPrioritizedSceneMatches(
    [
      { id: "b", hybrid_score: 0.01 },
      { id: "a", hybrid_score: 0.01 },
    ],
    [],
  );

  assert.deepEqual(ranked.map((row) => row.id), ["a", "b"]);
});
