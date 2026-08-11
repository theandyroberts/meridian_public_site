import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRoughShot,
  parseSceneStageChoice,
  parseSceneVehicle,
  preserveNiceToHavePriority,
  roughShotLabel,
} from "../lib/sceneConfiguration";

test("scene vehicle parsing preserves supported choices and defaults safely", () => {
  assert.equal(parseSceneVehicle("sports_car"), "sports_car");
  assert.equal(parseSceneVehicle("motorcycle"), "sedan");
});

test("rough camera shot parsing accepts only supported shot types", () => {
  assert.equal(parseRoughShot("wide_rear"), "wide_rear");
  assert.equal(parseRoughShot(""), null);
  assert.equal(parseRoughShot("closeup"), null);
  assert.equal(roughShotLabel("wide_rear"), "Wide · rear");
  assert.equal(roughShotLabel(null), "Not specified");
});

test("scene stage choices can restore project inheritance", () => {
  assert.deepEqual(parseSceneStageChoice("inherit"), {
    production_approach_override: null,
    stage_profile_id_override: null,
    custom_stage_name_override: null,
  });
});

test("scene stage choices accept listed stages and non-stage workflows", () => {
  assert.deepEqual(
    parseSceneStageChoice(
      "stage:a15a15a1-0000-4000-8000-000000000015",
    ),
    {
      production_approach_override: "listed_led_stage",
      stage_profile_id_override: "a15a15a1-0000-4000-8000-000000000015",
      custom_stage_name_override: null,
    },
  );
  assert.deepEqual(parseSceneStageChoice("vfx_no_led_wall"), {
    production_approach_override: "vfx_no_led_wall",
    stage_profile_id_override: null,
    custom_stage_name_override: null,
  });
  assert.equal(parseSceneStageChoice("keep_custom"), null);
});

test("AI refresh preserves manual Nice to Have classification without duplicates", () => {
  assert.deepEqual(
    preserveNiceToHavePriority(
      ["night", "Wet Road", "city", "night"],
      ["wet road", "Sparse traffic", "wet road"],
    ),
    {
      mustHave: ["night", "city"],
      niceToHave: ["wet road", "sparse traffic"],
    },
  );
});
