import * as THREE from 'three'

export const ROAD_LIGHT_MODELS = new Set(['ferrari', 'bmwM5', 'escalade', 'raptor', 'mustang1967', 'eldorado'])

// Classify authored slots before the general paint/trim replacement. In
// particular, red lamp glass must never become clear window glass.
export function opticalRole(key, node, material) {
  const name = material.toLowerCase()
  if (key === 'eldorado') {
    if (name === 'meshescadillackit00roofa0011mtl') return 'window'
    if (name === 'meshescadillackit00roofa0031mtl') return 'mixed'
  }
  if (key === 'ferrari') {
    if (node === 'lights') return 'head'
    if (node === 'lights_red') return 'tail'
    if (node === 'leds') return 'running'
    if (node === 'glass') return 'window'
  }
  if (key === 'raptor') {
    if (name === 'glass.006') return 'window'
    if (name === 'vehiclelights.010' && node !== 'Object_179') return 'mixed'
    if (name === 'vehiclelights128.001' || name === 'lasluces.001') return 'tail'
  }
  if (key === 'bmwM5') {
    if (name.includes('window_material')) return 'window'
    if (name.includes('lighta_material')) return 'mixed'
    if (name === 'red_glass') return 'tail'
    if (name === 'tex.013') return 'running'
  }
  if (key === 'escalade') {
    if (name === 'glass') return node === 'Object_10' ? 'head' : 'window'
    if (name === 'red_glass' || name === 'light_r') return 'tail'
    if (name === 'orange_glass') return 'running'
    if (name === 'light') return 'mixed'
  }
  if (key === 'mustang1967') {
    if (name === 'windows') return 'window'
    if (name === 'light_glass') return node.includes('HEADLIGHT') ? 'head' : 'tail'
    if (name === 'light') return 'mixed'
    if (name === 'emiss_l') return 'tail'
  }
  if (!ROAD_LIGHT_MODELS.has(key)) {
    if (name === 'cockpit glass' || name === 'glass' || name === 'glass_windshield' || name === 'glass_blac' || name === 'vertibird06_d') return 'window'
  }
  return null
}

export function setWindowGlass(material, { mode = 'reflective', strength = 1 } = {}) {
  const settings = material.userData.windowReflection
  if (!settings) return
  settings.enabled.value = mode === 'clear' ? 0 : 1
  settings.strength.value = Math.max(0, Math.min(2, strength))
}

export function makeWindowGlass(name = 'Spheris window glass') {
  const material = new THREE.MeshPhysicalMaterial({
    name,
    color: '#dce5e7',
    metalness: 0,
    roughness: 0.015,
    // Preserve the original framebuffer behind the glass. Only the reflected
    // light is shaded here; never sample the filtered transmission buffer.
    transmission: 0,
    transparent: true,
    opacity: 0.08,
    ior: 1.52,
    thickness: 0,
    specularIntensity: 1,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    depthWrite: false,
  })
  material.userData.spherisOptics = true
  material.userData.spherisEnvMapIntensity = 1
  material.userData.windowReflection = { enabled: { value: 1 }, strength: { value: 1 } }
  material.onBeforeCompile = shader => {
    shader.uniforms.windowReflectionEnabled = material.userData.windowReflection.enabled
    shader.uniforms.windowReflectionStrength = material.userData.windowReflection.strength
    shader.fragmentShader = 'uniform float windowReflectionEnabled;\nuniform float windowReflectionStrength;\n' + shader.fragmentShader
    // Some imported panes have reversed triangle winding. Normals are oriented
    // out of the cabin below, independent of gl_FrontFacing and triangle order.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 windowView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
      float windowSide = dot(normalize(vNormal), windowView);
      normal = normalize(vNormal) * (windowSide >= 0.0 ? 1.0 : -1.0);
    `)
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      float windowCosine = clamp(abs(windowSide), 0.0, 1.0);
      float windowFresnel = 0.043 + 0.957 * pow(1.0 - windowCosine, 5.0);
      // Exterior grazing reflections are strong; interior glare is capped at
      // 6%. Both sides blend directly over the unfiltered, full-detail scene.
      float windowScale = windowSide >= 0.0 ? 1.0 : 0.15;
      float windowLimit = windowSide >= 0.0 ? 0.88 : 0.06;
      diffuseColor.a = min(windowLimit, windowFresnel * windowScale * windowReflectionStrength) * windowReflectionEnabled;
      // Physical specular already includes Fresnel. Remove that factor here
      // because normal alpha blending applies it once when compositing.
      outgoingLight = totalSpecular / max(windowFresnel, 0.001);
      #include <opaque_fragment>
    `)
  }
  material.customProgramCacheKey = () => 'sharp-window-reflections-v1'
  return material
}

