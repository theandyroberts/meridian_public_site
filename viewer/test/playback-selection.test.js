import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatFrameTimecode,
  formatRelativeTimecode,
  formatSourceTimecode,
  frameToSeconds,
  hasBackwardsSelection,
  parseOptionalFrame,
  parseTimecode,
  secondsToFrame,
  selectionTimelineRange,
  selectionDurationFrames,
  setInMarker,
  setOutMarker,
  shouldLoopSelection,
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

test('resets either marker without destroying the other marker', () => {
  assert.deepEqual(setInMarker(72, 96), { inFrame: 72, outFrame: 96 })
  assert.deepEqual(setInMarker(120, 96), { inFrame: 120, outFrame: 96 })
  assert.deepEqual(setOutMarker(120, 72), { inFrame: 72, outFrame: 120 })
})

test('defaults In to the first frame when Out is set first', () => {
  assert.deepEqual(setOutMarker(48, null), { inFrame: 0, outFrame: 48 })
})

test('identifies backwards selections without discarding either marker', () => {
  assert.equal(hasBackwardsSelection(72, 48), true)
  assert.equal(hasBackwardsSelection(72, 72), true)
  assert.equal(hasBackwardsSelection(48, 72), false)
})

test('maps a valid selection onto the timeline', () => {
  assert.deepEqual(selectionTimelineRange(25, 74, 100), {
    startPercent: 25.252525252525253,
    endPercent: 74.74747474747475,
  })
  assert.equal(selectionTimelineRange(74, 25, 100), null)
})

test('loops only after playback crosses a valid Out point', () => {
  assert.equal(shouldLoopSelection(75, 25, 74, true), true)
  assert.equal(shouldLoopSelection(74, 25, 74, true), false)
  assert.equal(shouldLoopSelection(75, 25, 74, false), false)
  assert.equal(shouldLoopSelection(75, 74, 25, true), false)
})

test('accepts only non-negative integer URL frame values', () => {
  assert.equal(parseOptionalFrame('42'), 42)
  assert.equal(parseOptionalFrame(''), null)
  assert.equal(parseOptionalFrame('-1'), null)
  assert.equal(parseOptionalFrame('1.5'), null)
})
