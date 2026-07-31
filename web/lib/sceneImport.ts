export const SCENE_IMPORT_SCHEMA_VERSION =
  "the-plate-lab.scene-import.v1" as const;

export const MAX_SCENE_IMPORT_COUNT = 250;
export const MAX_SCENE_IMPORT_BYTES = 1_000_000;

export type SceneImportScene = {
  scene_name: string;
  script_scene_number: string;
  script_pages: string;
  description: string;
  search_keywords: string[];
};

export type SceneImportDocument = {
  schema_version: typeof SCENE_IMPORT_SCHEMA_VERSION;
  scenes: SceneImportScene[];
};

export const SCENE_EXTRACTION_PROMPT = `Scan the attached screenplay—either a standard feature/spec screenplay or a numbered shooting script—and identify every scene that could use driving plates on a volumetric 360-degree soundstage.

The screenplay is private. Do not quote dialogue or reproduce screenplay passages. Extract only the creator-controlled production metadata needed to find background plates.

Handle both script formats:
- Numbered shooting script: copy the printed scene number exactly, including lettered inserts such as "41A". Copy the printed script page labels exactly, including revision pages such as "74A", "74B", or "74A–75". Ignore scenes marked OMITTED or DELETED. Do not treat CONTINUED headings, shot numbers, setup numbers, revision marks, or camera directions as separate scenes by themselves.
- Standard feature/spec screenplay: if no scene number is printed, use an empty string for script_scene_number. Use the printed screenplay page or page range when visible; otherwise use an empty string. Never substitute the PDF viewer's page count for a printed script page.
- Either format: use the scene heading and action to understand the setting. Do not guess a missing scene number, page number, location, weather, traffic, direction, or time of day.

Create one JSON scene for each distinct plate setup, not automatically one for every screenplay heading. Keep a continuous vehicle/window environment together. If one screenplay scene clearly needs different vehicles, locations, travel directions, times of day, or window orientations, split it into separate JSON scenes and give each a clear setup-specific name. Reuse the same printed scene number and page range for those split setups.

For each qualifying scene:
- scene_name: a concise, human-readable scene name. Do not append the page number.
- script_scene_number: the printed screenplay scene number exactly as shown, or an empty string if none is printed.
- script_pages: the printed screenplay page label or inclusive range exactly as shown, for example "42", "74–75", or "74A–74B"; use an empty string if no printed page is visible.
- description: a self-contained, plain-language plate brief describing only what must appear outside the vehicle windows. Include relevant location, road type, weather, time of day, traffic, vehicle/camera travel direction, window orientation, visible landmarks, motion or stationary state, and mood. Do not quote dialogue, repeat screenplay prose, expose plot twists, or invent unsupported details.
- search_keywords: 6–16 short, specific search phrases derived from the scene, such as "private wooded road", "midnight", "cold mist", "guard gate", or "driver-side view".

Return only valid JSON. Do not wrap it in Markdown or add commentary. Use this exact structure:

{
  "schema_version": "the-plate-lab.scene-import.v1",
  "scenes": [
    {
      "scene_name": "Marta escapes the estate",
      "script_scene_number": "41",
      "script_pages": "42",
      "description": "Interior driving plate on a narrow private road through dense New England woods at midnight. Cold mist, no traffic, with a carved wooden elephant and guard gate visible from the driver-side window.",
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

Include only scenes that genuinely need moving or stationary exterior views through vehicle windows. A parked-car view can qualify; an exterior-only vehicle shot with no required window view does not. If no scenes qualify, return the same object with an empty scenes array.`;

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
