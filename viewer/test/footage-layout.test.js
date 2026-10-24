import assert from 'node:assert/strict'
import test from 'node:test'

import { detectDecodedFootagePreset } from '../src/footage-layout.js'

test('wide ring previews use the full wall-strip projection', () => {
  assert.equal(detectDecodedFootagePreset({ width: 2880, height: 388 }), 'ringStrip')
})

test('2:1 previews use a true equirectangular sphere', () => {
  assert.equal(detectDecodedFootagePreset({ width: 960, height: 480 }), 'fullSphere')
  assert.equal(detectDecodedFootagePreset({ width: 4096, height: 2048 }), 'fullSphere')
})

test('legacy labels and configured fallback remain available without decoded dimensions', () => {
  assert.equal(detectDecodedFootagePreset({ label: 'A001A003_stitch_v01' }), 'dtla')
  assert.equal(detectDecodedFootagePreset({ label: 'FP_C15 take' }), 'canyon')
  assert.equal(detectDecodedFootagePreset({ fallback: 'fullSphere' }), 'fullSphere')
})
