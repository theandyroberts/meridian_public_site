import assert from "node:assert/strict";
import test from "node:test";
import {
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
