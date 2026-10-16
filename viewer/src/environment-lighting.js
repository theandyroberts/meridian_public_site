export function createEnvironmentUpdateGate(maxHz = 20) {
  let previousKey = null
  let previousTime = null
  let lastUpdate = -Infinity
  return {
    reset() { previousKey = null; previousTime = null; lastUpdate = -Infinity },
    shouldUpdate(now, mediaTime, key) {
      // User edits and source changes also refresh paused footage immediately.
      if (key !== previousKey || (mediaTime !== previousTime && now - lastUpdate >= 1000 / maxHz)) {
        previousKey = key
        previousTime = mediaTime
        lastUpdate = now
        return true
      }
      return false
    },
  }
}

// Restore every scene flag even if an offscreen render throws or is interrupted.
export function captureEnvironment({ renderer, scene, camera, hidden = [], unlitMaterials = [], radianceUniform }) {
  const visibility = hidden.map(object => object.visible)
  const environments = unlitMaterials.map(material => material.envMap)
  const fog = scene.fog
  const toneMapping = renderer.toneMapping
  const captureMode = radianceUniform.value
  try {
    hidden.forEach(object => { object.visible = false })
    // Avoid sampling the cubemap that is currently being rendered (feedback).
    unlitMaterials.forEach(material => { material.envMap = null })
    scene.fog = null
    renderer.toneMapping = 0 // THREE.NoToneMapping: keep the environment in linear light.
    radianceUniform.value = 1
    camera.update(renderer, scene)
  } finally {
    hidden.forEach((object, i) => { object.visible = visibility[i] })
    unlitMaterials.forEach((material, i) => { material.envMap = environments[i] })
    scene.fog = fog
    renderer.toneMapping = toneMapping
    radianceUniform.value = captureMode
  }
}
