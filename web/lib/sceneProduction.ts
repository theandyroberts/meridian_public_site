export const STAGE_USE_TYPES = [
  "vehicle_process",
  "walk_off",
  "stationary_environment",
  "other",
] as const;

export type StageUseType = (typeof STAGE_USE_TYPES)[number];

export const STAGE_USE_OPTIONS: ReadonlyArray<{
  value: StageUseType;
  label: string;
}> = [
  { value: "vehicle_process", label: "Vehicle process" },
  { value: "walk_off", label: "Walk-off / moving environment" },
  { value: "stationary_environment", label: "Stationary environment" },
  { value: "other", label: "Other volume use" },
];

export const SCENE_PRODUCTION_TEXT_FIELDS = [
  "location_signature",
  "story_geography",
  "environment_type",
  "time_of_day",
  "weather",
  "movement",
  "traffic",
  "camera_direction",
  "window_orientation",
] as const;

export const SCENE_PRODUCTION_LIST_FIELDS = [
  "required_visual_elements",
  "substitution_constraints",
] as const;

export type SceneProductionTextField =
  (typeof SCENE_PRODUCTION_TEXT_FIELDS)[number];
export type SceneProductionListField =
  (typeof SCENE_PRODUCTION_LIST_FIELDS)[number];

export type SceneProductionMetadata = Record<
  SceneProductionTextField,
  string
> &
  Record<SceneProductionListField, string[]>;

export const EMPTY_SCENE_PRODUCTION_METADATA: SceneProductionMetadata = {
  location_signature: "",
  story_geography: "",
  environment_type: "",
  time_of_day: "",
  weather: "",
  movement: "",
  traffic: "",
  camera_direction: "",
  window_orientation: "",
  required_visual_elements: [],
  substitution_constraints: [],
};

export const SCENE_PRODUCTION_FIELD_LABELS: Record<
  SceneProductionTextField | SceneProductionListField,
  string
> = {
  location_signature: "Visible location signature",
  story_geography: "Story geography",
  environment_type: "Environment type",
  time_of_day: "Time of day",
  weather: "Weather",
  movement: "Movement",
  traffic: "Traffic",
  camera_direction: "Camera / travel direction",
  window_orientation: "Window orientation",
  required_visual_elements: "Required visual elements",
  substitution_constraints: "Substitution constraints",
};

function cleanText(value: unknown, maxLength = 300): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const normalized = cleanText(item, 160);
    if (normalized) unique.add(normalized);
    if (unique.size >= 16) break;
  }
  return [...unique];
}

export function normalizeSceneProductionMetadata(
  value: unknown,
): SceneProductionMetadata {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    location_signature: cleanText(source.location_signature),
    story_geography: cleanText(source.story_geography),
    environment_type: cleanText(source.environment_type),
    time_of_day: cleanText(source.time_of_day),
    weather: cleanText(source.weather),
    movement: cleanText(source.movement),
    traffic: cleanText(source.traffic),
    camera_direction: cleanText(source.camera_direction),
    window_orientation: cleanText(source.window_orientation),
    required_visual_elements: cleanList(source.required_visual_elements),
    substitution_constraints: cleanList(source.substitution_constraints),
  };
}

export function sceneProductionMetadataFromForm(
  formData: FormData,
): SceneProductionMetadata {
  const values = Object.fromEntries(
    SCENE_PRODUCTION_TEXT_FIELDS.map((field) => [field, formData.get(field)]),
  );
  const listValues = Object.fromEntries(
    SCENE_PRODUCTION_LIST_FIELDS.map((field) => [
      field,
      String(formData.get(field) ?? "")
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ]),
  );
  return normalizeSceneProductionMetadata({ ...values, ...listValues });
}

export function sceneProductionSearchText(value: unknown): string {
  const metadata = normalizeSceneProductionMetadata(value);
  return [
    ...SCENE_PRODUCTION_TEXT_FIELDS.map((field) => metadata[field]),
    ...SCENE_PRODUCTION_LIST_FIELDS.flatMap((field) => metadata[field]),
  ]
    .filter(Boolean)
    .join(" ");
}

export function parseStageUseType(value: unknown): StageUseType {
  return typeof value === "string" &&
    STAGE_USE_TYPES.includes(value as StageUseType)
    ? (value as StageUseType)
    : "vehicle_process";
}

export function stageUseTypeLabel(value: unknown): string {
  const normalized = parseStageUseType(value);
  return (
    STAGE_USE_OPTIONS.find((option) => option.value === normalized)?.label ??
    "Vehicle process"
  );
}
