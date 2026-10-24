export const FEET_TO_SCENE_UNITS = 0.18

export function feetToSceneUnits(feet) {
  return feet * FEET_TO_SCENE_UNITS
}

export function scaleModelToLength(modelLength, targetLengthFt) {
  return feetToSceneUnits(targetLengthFt) / Math.max(modelLength, 0.001)
}

export function clampPointToStageInterior(
  point,
  { diameterFt, heightFt },
  marginFt = 1,
) {
  const margin = Math.max(0, feetToSceneUnits(marginFt))
  const radius = Math.max(0, feetToSceneUnits(diameterFt) / 2 - margin)
  const height = Math.max(0, feetToSceneUnits(heightFt) - margin)
  const horizontalDistance = Math.hypot(point.x, point.z)
  const horizontalScale = horizontalDistance > radius && horizontalDistance > 0
    ? radius / horizontalDistance
    : 1

  return {
    x: point.x * horizontalScale,
    y: Math.min(Math.max(point.y, margin), height),
    z: point.z * horizontalScale,
  }
}
