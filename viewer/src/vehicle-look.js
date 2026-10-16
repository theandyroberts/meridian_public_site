import * as THREE from 'three'

export function defaultVehicleLook() {
  return {
    gradeEnabled: true, offset: 0, gamma: 1, multiply: 1,
    offsetRGB: [0, 0, 0], gammaRGB: [1, 1, 1], multiplyRGB: [1, 1, 1],
    wearEnabled: true, dirt: 0.12, scratches: 0.08,
  }
}

const finite = (value, fallback, min, max) => Number.isFinite(value) ? THREE.MathUtils.clamp(value, min, max) : fallback
export function normalizeVehicleLook(input = {}) {
  const defaults = defaultVehicleLook()
  const result = { ...defaults, ...input }
  for (const [key, fallback, min, max] of [['offset', 0, -0.2, 0.2], ['gamma', 1, 0.5, 2], ['multiply', 1, 0, 3], ['dirt', 0.12, 0, 1], ['scratches', 0.08, 0, 1]]) {
    result[key] = finite(input[key], fallback, min, max)
  }
  for (const [key, fallback, min, max] of [['offsetRGB', 0, -0.2, 0.2], ['gammaRGB', 1, 0.5, 2], ['multiplyRGB', 1, 0, 3]]) {
    result[key] = [0, 1, 2].map(i => finite(input[key]?.[i], fallback, min, max))
  }
  result.gradeEnabled = input.gradeEnabled !== false
  result.wearEnabled = input.wearEnabled !== false
  return result
}

// Shared live uniforms keep model changes and alternate paint materials in sync.
// Only materials on the subject are installed: plates, stage and shadows are not.
export function createVehicleLook(initial) {
  const uniforms = {
    vehicleGradeOffset: { value: new THREE.Vector3() },
    vehicleGradeGamma: { value: new THREE.Vector3(1, 1, 1) },
    vehicleGradeMultiply: { value: new THREE.Vector3(1, 1, 1) },
    vehicleDirt: { value: 0 }, vehicleScratches: { value: 0 },
  }
  const installed = new WeakSet()
  const preparedMeshes = new WeakSet()
  function update(input) {
    const look = normalizeVehicleLook(input)
    for (const [key, neutral, combine] of [['offset', 0, (a, b) => a + b], ['gamma', 1, (a, b) => a * b], ['multiply', 1, (a, b) => a * b]]) {
      const values = look[`${key}RGB`].map(value => look.gradeEnabled ? combine(look[key], value) : neutral)
      uniforms[`vehicleGrade${key[0].toUpperCase()}${key.slice(1)}`].value.fromArray(values)
    }
    uniforms.vehicleDirt.value = look.wearEnabled ? look.dirt : 0
    uniforms.vehicleScratches.value = look.wearEnabled ? look.scratches : 0
  }
  function installMaterial(material) {
    if (installed.has(material) || !(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshBasicMaterial)) return
    installed.add(material)
    const previousCompile = material.onBeforeCompile
    // Capture the existing key before wrapping; Three's default key reads the hook.
    const previousKey = material.customProgramCacheKey()
    const glass = Boolean(material.userData.windowReflection)
    material.onBeforeCompile = function(shader, renderer) {
      previousCompile.call(this, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = 'attribute vec3 vehicleSurfacePosition; varying vec3 vVehicleSurfacePosition;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvVehicleSurfacePosition = vehicleSurfacePosition;')
      shader.fragmentShader = wearGLSL + '\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 vehicleWear = vehicleSurfaceWear(vVehicleSurfacePosition);
        float vehicleDust = vehicleWear.x * vehicleDirt;
        float vehicleScuff = vehicleWear.y * vehicleScratches;
        ${glass ? '' : `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.145, 0.12), vehicleDust * 0.28);
        diffuseColor.rgb *= 1.0 - vehicleScuff * 0.10;`}
      `)
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + vehicleDust * ${glass ? '0.025' : '0.22'} + vehicleScuff * ${glass ? '0.06' : '0.30'}, 0.0, 1.0);
      `)
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoatRoughness = clamp(material.clearcoatRoughness + vehicleDust * 0.22 + vehicleScuff * 0.3, 0.0, 1.0);
        #endif
      `)
      // Runs after glass/lamp shading, before tone mapping. For windows only the
      // reflection is graded; framebuffer transmission and its alpha stay intact.
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        outgoingLight = pow(max(outgoingLight * vehicleGradeMultiply + vehicleGradeOffset, vec3(0.0)), vec3(1.0) / vehicleGradeGamma);
        #include <opaque_fragment>
      `)
    }
    material.customProgramCacheKey = () => `${previousKey}|vehicle-look-v1-${glass ? 'glass' : 'solid'}`
    material.needsUpdate = true
  }
  function install(root) {
    root.updateWorldMatrix(true, true)
    root.traverse(mesh => {
      if (!mesh.isMesh) return
      if (!preparedMeshes.has(mesh)) {
        // Bake coordinates once in the normalized model pose. They follow the
        // mesh through wheel/door animation and do not swim as the vehicle moves.
        const geometry = mesh.geometry.clone()
        const positions = geometry.getAttribute('position')
        const points = new Float32Array(positions.count * 3)
        const point = new THREE.Vector3()
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).toArray(points, i * 3)
        }
        geometry.setAttribute('vehicleSurfacePosition', new THREE.BufferAttribute(points, 3))
        mesh.geometry = geometry
        preparedMeshes.add(mesh)
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(installMaterial)
    })
  }
  update(initial)
  return { update, install }
}

// UV-independent, fixed object-space wear. Derivatives soften subpixel marks.
const wearGLSL = `
varying vec3 vVehicleSurfacePosition;
uniform vec3 vehicleGradeOffset;
uniform vec3 vehicleGradeGamma;
uniform vec3 vehicleGradeMultiply;
uniform float vehicleDirt;
uniform float vehicleScratches;
float vehicleHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vehicleNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vehicleHash(i), vehicleHash(i + vec3(1,0,0)), f.x),
                 mix(vehicleHash(i + vec3(0,1,0)), vehicleHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(vehicleHash(i + vec3(0,0,1)), vehicleHash(i + vec3(1,0,1)), f.x),
                 mix(vehicleHash(i + vec3(0,1,1)), vehicleHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float vehicleScratch(vec2 p) {
  vec2 q = vec2(p.x * 9.0, p.y * 150.0);
  vec2 cell = floor(q);
  float seed = vehicleHash(vec3(cell, 41.0));
  float distanceToLine = abs(fract(q.y) - 0.5);
  float aa = max(fwidth(q.y), 0.015);
  float line = (1.0 - smoothstep(0.03, 0.03 + aa, distanceToLine)) * min(1.0, 0.07 / aa);
  return line * smoothstep(0.05, 0.2, fract(q.x)) * (1.0 - smoothstep(0.55, 0.95, fract(q.x))) * step(0.88, seed);
}
vec2 vehicleSurfaceWear(vec3 p) {
  vec3 surfaceNormal = abs(cross(dFdx(p), dFdy(p)));
  vec3 weights = surfaceNormal / max(dot(surfaceNormal, vec3(1.0)), 0.000001);
  float dust = smoothstep(0.2, 0.8, vehicleNoise(p * 4.0)) * (0.7 + 0.3 * vehicleNoise(p * 60.0));
  float scratch = dot(weights, vec3(vehicleScratch(p.yz), vehicleScratch(p.xz), vehicleScratch(p.xy)));
  return vec2(dust, scratch);
}
`
