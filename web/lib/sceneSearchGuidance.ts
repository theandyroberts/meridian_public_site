import type { Plate } from "@platelab/shared";

export type ProductionApproach =
  | "listed_led_stage"
  | "custom_led_stage"
  | "undecided"
  | "vfx_no_led_wall";

export type SceneFilterChip = {
  key: string;
  label: string;
  value: string;
};

const FILTER_DEFINITIONS = [
  ["shot_type", "Shot type"],
  ["time_of_day", "Time of day"],
  ["weather", "Weather"],
  ["season", "Season"],
  ["speed_band", "Speed"],
  ["stage_compat", "Stage compatibility"],
  ["location", "Location"],
  ["tags", "Tags"],
  ["imu_collected", "Telemetry"],
  ["availability", "Availability"],
] as const;

const DISPLAY_VALUES: Record<string, string> = {
  "led-volume": "LED Volume",
  "green-screen": "Green Screen",
  projection: "Projection",
};

function displayFilterValue(key: string, value: unknown): string | null {
  if (key === "imu_collected" && typeof value === "boolean") {
    return value ? "IMU collected" : "IMU not required";
  }
  if (Array.isArray(value)) {
    const values = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => DISPLAY_VALUES[item] ?? item.replaceAll("_", " "));
    return values.length ? values.join(", ") : null;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return (
    DISPLAY_VALUES[normalized] ?? normalized.replaceAll("_", " ")
  );
}

export function sceneStructuredFilterChips(
  filters: unknown,
): SceneFilterChip[] {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return [];
  }
  const values = filters as Record<string, unknown>;
  return FILTER_DEFINITIONS.flatMap(([key, label]) => {
    const value = displayFilterValue(key, values[key]);
    return value ? [{ key, label, value }] : [];
  });
}

export function browseParamsForSceneFilters(filters: unknown): URLSearchParams {
  const params = new URLSearchParams();
  const mappings = [
    ["shot_type", "shotType"],
    ["time_of_day", "timeOfDay"],
    ["weather", "weather"],
    ["speed_band", "speedBand"],
    ["stage_compat", "stage"],
  ] as const;
  for (const [source, target] of mappings) {
    const raw = (filters as Record<string, unknown> | null)?.[source];
    if (typeof raw === "string" && raw.trim()) params.set(target, raw.trim());
  }
  const tags = (filters as Record<string, unknown> | null)?.tags;
  if (Array.isArray(tags) && typeof tags[0] === "string") {
    params.set("tag", tags[0]);
  }
  const imu = (filters as Record<string, unknown> | null)?.imu_collected;
  if (imu === true) params.set("imu", "1");

  return params;
}

export type StageCompatibilityAssessment = {
  tone: "compatible" | "warning" | "neutral";
  message: string;
};

export function sceneStageSearchGuidance({
  productionApproach,
  stageLabel,
}: {
  productionApproach: ProductionApproach;
  stageLabel?: string | null;
}): string {
  if (productionApproach === "undecided") {
    return "Choose the production stage to check each plate against the intended workflow.";
  }
  if (productionApproach === "vfx_no_led_wall") {
    return "This scene is planned for VFX without an LED wall, so LED Volume compatibility is not required.";
  }
  return `Candidates should be marked LED Volume compatible for ${
    stageLabel?.trim() || "the selected LED stage"
  }. Final approval still depends on wall coverage, resolution, horizon, and playback requirements.`;
}

export function assessPlateStageCompatibility({
  productionApproach,
  stageLabel,
  plateStageCompat,
}: {
  productionApproach: ProductionApproach;
  stageLabel?: string | null;
  plateStageCompat: Plate["stageCompat"];
}): StageCompatibilityAssessment {
  if (productionApproach === "undecided") {
    return {
      tone: "neutral",
      message: sceneStageSearchGuidance({ productionApproach, stageLabel }),
    };
  }
  if (productionApproach === "vfx_no_led_wall") {
    return {
      tone: "neutral",
      message: sceneStageSearchGuidance({ productionApproach, stageLabel }),
    };
  }
  const selectedStage = stageLabel?.trim() || "the selected LED stage";
  if (!plateStageCompat.includes("led-volume")) {
    return {
      tone: "warning",
      message: `This plate is not marked LED Volume compatible for ${selectedStage}. Review its coverage, resolution, horizon, and playback requirements before selecting it.`,
    };
  }
  return {
    tone: "compatible",
    message: `Marked LED Volume compatible for review on ${selectedStage}. Final technical approval still depends on the stage and shot setup.`,
  };
}
