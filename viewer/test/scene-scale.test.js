import test from 'node:test'
import assert from 'node:assert/strict'
import { feetToSceneUnits, scaleModelToLength } from '../src/scene-scale.js'

test('maps an 80-foot stage to 14.4 scene units', () => {
  assert.ok(Math.abs(feetToSceneUnits(80) - 14.4) < 0.00001)
})

test('maps a Ferrari-sized vehicle to roughly 2.67 scene units', () => {
  assert.ok(Math.abs(feetToSceneUnits(14.86) - 2.6748) < 0.00001)
})

test('scales a model using its physical target length', () => {
  assert.ok(Math.abs(scaleModelToLength(4.65, 14.86) - 0.5752258065) < 0.00001)
})
