import assert from "node:assert/strict";
import test from "node:test";
import { matchClosenessPercent } from "../lib/matchCloseness";

test("weak or missing search evidence stays visibly low", () => {
  assert.equal(
    matchClosenessPercent({ keywordScore: 0, semanticScore: 0 }),
    0,
  );
  assert.equal(
    matchClosenessPercent({ keywordScore: 0, semanticScore: 0.54 }),
    7,
  );
});

test("keyword evidence supplements rather than overwhelms semantics", () => {
  assert.equal(
    matchClosenessPercent({ keywordScore: 0.1, semanticScore: 0.54 }),
    12,
  );
});

test("strong evidence is bounded to a percentage", () => {
  assert.equal(
    matchClosenessPercent({ keywordScore: 1, semanticScore: 1 }),
    100,
  );
  assert.equal(
    matchClosenessPercent({ keywordScore: 20, semanticScore: 3 }),
    100,
  );
});
