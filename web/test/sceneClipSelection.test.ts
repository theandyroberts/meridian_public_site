import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSceneClipLicenseTier,
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

test("keeps the exact inclusive-frame boundary in the 60-second tier", () => {
  const evaluation = evaluateSceneClipLicenseTier(0, 1439, 24);
  assert.equal(evaluation?.durationFrames, 1440);
  assert.equal(evaluation?.tierSeconds, 60);
  assert.equal(evaluation?.boundary, "at");
});

test("moves one frame past 60 seconds into the 120-second tier", () => {
  const evaluation = evaluateSceneClipLicenseTier(0, 1440, 24);
  assert.equal(evaluation?.durationFrames, 1441);
  assert.equal(evaluation?.tierSeconds, 120);
  assert.equal(evaluation?.boundary, "crossed");
  assert.equal(evaluation?.framesFromBoundary, 1);
});

test("honors fractional source frame rates and rejects ranges over 120 seconds", () => {
  const sixtySecondFrameCount = Math.floor(60 * 23.976);
  assert.equal(
    evaluateSceneClipLicenseTier(
      100,
      100 + sixtySecondFrameCount - 1,
      23.976,
    )?.tierSeconds,
    60,
  );
  const overMaximum = evaluateSceneClipLicenseTier(0, 2880, 24);
  assert.equal(overMaximum?.tierSeconds, null);
  assert.equal(overMaximum?.boundary, "exceeded");
});
