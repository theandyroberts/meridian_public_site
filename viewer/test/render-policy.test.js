import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cappedDevicePixelRatio,
  canPresentPreview,
  shouldRefreshReflection,
  shouldRenderContinuously,
  shouldScheduleVideoFrame,
} from '../src/render-policy.js'

test('caps excessive device pixel ratios without reducing ordinary displays', () => {
  assert.equal(cappedDevicePixelRatio(1), 1)
  assert.equal(cappedDevicePixelRatio(1.5), 1.5)
  assert.equal(cappedDevicePixelRatio(3), 2)
  assert.equal(cappedDevicePixelRatio(undefined), 1)
})

test('runs continuously only for visible moving content', () => {
  assert.equal(shouldRenderContinuously({ visible: true, videoPlaying: true }), true)
  assert.equal(shouldRenderContinuously({ visible: true, controlsMoving: true }), true)
  assert.equal(shouldRenderContinuously({ visible: true, controlsChanged: true }), true)
  assert.equal(shouldRenderContinuously({ visible: true }), false)
  assert.equal(shouldRenderContinuously({ visible: false, videoPlaying: true }), false)
})

test('uses decoded-video callbacks only when playback is visible and supported', () => {
  assert.equal(shouldScheduleVideoFrame({ supported: true, visible: true, videoPlaying: true }), true)
  assert.equal(shouldScheduleVideoFrame({ supported: false, visible: true, videoPlaying: true }), false)
  assert.equal(shouldScheduleVideoFrame({ supported: true, visible: false, videoPlaying: true }), false)
  assert.equal(shouldScheduleVideoFrame({ supported: true, visible: true, videoPlaying: false }), false)
})

test('refreshes the six-face reflection capture only for changed content', () => {
  assert.equal(shouldRefreshReflection({ enabled: true, videoPlaying: true, elapsedMs: 34 }), true)
  assert.equal(shouldRefreshReflection({ enabled: true, videoPlaying: true, elapsedMs: 10 }), false)
  assert.equal(shouldRefreshReflection({ enabled: true, reflectionInvalidated: true }), true)
  assert.equal(shouldRefreshReflection({ enabled: true }), false)
  assert.equal(shouldRefreshReflection({ enabled: false, videoPlaying: true }), false)
})

 test('does not reveal a paused preview when media wins the race against the model', () => {
  const frame = { rendered: true, decodedFrameReady: true, lightingReady: true, modelReady: false }
  assert.equal(canPresentPreview(frame), false)
  frame.modelReady = true
  frame.rendered = false
  assert.equal(canPresentPreview(frame), false)
  frame.rendered = true
  assert.equal(canPresentPreview(frame), true)
})

test('does not reveal a loaded vehicle until its video and reflections are rendered', () => {
  const frame = { rendered: true, modelReady: true, decodedFrameReady: false, lightingReady: false }
  assert.equal(canPresentPreview(frame), false)
  frame.decodedFrameReady = true
  assert.equal(canPresentPreview(frame), false)
  frame.lightingReady = true
  assert.equal(canPresentPreview(frame), true)
})
