import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeLicenseTierBoundary,
  evaluateLicenseDurationTier,
  normalizeLicenseDurationTiers,
} from '../src/duration-tier.js'

test('normalizes server-supplied duration tiers', () => {
  assert.deepEqual(normalizeLicenseDurationTiers('120,60,120,bad'), [60, 120])
  assert.deepEqual(normalizeLicenseDurationTiers(''), [60, 120])
})

test('keeps the exact inclusive-frame boundary in the lower tier', () => {
  const evaluation = evaluateLicenseDurationTier({
    inFrame: 0,
    outFrame: 1439,
    fps: 24,
    tiers: [60, 120],
  })
  assert.equal(evaluation.durationFrames, 1440)
  assert.equal(evaluation.tierSeconds, 60)
  assert.equal(evaluation.boundary, 'at')
  assert.match(describeLicenseTierBoundary(evaluation), /One more frame/)
})

test('warns that the exact highest-tier boundary is the maximum', () => {
  const evaluation = evaluateLicenseDurationTier({
    inFrame: 0,
    outFrame: 2879,
    fps: 24,
    tiers: [60, 120],
  })
  assert.equal(evaluation.tierSeconds, 120)
  assert.match(describeLicenseTierBoundary(evaluation), /exceeds the available license tiers/)
})

test('moves one inclusive frame past the boundary into the next tier', () => {
  const evaluation = evaluateLicenseDurationTier({
    inFrame: 0,
    outFrame: 1440,
    fps: 24,
    tiers: [60, 120],
  })
  assert.equal(evaluation.durationFrames, 1441)
  assert.equal(evaluation.tierSeconds, 120)
  assert.equal(evaluation.boundary, 'crossed')
  assert.match(describeLicenseTierBoundary(evaluation), /1 frame over/)
})

test('uses the source frame rate rather than rounded timeline seconds', () => {
  const framesAtOrBelowSixtySeconds = Math.floor(60 * 23.976)
  const evaluation = evaluateLicenseDurationTier({
    inFrame: 100,
    outFrame: 100 + framesAtOrBelowSixtySeconds - 1,
    fps: 23.976,
    tiers: [60, 120],
  })
  assert.equal(evaluation.tierSeconds, 60)
})

test('blocks a selection above the highest server tier', () => {
  const evaluation = evaluateLicenseDurationTier({
    inFrame: 0,
    outFrame: 2880,
    fps: 24,
    tiers: [60, 120],
  })
  assert.equal(evaluation.tierSeconds, null)
  assert.equal(evaluation.boundary, 'exceeded')
  assert.match(describeLicenseTierBoundary(evaluation), /Shorten it before saving/)
})
