import assert from "node:assert/strict";
import test from "node:test";
import {
  SCENE_EXTRACTION_PROMPT,
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

test("shooting-script scene and revision-page labels remain importable", () => {
  const result = parseSceneImportDocument({
    schema_version: SCENE_IMPORT_SCHEMA_VERSION,
    scenes: [
      {
        ...validScene,
        script_scene_number: "41A",
        script_pages: "74A–74B",
      },
    ],
  });

  assert.equal(result.scenes[0].script_scene_number, "41A");
  assert.equal(result.scenes[0].script_pages, "74A–74B");
});

test("standard feature scripts can omit scene and printed page numbers", () => {
  const result = parseSceneImportDocument({
    schema_version: SCENE_IMPORT_SCHEMA_VERSION,
    scenes: [
      {
        ...validScene,
        script_scene_number: "",
        script_pages: "",
      },
    ],
  });

  assert.equal(result.scenes[0].script_scene_number, "");
  assert.equal(result.scenes[0].script_pages, "");
});

test("guided prompt distinguishes shooting and standard script references", () => {
  assert.match(SCENE_EXTRACTION_PROMPT, /standard feature\/spec screenplay/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /numbered shooting script/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /41A/);
  assert.match(SCENE_EXTRACTION_PROMPT, /74A–74B/);
  assert.match(SCENE_EXTRACTION_PROMPT, /OMITTED or DELETED/);
  assert.match(SCENE_EXTRACTION_PROMPT, /PDF viewer's page count/);
  assert.match(SCENE_EXTRACTION_PROMPT, /distinct plate setup/);
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
