import assert from "node:assert/strict";
import test from "node:test";
import { sceneClipCounts } from "../lib/sceneClipCounts";

test("counts considering and selected plates independently", () => {
  assert.deepEqual(
    sceneClipCounts([
      { status: "considering" },
      { status: "selected" },
      { status: "considering" },
      { status: "shortlisted" },
      { status: "rejected" },
      { status: "submitted" },
    ]),
    { considering: 2, selected: 1 },
  );
});

test("returns zero counts when a scene has no saved plates", () => {
  assert.deepEqual(sceneClipCounts(undefined), {
    considering: 0,
    selected: 0,
  });
});
