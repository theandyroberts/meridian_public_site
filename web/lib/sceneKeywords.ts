import {
  EMPTY_SCENE_PRODUCTION_METADATA,
  normalizeSceneProductionMetadata,
  type SceneProductionMetadata,
} from "@/lib/sceneProduction";

const MAX_KEYWORDS = 16;

export type SceneSearchAnalysis = {
  keywords: string[];
  searchIntentSummary: string;
  productionMetadata: SceneProductionMetadata;
};

export async function extractSceneKeywords(
  description: string,
): Promise<string[]> {
  return (await analyzeSceneSearchBrief(description)).keywords;
}

export async function analyzeSceneSearchBrief(
  description: string,
): Promise<SceneSearchAnalysis> {
  if (!description.trim()) {
    return {
      keywords: [],
      searchIntentSummary: "",
      productionMetadata: EMPTY_SCENE_PRODUCTION_METADATA,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for scene keyword analysis.");
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:
          process.env.OPENAI_SCENE_KEYWORD_MODEL?.trim() ||
          "gpt-5.6-luna",
        reasoning: { effort: "none" },
        input: [
          {
            role: "system",
            content:
              "Analyze a production scene brief for a 360-degree LED volume. Return concise visual-production search terms, a single plain-language sentence summarizing the plate or environment being sought, and structured production metadata. Use only details supported by the brief; write 'unspecified' for an unknown scalar field and use an empty array for unknown list fields. Omit character names, dialogue, spoilers, and plot details. Search terms must be lower-case, distinct phrases. The summary must be one sentence and no more than 320 characters.",
          },
          {
            role: "user",
            content: description,
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "scene_search_keywords",
            strict: true,
            schema: {
              type: "object",
              properties: {
                keywords: {
                  type: "array",
                  minItems: 1,
                  maxItems: MAX_KEYWORDS,
                  items: { type: "string" },
                },
                search_intent_summary: {
                  type: "string",
                  minLength: 1,
                  maxLength: 320,
                },
                production_metadata: {
                  type: "object",
                  properties: {
                    location_signature: { type: "string", maxLength: 300 },
                    story_geography: { type: "string", maxLength: 300 },
                    environment_type: { type: "string", maxLength: 300 },
                    time_of_day: { type: "string", maxLength: 300 },
                    weather: { type: "string", maxLength: 300 },
                    movement: { type: "string", maxLength: 300 },
                    traffic: { type: "string", maxLength: 300 },
                    camera_direction: { type: "string", maxLength: 300 },
                    window_orientation: { type: "string", maxLength: 300 },
                    required_visual_elements: {
                      type: "array",
                      maxItems: 16,
                      items: { type: "string", maxLength: 160 },
                    },
                    substitution_constraints: {
                      type: "array",
                      maxItems: 16,
                      items: { type: "string", maxLength: 160 },
                    },
                  },
                  required: [
                    "location_signature",
                    "story_geography",
                    "environment_type",
                    "time_of_day",
                    "weather",
                    "movement",
                    "traffic",
                    "camera_direction",
                    "window_orientation",
                    "required_visual_elements",
                    "substitution_constraints",
                  ],
                  additionalProperties: false,
                },
              },
              required: [
                "keywords",
                "search_intent_summary",
                "production_metadata",
              ],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(
        `Scene keyword extraction failed with status ${response.status}.`,
      );
    }

    const body = (await response.json()) as {
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };
    const outputText = body.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    if (!outputText) {
      throw new Error("Scene keyword extraction returned no output.");
    }

    const parsed = JSON.parse(outputText) as {
      keywords?: unknown;
      search_intent_summary?: unknown;
      production_metadata?: unknown;
    };
    if (!Array.isArray(parsed.keywords)) {
      throw new Error("Scene keyword extraction returned invalid output.");
    }

    const keywords = normalizeSceneKeywords(parsed.keywords);
    if (!keywords.length) {
      throw new Error("Scene keyword extraction returned no keywords.");
    }
    const searchIntentSummary = normalizeSearchIntentSummary(
      parsed.search_intent_summary,
    );
    if (!searchIntentSummary) {
      throw new Error("Scene analysis returned no search-intent summary.");
    }
    return {
      keywords,
      searchIntentSummary,
      productionMetadata: normalizeSceneProductionMetadata(
        parsed.production_metadata,
      ),
    };
  } catch (error) {
    throw new Error(
      `OpenAI scene keyword analysis is unavailable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      { cause: error },
    );
  }
}

export function normalizeSearchIntentSummary(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 320);
}

export function normalizeSceneKeywords(values: unknown[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value
      .trim()
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    if (normalized.length < 2) continue;
    unique.add(normalized);
    if (unique.size >= MAX_KEYWORDS) break;
  }

  return [...unique];
}
