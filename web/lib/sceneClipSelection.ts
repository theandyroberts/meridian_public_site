export type SceneClipSelectionUpdate = {
  inFrame: number;
  outFrame: number;
  expectedVersion: number;
};

export const LICENSING_DURATION_TIERS_SECONDS = [60, 120] as const;

export type SceneClipLicenseTierEvaluation = {
  durationFrames: number;
  durationSeconds: number;
  tierSeconds: number | null;
  previousTierSeconds: number | null;
  nextTierSeconds: number | null;
  framesFromBoundary: number | null;
  boundary: "approaching" | "at" | "crossed" | "exceeded" | null;
};

export function evaluateSceneClipLicenseTier(
  inFrame: number | null,
  outFrame: number | null,
  fps: number,
  tiers: readonly number[] = LICENSING_DURATION_TIERS_SECONDS,
): SceneClipLicenseTierEvaluation | null {
  if (
    !Number.isSafeInteger(inFrame) ||
    !Number.isSafeInteger(outFrame) ||
    inFrame === null ||
    outFrame === null ||
    outFrame <= inFrame ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    return null;
  }

  const normalizedTiers = [...new Set(tiers)]
    .filter((tier) => Number.isSafeInteger(tier) && tier > 0)
    .sort((left, right) => left - right);
  if (!normalizedTiers.length) return null;

  const durationFrames = outFrame - inFrame + 1;
  const durationSeconds = durationFrames / fps;
  const tierIndex = normalizedTiers.findIndex(
    (tier) => durationFrames <= Math.floor(tier * fps + Number.EPSILON),
  );
  const oneSecondFrames = Math.max(1, Math.round(fps));

  if (tierIndex === -1) {
    const highestTier = normalizedTiers.at(-1) ?? null;
    const highestLimit = highestTier === null
      ? null
      : Math.floor(highestTier * fps + Number.EPSILON);
    return {
      durationFrames,
      durationSeconds,
      tierSeconds: null,
      previousTierSeconds: highestTier,
      nextTierSeconds: null,
      framesFromBoundary: highestLimit === null ? null : durationFrames - highestLimit,
      boundary: "exceeded",
    };
  }

  const tierSeconds = normalizedTiers[tierIndex];
  const tierLimit = Math.floor(tierSeconds * fps + Number.EPSILON);
  const previousTierSeconds = tierIndex > 0 ? normalizedTiers[tierIndex - 1] : null;
  const nextTierSeconds = normalizedTiers[tierIndex + 1] ?? null;
  const previousLimit = previousTierSeconds === null
    ? null
    : Math.floor(previousTierSeconds * fps + Number.EPSILON);
  const framesRemaining = tierLimit - durationFrames;
  const framesPastPrevious = previousLimit === null
    ? null
    : durationFrames - previousLimit;

  let boundary: SceneClipLicenseTierEvaluation["boundary"] = null;
  let framesFromBoundary: number | null = null;
  if (framesRemaining === 0) {
    boundary = "at";
    framesFromBoundary = 0;
  } else if (framesRemaining > 0 && framesRemaining <= oneSecondFrames) {
    boundary = "approaching";
    framesFromBoundary = framesRemaining;
  } else if (
    framesPastPrevious !== null &&
    framesPastPrevious > 0 &&
    framesPastPrevious <= oneSecondFrames
  ) {
    boundary = "crossed";
    framesFromBoundary = framesPastPrevious;
  }

  return {
    durationFrames,
    durationSeconds,
    tierSeconds,
    previousTierSeconds,
    nextTierSeconds,
    framesFromBoundary,
    boundary,
  };
}

export function parseSceneClipSelectionUpdate(
  value: unknown,
): SceneClipSelectionUpdate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const inFrame = Number(input.inFrame);
  const outFrame = Number(input.outFrame);
  const expectedVersion = Number(input.expectedVersion);

  if (
    !Number.isSafeInteger(inFrame) ||
    !Number.isSafeInteger(outFrame) ||
    !Number.isSafeInteger(expectedVersion) ||
    inFrame < 0 ||
    outFrame <= inFrame ||
    expectedVersion < 1
  ) {
    return null;
  }

  return { inFrame, outFrame, expectedVersion };
}

export function formatSceneClipSelectionDuration(
  inFrame: number | null,
  outFrame: number | null,
  fps: number,
): string | null {
  if (
    !Number.isSafeInteger(inFrame) ||
    !Number.isSafeInteger(outFrame) ||
    inFrame === null ||
    outFrame === null ||
    outFrame <= inFrame ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    return null;
  }

  const evaluation = evaluateSceneClipLicenseTier(inFrame, outFrame, fps);
  if (!evaluation) return null;
  const { durationFrames: frames, durationSeconds: seconds } = evaluation;
  return `${seconds.toFixed(2)} sec · ${frames} ${frames === 1 ? "frame" : "frames"}`;
}
