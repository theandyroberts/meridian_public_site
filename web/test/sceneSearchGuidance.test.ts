import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPlateStageCompatibility,
  browseParamsForSceneFilters,
  sceneStageSearchGuidance,
  sceneStructuredFilterChips,
} from "../lib/sceneSearchGuidance";

test("scene filters expose only the structured requirements used by search", () => {
  assert.deepEqual(
    sceneStructuredFilterChips({
      shot_type: "urban",
      time_of_day: "night",
      stage_compat: "led-volume",
      tags: ["wet-road", "traffic"],
      imu_collected: true,
      internal_note: "do not expose",
    }),
    [
      { key: "shot_type", label: "Shot type", value: "urban" },
      { key: "time_of_day", label: "Time of day", value: "night" },
      {
        key: "stage_compat",
        label: "Stage compatibility",
        value: "LED Volume",
      },
      { key: "tags", label: "Tags", value: "wet-road, traffic" },
      {
        key: "imu_collected",
        label: "Telemetry",
        value: "IMU collected",
      },
    ],
  );
});

test("scene filters map to durable Browse URL parameters", () => {
  assert.equal(
    browseParamsForSceneFilters({
      shot_type: "coastal",
      weather: "clear",
      speed_band: "city",
      stage_compat: "led-volume",
      tags: ["ocean"],
      imu_collected: true,
    }).toString(),
    "shotType=coastal&weather=clear&speedBand=city&stage=led-volume&tag=ocean&imu=1",
  );
});

test("LED stage scenes warn on candidates without LED compatibility", () => {
  assert.deepEqual(
    assessPlateStageCompatibility({
      productionApproach: "listed_led_stage",
      stageLabel: "AMZ/MGM",
      plateStageCompat: ["green-screen"],
    }),
    {
      tone: "warning",
      message:
        "This plate is not marked LED Volume compatible for AMZ/MGM. Review its coverage, resolution, horizon, and playback requirements before selecting it.",
    },
  );
  assert.equal(
    assessPlateStageCompatibility({
      productionApproach: "custom_led_stage",
      stageLabel: "Volume A",
      plateStageCompat: ["led-volume"],
    }).tone,
    "compatible",
  );
});

test("undecided and non-LED workflows do not produce false incompatibility warnings", () => {
  assert.equal(
    assessPlateStageCompatibility({
      productionApproach: "undecided",
      plateStageCompat: [],
    }).tone,
    "neutral",
  );
  assert.equal(
    assessPlateStageCompatibility({
      productionApproach: "vfx_no_led_wall",
      plateStageCompat: [],
    }).tone,
    "neutral",
  );
});

test("scene guidance explains how the selected stage constrains search", () => {
  assert.equal(
    sceneStageSearchGuidance({
      productionApproach: "listed_led_stage",
      stageLabel: "AMZ/MGM",
    }),
    "Candidates should be marked LED Volume compatible for AMZ/MGM. Final approval still depends on wall coverage, resolution, horizon, and playback requirements.",
  );
});
