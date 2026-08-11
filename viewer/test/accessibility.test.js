import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => Number.parseInt(channel, 16) / 255)
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
}

function contrastRatio(foreground, background) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('Studio source exposes labelled controls, live status, and failure feedback', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8')
  assert.match(source, /id="playbackStatus" role="status" aria-live="polite"/)
  assert.match(source, /id="stageCanvas" aria-label="Interactive 360 Studio stage"/)
  assert.match(source, /id="viewerAlert" role="alert"/)
  assert.match(source, /id="stepBack"[^>]+aria-label="Step back one frame"/)
  assert.match(source, /id="stepForward"[^>]+aria-label="Step forward one frame"/)
  assert.match(source, /aria-controls', 'viewerControls'/)
})

test('Studio styles respect reduced-motion preferences', async () => {
  const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8')
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('Studio text and control boundaries meet WCAG contrast thresholds', () => {
  assert.ok(contrastRatio('#aab5ad', '#101315') >= 4.5, 'muted text must remain readable on panels')
  assert.ok(contrastRatio('#65706a', '#15191b') >= 3, 'control borders must be distinguishable from controls')
  assert.ok(contrastRatio('#82d7d0', '#101315') >= 4.5, 'cyan control text must remain readable')
})
