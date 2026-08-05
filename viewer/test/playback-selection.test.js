import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFrameTimecode,
  formatRelativeTimecode,
  formatSourceTimecode,
  frameToSeconds,
  parseOptionalFrame,
  parseTimecode,
  secondsToFrame,
  selectionDurationFrames,
} from '../src/playback-selection.js'

test('converts between decoded seconds and source frames', () => {
  assert.equal(secondsToFrame(3.5, 24), 84)
  assert.equal(frameToSeconds(84, 24), 3.5)
})

test('formats source timecode by adding the plate start timecode', () => {
  assert.equal(parseTimecode('13:01:40:04', 24), 1_125_604)
  assert.equal(formatSourceTimecode(44, 24, '13:01:40:04'), '13:01:42:00')
})

test('formats selection-relative time before and after the In point', () => {
  assert.equal(formatRelativeTimecode(48, 24, 24), '+00:00:01:00')
  assert.equal(formatRelativeTimecode(12, 24, 24), '-00:00:00:12')
  assert.equal(formatRelativeTimecode(12, null, 24), '--:--:--:--')
})

test('counts both the In and Out boundary frames in selected duration', () => {
  assert.equal(selectionDurationFrames(24, 47), 24)
  assert.equal(formatFrameTimecode(selectionDurationFrames(24, 47), 24), '00:00:01:00')
  assert.equal(selectionDurationFrames(24, 24), null)
})

test('accepts only non-negative integer URL frame values', () => {
  assert.equal(parseOptionalFrame('42'), 42)
  assert.equal(parseOptionalFrame(''), null)
  assert.equal(parseOptionalFrame('-1'), null)
  assert.equal(parseOptionalFrame('1.5'), null)
})
