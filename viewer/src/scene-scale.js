export const FEET_TO_SCENE_UNITS = 0.18

export function feetToSceneUnits(feet) {
  return feet * FEET_TO_SCENE_UNITS
}

export function scaleModelToLength(modelLength, targetLengthFt) {
  return feetToSceneUnits(targetLengthFt) / Math.max(modelLength, 0.001)
}
