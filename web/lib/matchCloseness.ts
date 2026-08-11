type MatchSignals = {
  keywordScore: number | null | undefined;
  semanticScore: number | null | undefined;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Convert raw search signals into a deliberately conservative user-facing
 * percentage. Embedding cosine similarity below 0.50 is treated as generic
 * language overlap rather than a meaningful production match.
 */
export function matchClosenessPercent({
  keywordScore,
  semanticScore,
}: MatchSignals): number {
  const semanticSignal = clamp01(
    ((Number.isFinite(semanticScore) ? Number(semanticScore) : 0) - 0.5) /
      0.5,
  );
  const keywordSignal = clamp01(
    (Number.isFinite(keywordScore) ? Number(keywordScore) : 0) * 5,
  );

  const calibrated = Math.round(
    (semanticSignal * 0.9 + keywordSignal * 0.1) * 100,
  );

  // A displayed candidate has still been compared with the scene. Keep the
  // weakest result distinct from "not evaluated" while catalog and embedding
  // coverage are still small.
  return Math.max(1, calibrated);
}
