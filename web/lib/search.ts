import "server-only";

let embeddingUnavailableUntil = 0;

export async function createQueryEmbedding(
  input: string | null | undefined,
): Promise<string | undefined> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const text = input?.trim();
  if (!apiKey || !text || Date.now() < embeddingUnavailableUntil) {
    return undefined;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        model: "text-embedding-3-large",
        dimensions: 1536,
        encoding_format: "float",
      }),
      cache: "no-store",
    });
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      if (response.status === 429) {
        embeddingUnavailableUntil = Date.now() + 5 * 60_000;
      }
      console.warn(
        `Semantic query embedding unavailable (${response.status}): ${
          body.error?.message ?? "unknown error"
        }`,
      );
      return undefined;
    }

    const embedding = body.data?.[0]?.embedding;
    if (!embedding || embedding.length !== 1536) {
      console.warn("Semantic query embedding returned an unexpected size");
      return undefined;
    }
    return JSON.stringify(embedding);
  } catch (error) {
    console.warn(
      `Semantic query embedding unavailable: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return undefined;
  }
}
