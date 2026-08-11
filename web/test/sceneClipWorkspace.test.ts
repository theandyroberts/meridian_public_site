import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSceneClipStatusUpdate,
  sceneClipWorkspaceTab,
} from "../lib/sceneClipWorkspace";

test("parses versioned status changes", () => {
  assert.deepEqual(
    parseSceneClipStatusUpdate({ status: "rejected", expectedVersion: 4 }),
    { status: "rejected", expectedVersion: 4 },
  );
  assert.equal(
    parseSceneClipStatusUpdate({ status: "deleted", expectedVersion: 4 }),
    null,
  );
  assert.equal(
    parseSceneClipStatusUpdate({ status: "selected", expectedVersion: 0 }),
    null,
  );
});

test("groups retained workflow states into three readable workspace tabs", () => {
  assert.equal(sceneClipWorkspaceTab("considering"), "considering");
  assert.equal(sceneClipWorkspaceTab("shortlisted"), "considering");
  assert.equal(sceneClipWorkspaceTab("selected"), "selected");
  assert.equal(sceneClipWorkspaceTab("submitted"), "selected");
  assert.equal(sceneClipWorkspaceTab("rejected"), "rejected");
});
