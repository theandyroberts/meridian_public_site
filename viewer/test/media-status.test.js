import test from 'node:test'
import assert from 'node:assert/strict'
import { describeMediaError, MEDIA_ERROR } from '../src/media-status.js'

test('turns browser media failures into user-readable actions', () => {
  assert.deepEqual(describeMediaError(MEDIA_ERROR.NETWORK), {
    title: 'Footage could not be downloaded',
    detail: 'The plate host or network did not complete the video request. Check the connection, then retry.',
    retryable: true,
  })
  assert.equal(describeMediaError(MEDIA_ERROR.DECODE).retryable, false)
  assert.match(describeMediaError(MEDIA_ERROR.UNSUPPORTED).detail, /unsupported video format/i)
  assert.equal(describeMediaError(99).retryable, true)
})
