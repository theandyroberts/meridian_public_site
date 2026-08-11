export const NICE_TO_HAVE_RANK_WEIGHT = 0.25;

export type PrioritizedSearchRow = {
  id: string;
  hybrid_score: number;
};

export function rankPrioritizedSceneMatches<
  Row extends PrioritizedSearchRow,
>(
  mustHaveRows: Row[],
  niceToHaveRows: Row[],
  niceToHaveWeight = NICE_TO_HAVE_RANK_WEIGHT,
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

  return [...ranked.values()]
    .sort(
      (left, right) =>
        right.weightedScore - left.weightedScore ||
        left.row.id.localeCompare(right.row.id),
    )
    .map((entry) => entry.row);
}
