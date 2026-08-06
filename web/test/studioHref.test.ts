import assert from "node:assert/strict";
import test from "node:test";
import { buildStudioHref } from "../lib/studioHref";

test("carries project, scene, plate, and saved-selection context into Studio", () => {
  const href = buildStudioHref({
    video: "https://media.example/preview.mp4",
    label: "PL-7600232 · PCH at Topanga",
    fps: 24,
    sourceTimecode: "12:49:12:15",
    sku: "PL-7600232",
    scene: {
      projectId: "project-1",
      projectName: "BLACKLIST_MOVIE",
      sceneId: "scene-1",
      sceneName: "Night drive",
    },
    selection: {
      sceneClipId: "clip-1",
      version: 4,
      inFrame: 24,
      outFrame: 71,
    },
  });
  const query = new URLSearchParams(href.split("?")[1]);

  assert.equal(query.get("projectId"), "project-1");
  assert.equal(query.get("projectName"), "BLACKLIST_MOVIE");
  assert.equal(query.get("sceneId"), "scene-1");
  assert.equal(query.get("sceneName"), "Night drive");
  assert.equal(query.get("sku"), "PL-7600232");
  assert.equal(query.get("sceneClipId"), "clip-1");
  assert.equal(query.get("version"), "4");
  assert.equal(query.get("inFrame"), "24");
  assert.equal(query.get("outFrame"), "71");
});

test("keeps an ad hoc Studio URL free of project context", () => {
  const href = buildStudioHref({
    video: "https://media.example/preview.mp4",
    label: "Plate preview",
    fps: 23.976,
    sku: "PL-1234567",
  });
  const query = new URLSearchParams(href.split("?")[1]);

  assert.equal(query.get("sku"), "PL-1234567");
  assert.equal(query.has("projectId"), false);
  assert.equal(query.has("sceneId"), false);
  assert.equal(query.has("sceneClipId"), false);
});
