export const DEFAULT_FPS = 24

export function normalizeFps(value, fallback = DEFAULT_FPS) {
  const fps = Number(value)
  return Number.isFinite(fps) && fps > 0 ? fps : fallback
}

export function secondsToFrame(seconds, fps = DEFAULT_FPS) {
  const safeFps = normalizeFps(fps)
  const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0
  return Math.floor(safeSeconds * safeFps + 0.000001)
}

export function frameToSeconds(frame, fps = DEFAULT_FPS) {
  const safeFps = normalizeFps(fps)
  const safeFrame = Number.isFinite(Number(frame)) ? Math.max(0, Math.trunc(Number(frame))) : 0
  return safeFrame / safeFps
}

export function stepFrame(currentFrame, direction, totalFrames = null) {
  const safeCurrentFrame = Number.isFinite(Number(currentFrame))
    ? Math.max(0, Math.trunc(Number(currentFrame)))
    : 0
  const delta = Math.sign(Number(direction) || 0)
  const lastFrame = Number.isInteger(totalFrames) && totalFrames > 0
    ? totalFrames - 1
    : Number.POSITIVE_INFINITY

  return Math.min(lastFrame, Math.max(0, safeCurrentFrame + delta))
}

export function selectionDurationFrames(inFrame, outFrame) {
  if (!Number.isInteger(inFrame) || !Number.isInteger(outFrame) || outFrame <= inFrame) return null
  // In and Out identify displayed frames, so both boundary frames are included.
  return outFrame - inFrame + 1
}

export function setInMarker(frame, outFrame) {
  return {
    inFrame: Math.max(0, Math.trunc(Number(frame) || 0)),
    outFrame: Number.isInteger(outFrame) ? outFrame : null,
  }
}

export function setOutMarker(frame, inFrame) {
  return {
    inFrame: Number.isInteger(inFrame) ? inFrame : 0,
    outFrame: Math.max(0, Math.trunc(Number(frame) || 0)),
  }
}

export function hasBackwardsSelection(inFrame, outFrame) {
  return Number.isInteger(inFrame) && Number.isInteger(outFrame) && outFrame <= inFrame
}

export function selectionTimelineRange(inFrame, outFrame, totalFrames) {
  if (selectionDurationFrames(inFrame, outFrame) === null || !Number.isInteger(totalFrames) || totalFrames <= 1) {
    return null
  }

  const lastFrame = totalFrames - 1
  return {
    startPercent: Math.max(0, Math.min(100, (inFrame / lastFrame) * 100)),
    endPercent: Math.max(0, Math.min(100, (outFrame / lastFrame) * 100)),
  }
}

export function shouldLoopSelection(currentFrame, inFrame, outFrame, isPlaying) {
  return Boolean(
    isPlaying &&
      selectionDurationFrames(inFrame, outFrame) !== null &&
      Number.isInteger(currentFrame) &&
      currentFrame > outFrame,
  )
}

export function parseTimecode(value, fps = DEFAULT_FPS) {
  const nominalFps = Math.max(1, Math.round(normalizeFps(fps)))
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(String(value || '').trim())
  if (!match) return 0

  const [, hours, minutes, seconds, frames] = match.map(Number)
  if (minutes > 59 || seconds > 59 || frames >= nominalFps) return 0
  return ((hours * 60 * 60 + minutes * 60 + seconds) * nominalFps) + frames
}

export function formatFrameTimecode(frame, fps = DEFAULT_FPS) {
  const nominalFps = Math.max(1, Math.round(normalizeFps(fps)))
  const framesPerDay = 24 * 60 * 60 * nominalFps
  let remaining = Math.trunc(Number(frame) || 0)
  remaining = ((remaining % framesPerDay) + framesPerDay) % framesPerDay

  const frames = remaining % nominalFps
  remaining = Math.floor(remaining / nominalFps)
  const seconds = remaining % 60
  remaining = Math.floor(remaining / 60)
  const minutes = remaining % 60
  const hours = Math.floor(remaining / 60)

  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatSourceTimecode(frame, fps = DEFAULT_FPS, sourceTimecode = '00:00:00:00') {
  return formatFrameTimecode(parseTimecode(sourceTimecode, fps) + Math.max(0, Math.trunc(frame || 0)), fps)
}

export function formatRelativeTimecode(frame, inFrame, fps = DEFAULT_FPS) {
  if (!Number.isInteger(inFrame)) return '--:--:--:--'
  const difference = Math.trunc(frame || 0) - inFrame
  const sign = difference < 0 ? '-' : '+'
  return `${sign}${formatFrameTimecode(Math.abs(difference), fps)}`
}

export function parseOptionalFrame(value) {
  if (value === null || value === undefined || value === '') return null
  const frame = Number(value)
  return Number.isInteger(frame) && frame >= 0 ? frame : null
}
