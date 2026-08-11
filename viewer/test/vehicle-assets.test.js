import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { fileURLToPath } from 'node:url'
import { scaleModelToLength } from '../src/scene-scale.js'
import { VEHICLE_PHYSICAL_LENGTHS_FT } from '../src/vehicle-specs.js'

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

function readGlbBounds(file) {
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
  for (const nodeIndex of scene.nodes) visitNode(nodeIndex, new THREE.Matrix4())
  return bounds.getSize(new THREE.Vector3())
}
