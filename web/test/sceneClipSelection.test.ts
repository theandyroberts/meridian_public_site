import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSceneClipSelectionDuration,
  parseSceneClipSelectionUpdate,
} from "../lib/sceneClipSelection";

test("accepts a complete, versioned In/Out selection", () => {
  assert.deepEqual(
    parseSceneClipSelectionUpdate({
      inFrame: 24,
      outFrame: 47,
      expectedVersion: 3,
    }),
    { inFrame: 24, outFrame: 47, expectedVersion: 3 },
  );
});

test("rejects incomplete and backwards selections", () => {
  assert.equal(
    parseSceneClipSelectionUpdate({ inFrame: 24, expectedVersion: 3 }),
    null,
  );
  assert.equal(
    parseSceneClipSelectionUpdate({
      inFrame: 24,
      outFrame: 24,
      expectedVersion: 3,
    }),
    null,
  );
});

test("rejects non-integer frames and invalid versions", () => {
  assert.equal(
    parseSceneClipSelectionUpdate({
      inFrame: 24.5,
      outFrame: 48,
      expectedVersion: 3,
    }),
    null,
  );
  assert.equal(
    parseSceneClipSelectionUpdate({
      inFrame: 24,
      outFrame: 48,
      expectedVersion: 0,
    }),
    null,
  );
});

test("formats the inclusive persisted selection duration at source frame rate", () => {
  assert.equal(
    formatSceneClipSelectionDuration(24, 47, 24),
    "1.00 sec · 24 frames",
  );
  assert.equal(formatSceneClipSelectionDuration(null, null, 24), null);
});
