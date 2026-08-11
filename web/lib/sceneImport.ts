import {
  SCENE_PRODUCTION_LIST_FIELDS,
  SCENE_PRODUCTION_TEXT_FIELDS,
  STAGE_USE_TYPES,
  type SceneProductionMetadata,
  type StageUseType,
} from "@/lib/sceneProduction";

export const SCENE_IMPORT_SCHEMA_VERSION =
  "the-plate-lab.scene-import.v2" as const;

export const MAX_SCENE_IMPORT_COUNT = 250;
export const MAX_SCENE_IMPORT_BYTES = 1_000_000;

export type SceneImportScene = {
  scene_name: string;
  script_scene_number: string;
  script_pages: string;
  description: string;
  search_intent_summary: string;
  continuity_group: string;
  stage_use_type: StageUseType;
  production_metadata: SceneProductionMetadata;
  search_keywords: string[];
};

export type SceneImportDocument = {
  schema_version: typeof SCENE_IMPORT_SCHEMA_VERSION;
  scenes: SceneImportScene[];
};

export const SCENE_EXTRACTION_PROMPT = `Scan the attached screenplay—either a standard feature/spec screenplay or a numbered shooting script—and identify every scene that could use a 360-degree LED volume or car-process stage.

The screenplay is private. Do not quote dialogue or reproduce screenplay passages. Extract only the creator-controlled production metadata needed to find background plates.

Handle both script formats:
- Numbered shooting script: copy the printed scene number exactly, including lettered inserts such as "41A". Copy the printed script page labels exactly, including revision pages such as "74A", "74B", or "74A–75". Ignore scenes marked OMITTED or DELETED. Do not treat CONTINUED headings, shot numbers, setup numbers, revision marks, or camera directions as separate scenes by themselves.
- Standard feature/spec screenplay: if no scene number is printed, use an empty string for script_scene_number. Use the printed screenplay page or page range when visible; otherwise use an empty string. Never substitute the PDF viewer's page count for a printed script page.
- Either format: use the entire screenplay as context, not only the current scene heading. Look backward and forward through adjacent scenes, continuous sequences, departures, arrivals, intercuts, and later establishing shots when determining the exterior environment. You may carry forward or backward a location, time of day, weather condition, vehicle, motion state, or travel direction only when screenplay continuity clearly establishes it.
- Distinguish supported derivation from guessing. An exterior street scene followed by INT. CAR - CONTINUOUS may inherit that street environment. A departure and later arrival may establish a broad route transition, but do not invent the road taken, landmarks, traffic, weather, direction, or window orientation. Do not use knowledge of the released film or external plot information.
- Do not guess a missing scene number or page number. When the screenplay establishes an interior vehicle scene but does not establish the exterior environment, retain it as an unspecified plate candidate instead of assigning an invented location.

Create one JSON scene for each distinct plate setup, not automatically one for every screenplay heading. Keep a continuous vehicle/window environment together. If one screenplay scene clearly needs different vehicles, locations, travel directions, times of day, or window orientations, split it into separate JSON scenes and give each a clear setup-specific name. Reuse the same printed scene number and page range for those split setups.

Classify each candidate by stage_use_type:
- vehicle_process: moving or stationary exterior views through vehicle or transit windows.
- walk_off: performers remain within the stage while a moving environment or encircling camera creates travel, such as a boardwalk walk-and-talk or a 360-degree orbit.
- stationary_environment: a contained performance needs a convincing surrounding environment but no simulated travel.
- other: a credible volume use that does not fit the three types above.

Assign the same short continuity_group to scenes whose location, time of day, weather, or other visible continuity should influence matching. Leave continuity_group empty when no relationship is established. Continuity is guidance, not a reason to invent details or exclude otherwise useful plates.

Analyze locations by visible production features rather than jurisdiction. A named city, neighborhood, street, airport, or venue is story geography, not visual evidence by itself. Do not infer building height, architecture, street grid or width, terrain, vegetation, climate, traffic, road markings, density, or window orientation from common knowledge of that place. Describe only features established in the scene or by clear screenplay continuity; otherwise say they are unspecified.

Express doubling potential through visible traits and constraints. Favor supported attributes such as built form, road geometry, grade, vegetation, visual density, frontage, infrastructure, surface, lighting, and distinctive background elements. Identify a plate as narrowly substitutable only when required visible tells—such as a landmark, skyline relationship, legible sign, transit identity, distinctive infrastructure, or jurisdiction-specific marking—would reveal the place. Treat removable signs and branding as cleanup or dressing constraints, not as the location category itself.

Before returning JSON, inventory every vehicle interior in the screenplay, including parked, secondary, pursuit, convoy, bus, train, subway, and brief interiors. An unspecified exterior is not a reason to omit a candidate. Then check for duplicate records: merge continuous views of the same vehicle, environment, and time unless they require materially different assets; split different vehicles, environments, motion states, or times of day. Character seating alone never establishes a window orientation.

Also inventory non-vehicle scenes where a surrounding environment materially helps production: walk-offs and walk-and-talks, camera orbits, performance areas with moving backgrounds, stationary overlooks, rooftops, boardwalks, platforms, and other contained settings that benefit from controllable 360-degree surroundings. Do not include a scene merely because it has an exterior location; include it only when the volume is a credible production approach.

For each qualifying scene:
- scene_name: a concise, neutral, human-readable setup name. Describe the vehicle environment rather than character names, story beats, or spoilers. Do not append the page number.
- script_scene_number: the printed screenplay scene number exactly as shown, or an empty string if none is printed.
- script_pages: the printed screenplay page label or inclusive range exactly as shown, for example "42", "74–75", or "74A–74B"; use an empty string if no printed page is visible.
- description: a self-contained, plain-language brief describing only the visible surrounding environment or plate the stage must provide. Lead with the supported visible location signature, then include relevant story geography, road type, built form, road geometry, terrain, vegetation, visual density, weather, time of day, traffic, performer or vehicle movement, camera/travel direction, window orientation when applicable, visible tells or landmarks, and substitution constraints. Explicitly call unsupported material attributes unspecified. Do not quote dialogue, repeat screenplay prose, expose plot twists, or invent unsupported details.
- search_intent_summary: exactly one plain-language sentence, no more than 320 characters, stating the environment or plate being sought. It must be useful at a glance and contain no character names, spoilers, or dialogue.
- continuity_group: a short, neutral label shared by setups that should retain visible continuity, or an empty string.
- stage_use_type: one of "vehicle_process", "walk_off", "stationary_environment", or "other".
- production_metadata: structured production facts. Use "unspecified" for an unknown scalar field and an empty array for an unknown list. Never infer unsupported facts. Required scalar fields are location_signature, story_geography, environment_type, time_of_day, weather, movement, traffic, camera_direction, and window_orientation. Required list fields are required_visual_elements and substitution_constraints.
- search_keywords: 6–16 short, specific search phrases derived from supported visible features, such as "private wooded road", "midnight", "cold mist", "guard gate", or "driver-side view". Prioritize reusable visual traits over city names. Include a place name only when the screenplay requires a visible geographic identifier or the term is necessary to retrieve the visual type.

Return only valid JSON. Do not wrap it in Markdown or add commentary. Use this exact structure:

{
  "schema_version": "the-plate-lab.scene-import.v2",
  "scenes": [
    {
      "scene_name": "Estate road – moving car interior",
      "script_scene_number": "41",
      "script_pages": "42",
      "description": "Interior driving plate on a narrow private road through dense New England woods at midnight. Cold mist, no traffic, with a carved wooden elephant and guard gate visible from the driver-side window.",
      "search_intent_summary": "Find a deserted, misty private woodland road at midnight with a guard gate visible from a moving car.",
      "continuity_group": "estate escape night",
      "stage_use_type": "vehicle_process",
      "production_metadata": {
        "location_signature": "narrow private road through dense woods",
        "story_geography": "New England estate",
        "environment_type": "woodland estate road",
        "time_of_day": "midnight",
        "weather": "cold mist",
        "movement": "moving vehicle",
        "traffic": "none",
        "camera_direction": "unspecified",
        "window_orientation": "driver side",
        "required_visual_elements": ["guard gate", "carved wooden elephant"],
        "substitution_constraints": []
      },
      "search_keywords": [
        "private wooded road",
        "New England",
        "midnight",
        "cold mist",
        "no traffic",
        "guard gate",
        "driver-side view"
      ]
    }
  ]
}

Include vehicle-process, walk-off, stationary-environment, and other credible volume candidates. A parked-car view can qualify. An interior vehicle scene with an unspecified exterior can qualify when the screenplay establishes on-screen travel or an interior conversation that could show windows; describe the exterior as unspecified and do not invent search attributes. An exterior-only vehicle shot with no required window view does not qualify as vehicle_process but may qualify under another type when the volume provides a material production benefit. If no scenes qualify, return the same object with an empty scenes array.`;

