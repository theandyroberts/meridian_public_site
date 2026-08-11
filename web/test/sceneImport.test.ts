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
  search_intent_summary:
    "Find a private wooded road at midnight in cold mist.",
  continuity_group: "estate night",
  stage_use_type: "vehicle_process",
  production_metadata: {
    location_signature: "private wooded road",
    story_geography: "estate",
    environment_type: "woodland road",
    time_of_day: "midnight",
    weather: "cold mist",
    movement: "moving vehicle",
    traffic: "none",
    camera_direction: "unspecified",
    window_orientation: "driver side",
    required_visual_elements: ["guard gate"],
    substitution_constraints: [],
  },
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
  assert.match(SCENE_EXTRACTION_PROMPT, /entire screenplay as context/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /look backward and forward/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /supported derivation from guessing/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /unspecified plate candidate/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /released film or external plot information/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /visible production features rather than jurisdiction/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /story geography, not visual evidence/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /Express doubling potential through visible traits/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /inventory every vehicle interior/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /Character seating alone never establishes/i);
  assert.match(SCENE_EXTRACTION_PROMPT, /vehicle_process/);
  assert.match(SCENE_EXTRACTION_PROMPT, /walk_off/);
  assert.match(SCENE_EXTRACTION_PROMPT, /stationary_environment/);
  assert.match(SCENE_EXTRACTION_PROMPT, /search_intent_summary/);
  assert.match(SCENE_EXTRACTION_PROMPT, /continuity_group/);
});

test("scene import retains structured production and continuity guidance", () => {
  const result = parseSceneImportDocument({
    schema_version: SCENE_IMPORT_SCHEMA_VERSION,
    scenes: [validScene],
  });

  assert.equal(result.scenes[0].stage_use_type, "vehicle_process");
  assert.equal(result.scenes[0].continuity_group, "estate night");
  assert.equal(
    result.scenes[0].production_metadata.location_signature,
    "private wooded road",
  );
});

test("scene import rejects an unsupported stage-use type", () => {
  assert.throws(
    () =>
      parseSceneImportDocument({
        schema_version: SCENE_IMPORT_SCHEMA_VERSION,
        scenes: [{ ...validScene, stage_use_type: "guess" }],
      }),
    (error: unknown) =>
      error instanceof SceneImportError &&
      error.message.includes("stage_use_type"),
  );
});

test("legacy v1 files fail with an explicit version-upgrade message", () => {
  assert.throws(
    () =>
      parseSceneImportDocument({
        schema_version: "the-plate-lab.scene-import.v1",
        scenes: [validScene],
      }),
    (error: unknown) =>
      error instanceof SceneImportError &&
      error.message.includes("the-plate-lab.scene-import.v2"),
  );
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
