import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { fileURLToPath } from 'node:url'
import { scaleModelToLength } from '../src/scene-scale.js'
import { VEHICLE_PHYSICAL_LENGTHS_FT } from '../src/vehicle-specs.js'
import { orientVehicleModel } from '../src/vehicle-orientation.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const modelDir = path.resolve(here, '..', 'public', 'models')

const vehicles = {
  ferrari: { file: 'ferrari.glb', widthRangeFt: [6, 7.8], heightRangeFt: [3.5, 4.5] },
  bmwM5: { file: 'bmw_m5.glb', widthRangeFt: [6, 7.5], heightRangeFt: [4.5, 5.5] },
  escalade: { file: 'escalade.glb', widthRangeFt: [7, 8.75], heightRangeFt: [6, 7.25] },
}

for (const [key, expected] of Object.entries(vehicles)) {
  test(`${key} asset remains at a credible real-world envelope`, () => {
    const rawSize = readGlbBounds(path.join(modelDir, expected.file))
    const rawLength = Math.max(rawSize.x, rawSize.z)
    const rawWidth = Math.min(rawSize.x, rawSize.z)
    const targetLengthFt = VEHICLE_PHYSICAL_LENGTHS_FT[key]
    const scaleToFeet = targetLengthFt / rawLength
    const widthFt = rawWidth * scaleToFeet
    const heightFt = rawSize.y * scaleToFeet

    assert.ok(Math.abs(rawLength * scaleModelToLength(rawLength, targetLengthFt) / 0.18 - targetLengthFt) < 0.001)
    assert.ok(widthFt >= expected.widthRangeFt[0] && widthFt <= expected.widthRangeFt[1], `${widthFt.toFixed(2)} ft wide`)
    assert.ok(heightFt >= expected.heightRangeFt[0] && heightFt <= expected.heightRangeFt[1], `${heightFt.toFixed(2)} ft high`)
    assert.ok(targetLengthFt / 80 < 0.25, 'vehicle should occupy less than one quarter of the 80 ft stage diameter')
  })
}

for (const [key, expected] of Object.entries(vehicles)) {
  test(`${key} stage orientation aligns its length to forward while preserving height`, () => {
    const file = path.join(modelDir, expected.file)
    const authoredSize = readGlbBounds(file)
    const source = new THREE.Group()
    const model = orientVehicleModel(source, key)
    model.updateMatrixWorld(true)
    const stageSize = readGlbBounds(file, model.matrixWorld)
    assert.ok(stageSize.x > stageSize.z * 2, 'longitudinal axis must follow stage +X/-X, not sideways')
    assert.ok(Math.abs(stageSize.y - authoredSize.y) < 0.0001, 'authored up-axis must stay upright')
    // Front directions verified against the headlights/grille in each asset.
    const front = new THREE.Vector3(0, 0, key === 'ferrari' ? -1 : 1).transformDirection(model.matrixWorld)
    assert.ok(front.x > 0.999, 'front must face +X, toward the front camera presets')
  })
}

test('orientation preserves imported root transforms and every scene root', () => {
  const scene = new THREE.Group()
  const root = new THREE.Group()
  root.rotation.x = -Math.PI / 2
  root.scale.setScalar(0.01)
  scene.add(root, new THREE.Group())
  const model = orientVehicleModel(scene, 'bmwM5')
  assert.equal(model.children[0], scene)
  assert.equal(scene.children.length, 2)
  assert.equal(root.rotation.x, -Math.PI / 2)
  assert.equal(root.scale.x, 0.01)
})

function readGlbBounds(file, orientation = new THREE.Matrix4()) {
  const buffer = fs.readFileSync(file)
  assert.equal(buffer.toString('utf8', 0, 4), 'glTF')
  const jsonLength = buffer.readUInt32LE(12)
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString())
  const bounds = new THREE.Box3()

  function visitNode(nodeIndex, parentMatrix) {
    const node = gltf.nodes[nodeIndex]
    const position = new THREE.Vector3().fromArray(node.translation || [0, 0, 0])
    const rotation = new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1])
    const scale = new THREE.Vector3().fromArray(node.scale || [1, 1, 1])
    const localMatrix = node.matrix
      ? new THREE.Matrix4().fromArray(node.matrix)
      : new THREE.Matrix4().compose(position, rotation, scale)
    const worldMatrix = parentMatrix.clone().multiply(localMatrix)

    if (node.mesh != null) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION]
        if (!accessor?.min || !accessor?.max) continue
        bounds.union(new THREE.Box3(
          new THREE.Vector3().fromArray(accessor.min),
          new THREE.Vector3().fromArray(accessor.max),
        ).applyMatrix4(worldMatrix))
      }
    }

    for (const childIndex of node.children || []) visitNode(childIndex, worldMatrix)
  }

  const scene = gltf.scenes[gltf.scene || 0]
  for (const nodeIndex of scene.nodes) visitNode(nodeIndex, orientation)
  return bounds.getSize(new THREE.Vector3())
}