export class SceneImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneImportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  location: string,
) {
  const unexpected = Object.keys(value).filter(
    (key) => !allowed.includes(key),
  );
  if (unexpected.length) {
    throw new SceneImportError(
      `${location} contains unsupported field${
        unexpected.length === 1 ? "" : "s"
      }: ${unexpected.join(", ")}.`,
    );
  }
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SceneImportError(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new SceneImportError(
      `${field} must be ${maxLength} characters or fewer.`,
    );
  }
  return normalized;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new SceneImportError(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new SceneImportError(
      `${field} must be ${maxLength} characters or fewer.`,
    );
  }
  return normalized;
}

function sceneKeywords(value: unknown, sceneIndex: number): string[] {
  if (!Array.isArray(value)) {
    throw new SceneImportError(
      `Scene ${sceneIndex} search_keywords must be an array.`,
    );
  }

  const keywords = value.map((keyword, keywordIndex) => {
    if (typeof keyword !== "string" || !keyword.trim()) {
      throw new SceneImportError(
        `Scene ${sceneIndex} keyword ${keywordIndex + 1} must be text.`,
      );
    }
    const normalized = keyword.trim().toLowerCase();
    if (normalized.length > 80) {
      throw new SceneImportError(
        `Scene ${sceneIndex} keywords must be 80 characters or fewer.`,
      );
    }
    return normalized;
  });
  const uniqueKeywords = [...new Set(keywords)];

  if (uniqueKeywords.length < 3 || uniqueKeywords.length > 24) {
    throw new SceneImportError(
      `Scene ${sceneIndex} must have between 3 and 24 distinct search keywords.`,
    );
  }
  return uniqueKeywords;
}

