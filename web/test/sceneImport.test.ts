import assert from "node:assert/strict";
import test from "node:test";
import {
  SCENE_IMPORT_SCHEMA_VERSION,
  SceneImportError,
  parseSceneImportDocument,
  parseSceneImportJson,
} from "../lib/sceneImport";

const validScene = {
  scene_name: "Estate escape",
  script_scene_number: "41",
  script_pages: "42",
  description: "Private wooded road at midnight in cold mist.",
  search_keywords: [
    "Private Road",
    "midnight",
    "cold mist",
    "private road",
  ],
};

test("creator-reviewed scene JSON is normalized without inventing metadata", () => {
  const result = parseSceneImportDocument({
    schema_version: SCENE_IMPORT_SCHEMA_VERSION,
    scenes: [validScene],
  });

  assert.deepEqual(result.scenes[0], {
    ...validScene,
    search_keywords: ["private road", "midnight", "cold mist"],
  });
});

test("scene import rejects unsupported fields instead of silently discarding them", () => {
  assert.throws(
    () =>
      parseSceneImportDocument({
        schema_version: SCENE_IMPORT_SCHEMA_VERSION,
        scenes: [{ ...validScene, screenplay_excerpt: "private script" }],
      }),
    (error: unknown) =>
      error instanceof SceneImportError &&
      error.message.includes("screenplay_excerpt"),
  );
});

test("scene import rejects malformed AI output", () => {
  assert.throws(
    () => parseSceneImportJson("```json\n{}\n```"),
    (error: unknown) =>
      error instanceof SceneImportError &&
      error.message.includes("not valid JSON"),
  );
});

test("scene import requires reviewed search keywords", () => {
  assert.throws(
    () =>
      parseSceneImportDocument({
        schema_version: SCENE_IMPORT_SCHEMA_VERSION,
        scenes: [{ ...validScene, search_keywords: ["road", "night"] }],
      }),
    (error: unknown) =>
      error instanceof SceneImportError &&
      error.message.includes("between 3 and 24"),
  );
});
