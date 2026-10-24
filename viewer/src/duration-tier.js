export const DEFAULT_LICENSE_DURATION_TIERS_SECONDS = Object.freeze([60, 120])

export function normalizeLicenseDurationTiers(value, fallback = DEFAULT_LICENSE_DURATION_TIERS_SECONDS) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(',')
  const normalized = [...new Set(values
    .map(Number)
    .filter((tier) => Number.isSafeInteger(tier) && tier > 0))]
    .sort((left, right) => left - right)
  return normalized.length ? normalized : [...fallback]
}

export function evaluateLicenseDurationTier({ inFrame, outFrame, fps, tiers }) {
  if (
    !Number.isSafeInteger(inFrame)
      || !Number.isSafeInteger(outFrame)
      || outFrame <= inFrame
      || !Number.isFinite(fps)
      || fps <= 0
  ) return null

  const normalizedTiers = normalizeLicenseDurationTiers(tiers)
  const durationFrames = outFrame - inFrame + 1
  const durationSeconds = durationFrames / fps
  const tierIndex = normalizedTiers.findIndex(
    (tier) => durationFrames <= Math.floor(tier * fps + Number.EPSILON),
  )
  const oneSecondFrames = Math.max(1, Math.round(fps))

  if (tierIndex === -1) {
    const highestTier = normalizedTiers.at(-1)
    const highestLimit = Math.floor(highestTier * fps + Number.EPSILON)
    return {
      durationFrames,
      durationSeconds,
      tierSeconds: null,
      previousTierSeconds: highestTier,
      nextTierSeconds: null,
      framesFromBoundary: durationFrames - highestLimit,
      boundary: 'exceeded',
    }
  }

  const tierSeconds = normalizedTiers[tierIndex]
  const tierLimit = Math.floor(tierSeconds * fps + Number.EPSILON)
  const previousTierSeconds = tierIndex > 0 ? normalizedTiers[tierIndex - 1] : null
  const nextTierSeconds = normalizedTiers[tierIndex + 1] ?? null
  const previousLimit = previousTierSeconds === null
    ? null
    : Math.floor(previousTierSeconds * fps + Number.EPSILON)
  const framesRemaining = tierLimit - durationFrames
  const framesPastPrevious = previousLimit === null ? null : durationFrames - previousLimit

  let boundary = null
  let framesFromBoundary = null
  if (framesRemaining === 0) {
    boundary = 'at'
    framesFromBoundary = 0
  } else if (framesRemaining > 0 && framesRemaining <= oneSecondFrames) {
    boundary = 'approaching'
    framesFromBoundary = framesRemaining
  } else if (
    framesPastPrevious !== null
      && framesPastPrevious > 0
      && framesPastPrevious <= oneSecondFrames
  ) {
    boundary = 'crossed'
    framesFromBoundary = framesPastPrevious
  }

  return {
    durationFrames,
    durationSeconds,
    tierSeconds,
    previousTierSeconds,
    nextTierSeconds,
    framesFromBoundary,
    boundary,
  }
}

export function describeLicenseTierBoundary(evaluation) {
  if (!evaluation?.boundary) return ''
  const frames = evaluation.framesFromBoundary
  const frameLabel = `${frames} ${frames === 1 ? 'frame' : 'frames'}`

  if (evaluation.boundary === 'exceeded') {
    return `This selection is ${frameLabel} over the ${evaluation.previousTierSeconds}-second maximum. Shorten it before saving.`
  }
  if (evaluation.boundary === 'at') {
    return evaluation.nextTierSeconds
      ? `This selection is exactly at the ${evaluation.tierSeconds}-second tier limit. One more frame moves it to the ${evaluation.nextTierSeconds}-second tier.`
      : `This selection is exactly at the ${evaluation.tierSeconds}-second maximum. One more frame exceeds the available license tiers.`
  }
  if (evaluation.boundary === 'approaching') {
    return `${frameLabel} remain before this selection moves beyond the ${evaluation.tierSeconds}-second tier.`
  }
  return `This selection is ${frameLabel} over the ${evaluation.previousTierSeconds}-second boundary and now uses the ${evaluation.tierSeconds}-second tier.`
}
