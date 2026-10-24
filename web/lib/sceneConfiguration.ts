export const VEHICLE_OPTIONS = [
  { value: "sedan", label: "Sedan" },
  { value: "suv", label: "SUV" },
  { value: "sports_car", label: "Sports car" },
  { value: "none", label: "No vehicle" },
  { value: "undecided", label: "Undecided" },
] as const;

export type SceneVehicle = (typeof VEHICLE_OPTIONS)[number]["value"];

const VEHICLE_VALUES = new Set<string>(
  VEHICLE_OPTIONS.map((option) => option.value),
);

export function parseSceneVehicle(value: string): SceneVehicle {
  return VEHICLE_VALUES.has(value) ? (value as SceneVehicle) : "sedan";
}

export const ROUGH_SHOT_OPTIONS = [
  { value: "wide_front_left", label: "Wide · front left" },
  { value: "wide_front_right", label: "Wide · front right" },
  { value: "wide_rear", label: "Wide · rear" },
  {
    value: "medium_front_left_three_quarter",
    label: "Medium ¾ · front left",
  },
  {
    value: "medium_front_right_three_quarter",
    label: "Medium ¾ · front right",
  },
  {
    value: "medium_rear_left_three_quarter",
    label: "Medium ¾ · rear left",
  },
  {
    value: "medium_rear_right_three_quarter",
    label: "Medium ¾ · rear right",
  },
  { value: "interior_over_shoulder", label: "Interior · over shoulder" },
  {
    value: "interior_passenger_to_driver",
    label: "Interior · passenger to driver",
  },
  {
    value: "interior_driver_to_passenger",
    label: "Interior · driver to passenger",
  },
  { value: "interior_side_window", label: "Interior · side window" },
] as const;

export type RoughShot = (typeof ROUGH_SHOT_OPTIONS)[number]["value"];

const ROUGH_SHOT_VALUES = new Set<string>(
  ROUGH_SHOT_OPTIONS.map((option) => option.value),
);

export function parseRoughShot(value: string): RoughShot | null {
  return ROUGH_SHOT_VALUES.has(value) ? (value as RoughShot) : null;
}

export function roughShotLabel(value: string | null): string {
  if (!value) return "Not specified";
  return (
    ROUGH_SHOT_OPTIONS.find((option) => option.value === value)?.label ??
    value.replaceAll("_", " ")
  );
}

function normalizedKeywords(keywords: string[]): string[] {
  return [
    ...new Set(
      keywords
        .map((keyword) => keyword.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function preserveNiceToHavePriority(
  analyzedKeywords: string[],
  niceToHaveKeywords: string[],
): { mustHave: string[]; niceToHave: string[] } {
  const niceToHave = normalizedKeywords(niceToHaveKeywords);
  const niceToHaveSet = new Set(niceToHave);
  return {
    mustHave: normalizedKeywords(analyzedKeywords).filter(
      (keyword) => !niceToHaveSet.has(keyword),
    ),
    niceToHave,
  };
}

type InheritedStage = {
  production_approach_override: null;
  stage_profile_id_override: null;
  custom_stage_name_override: null;
};

type ListedStage = {
  production_approach_override: "listed_led_stage";
  stage_profile_id_override: string;
  custom_stage_name_override: null;
};

type NonListedStage = {
  production_approach_override: "undecided" | "vfx_no_led_wall";
  stage_profile_id_override: null;
  custom_stage_name_override: null;
};

export type SceneStageUpdate =
  | InheritedStage
  | ListedStage
  | NonListedStage;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSceneStageChoice(
  choice: string,
): SceneStageUpdate | null {
  if (choice === "inherit") {
    return {
      production_approach_override: null,
      stage_profile_id_override: null,
      custom_stage_name_override: null,
    };
  }

  if (choice === "undecided" || choice === "vfx_no_led_wall") {
    return {
      production_approach_override: choice,
      stage_profile_id_override: null,
      custom_stage_name_override: null,
    };
  }

  const stageId = choice.startsWith("stage:") ? choice.slice(6) : "";
  if (UUID_PATTERN.test(stageId)) {
    return {
      production_approach_override: "listed_led_stage",
      stage_profile_id_override: stageId,
      custom_stage_name_override: null,
    };
  }

  return null;
}
