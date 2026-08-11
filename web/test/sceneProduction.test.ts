import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSceneProductionMetadata,
  parseStageUseType,
  sceneProductionMetadataFromForm,
  sceneProductionSearchText,
} from "../lib/sceneProduction";

test("structured scene metadata is normalized and searchable", () => {
  const metadata = normalizeSceneProductionMetadata({
    location_signature: "  wooded   private road ",
    time_of_day: "night",
    required_visual_elements: ["guard gate", "guard gate"],
  });

  assert.equal(metadata.location_signature, "wooded private road");
  assert.deepEqual(metadata.required_visual_elements, ["guard gate"]);
  assert.match(sceneProductionSearchText(metadata), /wooded private road/);
  assert.match(sceneProductionSearchText(metadata), /guard gate/);
});

test("scene production form keeps structured lists distinct", () => {
  const formData = new FormData();
  formData.set("location_signature", "urban viaduct");
  formData.set("required_visual_elements", "bridge arches\ncity skyline");
  formData.set("substitution_constraints", "no legible signs, period cars");

  const metadata = sceneProductionMetadataFromForm(formData);
  assert.deepEqual(metadata.required_visual_elements, [
    "bridge arches",
    "city skyline",
  ]);
  assert.deepEqual(metadata.substitution_constraints, [
    "no legible signs",
    "period cars",
  ]);
});

test("stage-use parsing accepts supported types and defaults safely", () => {
  assert.equal(parseStageUseType("walk_off"), "walk_off");
  assert.equal(parseStageUseType("not-real"), "vehicle_process");
});
