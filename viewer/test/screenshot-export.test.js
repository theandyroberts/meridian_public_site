import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScreenshotDetails, describeScreenshotError } from '../src/screenshot-export.js'

test('builds a useful branded screenshot filename and context', () => {
  assert.deepEqual(
    buildScreenshotDetails(
      { sku: 'PL-7600232', projectName: 'BLACKLIST_MOVIE', sceneName: 'Night pursuit' },
      new Date('2026-08-11T12:00:00Z'),
    ),
    {
      filename: 'tpl-studio-pl-7600232-2026-08-11.png',
      clipLabel: 'PLATE PL-7600232',
      contextLabel: 'BLACKLIST_MOVIE  /  Night pursuit',
    },
  )
})

test('uses scene context for an export that has no plate SKU', () => {
  const details = buildScreenshotDetails(
    { sceneName: 'Coastal Drive: Sunset / West' },
    new Date('2026-08-11T12:00:00Z'),
  )
  assert.equal(details.filename, 'tpl-studio-coastal-drive-sunset-west-2026-08-11.png')
  assert.equal(details.clipLabel, 'AD HOC PREVIEW')
})

test('explains cross-origin screenshot failures without browser jargon', () => {
  const message = describeScreenshotError({ name: 'SecurityError' })
  assert.match(message, /footage host/i)
  assert.match(message, /Plate Lab-hosted preview/i)
  assert.doesNotMatch(message, /tainted canvas/i)
})