function sceneStringList(
  value: unknown,
  sceneIndex: number,
  field: string,
): string[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new SceneImportError(
      `Scene ${sceneIndex} ${field} must be an array of at most 16 items.`,
    );
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new SceneImportError(
        `Scene ${sceneIndex} ${field} entries must be non-empty text.`,
      );
    }
    const normalized = item.trim().replace(/\s+/g, " ");
    if (normalized.length > 160) {
      throw new SceneImportError(
        `Scene ${sceneIndex} ${field} entries must be 160 characters or fewer.`,
      );
    }
    unique.add(normalized);
  }
  return [...unique];
}

function sceneProductionMetadata(
  value: unknown,
  sceneIndex: number,
): SceneProductionMetadata {
  if (!isRecord(value)) {
    throw new SceneImportError(
      `Scene ${sceneIndex} production_metadata must be an object.`,
    );
  }
  assertOnlyKeys(
    value,
    [...SCENE_PRODUCTION_TEXT_FIELDS, ...SCENE_PRODUCTION_LIST_FIELDS],
    `Scene ${sceneIndex} production_metadata`,
  );

  return {
    location_signature: requiredString(
      value.location_signature,
      `Scene ${sceneIndex} production_metadata.location_signature`,
      300,
    ),
    story_geography: requiredString(
      value.story_geography,
      `Scene ${sceneIndex} production_metadata.story_geography`,
      300,
    ),
    environment_type: requiredString(
      value.environment_type,
      `Scene ${sceneIndex} production_metadata.environment_type`,
      300,
    ),
    time_of_day: requiredString(
      value.time_of_day,
      `Scene ${sceneIndex} production_metadata.time_of_day`,
      300,
    ),
    weather: requiredString(
      value.weather,
      `Scene ${sceneIndex} production_metadata.weather`,
      300,
    ),
    movement: requiredString(
      value.movement,
      `Scene ${sceneIndex} production_metadata.movement`,
      300,
    ),
    traffic: requiredString(
      value.traffic,
      `Scene ${sceneIndex} production_metadata.traffic`,
      300,
    ),
    camera_direction: requiredString(
      value.camera_direction,
      `Scene ${sceneIndex} production_metadata.camera_direction`,
      300,
    ),
    window_orientation: requiredString(
      value.window_orientation,
      `Scene ${sceneIndex} production_metadata.window_orientation`,
      300,
    ),
    required_visual_elements: sceneStringList(
      value.required_visual_elements,
      sceneIndex,
      "production_metadata.required_visual_elements",
    ),
    substitution_constraints: sceneStringList(
      value.substitution_constraints,
      sceneIndex,
      "production_metadata.substitution_constraints",
    ),
  };
}

