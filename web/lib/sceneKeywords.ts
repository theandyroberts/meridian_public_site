const MAX_KEYWORDS = 16;

export async function extractSceneKeywords(
  description: string,
): Promise<string[]> {
  if (!description.trim()) return [];

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
              "Extract concise visual-production search terms from a scene brief. Focus on geography, environment, road type, time of day, weather, traffic, motion, camera direction, mood, vehicle context, and distinctive landmarks. Omit character names and plot details. Use lower-case phrases, remove duplicates, and return 8 to 16 terms.",
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
              },
              required: ["keywords"],
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

    const parsed = JSON.parse(outputText) as { keywords?: unknown };
    if (!Array.isArray(parsed.keywords)) {
      throw new Error("Scene keyword extraction returned invalid output.");
    }

    const keywords = normalizeSceneKeywords(parsed.keywords);
    if (!keywords.length) {
      throw new Error("Scene keyword extraction returned no keywords.");
    }
    return keywords;
  } catch (error) {
    throw new Error(
      `OpenAI scene keyword analysis is unavailable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
      { cause: error },
    );
  }
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
