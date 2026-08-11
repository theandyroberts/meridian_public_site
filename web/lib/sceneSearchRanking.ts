export const NICE_TO_HAVE_RANK_WEIGHT = 0.25;
export const CONTINUITY_RANK_WEIGHT = 0.12;

export type PrioritizedSearchRow = {
  id: string;
  hybrid_score: number;
};

export function rankPrioritizedSceneMatches<
  Row extends PrioritizedSearchRow,
>(
  mustHaveRows: Row[],
  niceToHaveRows: Row[],
  continuityRows: Row[] = [],
  niceToHaveWeight = NICE_TO_HAVE_RANK_WEIGHT,
  continuityWeight = CONTINUITY_RANK_WEIGHT,
): Row[] {
  const ranked = new Map<
    string,
    { row: Row; weightedScore: number }
  >();

  for (const row of mustHaveRows) {
    ranked.set(row.id, { row, weightedScore: row.hybrid_score });
  }

  for (const row of niceToHaveRows) {
    const niceBoost = row.hybrid_score * niceToHaveWeight;
    const existing = ranked.get(row.id);
    if (existing) {
      existing.weightedScore += niceBoost;
      continue;
    }
    ranked.set(row.id, { row, weightedScore: niceBoost });
  }

  for (const row of continuityRows) {
    const continuityBoost = row.hybrid_score * continuityWeight;
    const existing = ranked.get(row.id);
    if (existing) {
      existing.weightedScore += continuityBoost;
      continue;
    }
    ranked.set(row.id, { row, weightedScore: continuityBoost });
  }

  return [...ranked.values()]
    .sort(
      (left, right) =>
        right.weightedScore - left.weightedScore ||
        left.row.id.localeCompare(right.row.id),
    )
    .map((entry) => entry.row);
}