export function parseSceneImportDocument(
  value: unknown,
  options: { allowEmpty?: boolean } = {},
): SceneImportDocument {
  if (!isRecord(value)) {
    throw new SceneImportError("The import must be a JSON object.");
  }
  assertOnlyKeys(value, ["schema_version", "scenes"], "The import");

  if (value.schema_version !== SCENE_IMPORT_SCHEMA_VERSION) {
    throw new SceneImportError(
      `schema_version must be "${SCENE_IMPORT_SCHEMA_VERSION}".`,
    );
  }
  if (!Array.isArray(value.scenes)) {
    throw new SceneImportError("scenes must be an array.");
  }
  if (!options.allowEmpty && value.scenes.length === 0) {
    throw new SceneImportError(
      "The file contains no driving-plate scenes to import.",
    );
  }
  if (value.scenes.length > MAX_SCENE_IMPORT_COUNT) {
    throw new SceneImportError(
      `A single file can contain at most ${MAX_SCENE_IMPORT_COUNT} scenes.`,
    );
  }

  const scenes = value.scenes.map((scene, index) => {
    const sceneIndex = index + 1;
    if (!isRecord(scene)) {
      throw new SceneImportError(`Scene ${sceneIndex} must be an object.`);
    }
    assertOnlyKeys(
      scene,
      [
        "scene_name",
        "script_scene_number",
        "script_pages",
        "description",
        "search_intent_summary",
        "continuity_group",
        "stage_use_type",
        "production_metadata",
        "search_keywords",
      ],
      `Scene ${sceneIndex}`,
    );

    return {
      scene_name: requiredString(
        scene.scene_name,
        `Scene ${sceneIndex} scene_name`,
        200,
      ),
      script_scene_number: optionalString(
        scene.script_scene_number,
        `Scene ${sceneIndex} script_scene_number`,
        40,
      ),
      script_pages: optionalString(
        scene.script_pages,
        `Scene ${sceneIndex} script_pages`,
        80,
      ),
      description: requiredString(
        scene.description,
        `Scene ${sceneIndex} description`,
        12_000,
      ),
      search_intent_summary: requiredString(
        scene.search_intent_summary,
        `Scene ${sceneIndex} search_intent_summary`,
        320,
      ),
      continuity_group: optionalString(
        scene.continuity_group,
        `Scene ${sceneIndex} continuity_group`,
        120,
      ).toLocaleLowerCase(),
      stage_use_type:
        typeof scene.stage_use_type === "string" &&
        STAGE_USE_TYPES.includes(scene.stage_use_type as StageUseType)
          ? (scene.stage_use_type as StageUseType)
          : (() => {
              throw new SceneImportError(
                `Scene ${sceneIndex} stage_use_type must be one of ${STAGE_USE_TYPES.join(", ")}.`,
              );
            })(),
      production_metadata: sceneProductionMetadata(
        scene.production_metadata,
        sceneIndex,
      ),
      search_keywords: sceneKeywords(
        scene.search_keywords,
        sceneIndex,
      ),
    };
  });

  return {
    schema_version: SCENE_IMPORT_SCHEMA_VERSION,
    scenes,
  };
}

export function parseSceneImportJson(
  source: string,
  options?: { allowEmpty?: boolean },
): SceneImportDocument {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new SceneImportError(
      "This file is not valid JSON. Ask the AI tool to return JSON only.",
    );
  }
  return parseSceneImportDocument(value, options);
}

export function serializeSceneImportDocument(
  scenes: SceneImportScene[],
): string {
  return JSON.stringify(
    parseSceneImportDocument({
      schema_version: SCENE_IMPORT_SCHEMA_VERSION,
      scenes,
    }),
  );
}