export function prepareVehicleOptics(root, key) {
  const uniforms = {
    vehicleHeadlights: { value: 0 },
    vehicleTaillights: { value: 0 },
    vehicleRunningLights: { value: 0 },
    vehicleLampStrength: { value: 3 },
  }
  const materials = []
  const windows = new Map()
  root.updateWorldMatrix(true, true)
  const bounds = new THREE.Box3().setFromObject(root)
  const midpoint = (bounds.min.x + bounds.max.x) / 2
  const length = Math.max(0.001, bounds.max.x - bounds.min.x)
  const point = new THREE.Vector3()
  const cabinBounds = new THREE.Box3()
  root.traverse(mesh => {
    if (!mesh.isMesh) return
    const slots = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (slots.some(source => opticalRole(key, mesh.name, source.name) === 'window')) cabinBounds.expandByObject(mesh)
  })
  const cabinCenter = cabinBounds.isEmpty() ? bounds.getCenter(new THREE.Vector3()) : cabinBounds.getCenter(new THREE.Vector3())
  root.traverse(mesh => {
    if (!mesh.isMesh) return
    const slots = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const roles = slots.map(source => opticalRole(key, mesh.name, source.name))
    if (!roles.some(Boolean)) return
    if (roles.includes('window')) orientWindowNormals(mesh, cabinCenter)
    // The mesh's normalized vehicle-longitudinal position lets one authored
    // lamp atlas contain front and rear lamps without lighting the whole atlas.
    if (roles.some(role => role && role !== 'window')) {
      mesh.geometry = mesh.geometry.clone()
      const positions = mesh.geometry.attributes.position
      const longitudinal = new Float32Array(positions.count)
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
        longitudinal[i] = (point.x - midpoint) / length
      }
      mesh.geometry.setAttribute('vehicleLampX', new THREE.BufferAttribute(longitudinal, 1))
    }
    const replaced = slots.map((source, index) => {
      const role = roles[index]
      if (!role) return source
      if (role === 'window') {
        if (!windows.has(source)) windows.set(source, makeWindowGlass(source.name))
        return windows.get(source)
      }
      const material = source.clone()
      material.userData.spherisOptics = true
      material.metalness = Math.min(material.metalness, 0.15)
      material.roughness = Math.min(material.roughness, 0.2)
      material.emissive.set(0)
      material.emissiveMap = null
      material.emissiveIntensity = 1
      material.opacity = 1
      material.transparent = false
      if ('transmission' in material) material.transmission = 0
      // A black exported lens still needs a visible emitter when switched on.
      const lampColor = source.color.clone()
      if (Math.max(lampColor.r, lampColor.g, lampColor.b) < 0.03) material.color.set('#b7bdc0')
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms)
        shader.vertexShader = 'attribute float vehicleLampX; varying float vVehicleLampX;\n' + shader.vertexShader
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvVehicleLampX = vehicleLampX;')
        shader.fragmentShader = `varying float vVehicleLampX;
          uniform float vehicleHeadlights;
          uniform float vehicleTaillights;
          uniform float vehicleRunningLights;
          uniform float vehicleLampStrength;\n` + shader.fragmentShader
        const front = role === 'head' ? '1.0' : role === 'mixed' ? 'step(0.20, vVehicleLampX)' : '0.0'
        const rear = role === 'tail' ? '1.0' : role === 'mixed' ? 'step(vVehicleLampX, -0.20)' : '0.0'
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          float lampDetail = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
          vec3 headGlow = vec3(1.0, 0.88, 0.7) * (${front}) * max(vehicleHeadlights, vehicleRunningLights * 0.12);
          vec3 tailGlow = vec3(1.0, 0.012, 0.003) * (${rear}) * max(vehicleTaillights, vehicleRunningLights * 0.25);
          vec3 markerGlow = vec3(1.0, 0.28, 0.015) * ${role === 'running' ? 'vehicleRunningLights' : '0.0'};
          totalEmissiveRadiance += (headGlow + tailGlow + markerGlow) * lampDetail * vehicleLampStrength;
        `)
      }
      material.customProgramCacheKey = () => `vehicle-lamps-v1-${role}`
      return material
    })
    mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0]
    materials.push(...replaced.filter(material => material.userData.spherisOptics))
  })
  return {
    materials: [...new Set(materials)],
    updateGlass(settings) {
      for (const material of windows.values()) setWindowGlass(material, settings)
    },
    update({ headlights = false, taillights = false, running = false, strength = 3 } = {}) {
      uniforms.vehicleHeadlights.value = Number(headlights)
      uniforms.vehicleTaillights.value = Number(taillights)
      uniforms.vehicleRunningLights.value = Number(running)
      uniforms.vehicleLampStrength.value = Math.max(0, Math.min(12, strength))
    },
  }
}

export function orientWindowNormals(mesh, cabinCenter) {
  if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals()
  const geometry = mesh.geometry.clone()
  const positions = geometry.attributes.position
  const normals = geometry.attributes.normal
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let i = 0; i < normals.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(cabinCenter)
    normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix)
    if (normal.dot(point) < 0) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i))
  }
  normals.needsUpdate = true
  mesh.geometry = geometry
}
