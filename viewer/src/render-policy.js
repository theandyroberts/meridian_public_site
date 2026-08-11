export const MAX_DEVICE_PIXEL_RATIO = 2
export const REFLECTION_REFRESH_INTERVAL_MS = 1000 / 30

export function cappedDevicePixelRatio(value, maximum = MAX_DEVICE_PIXEL_RATIO) {
  const ratio = Number(value)
  const cap = Number(maximum)
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const safeCap = Number.isFinite(cap) && cap > 0 ? cap : MAX_DEVICE_PIXEL_RATIO
  return Math.min(safeRatio, safeCap)
}

export function shouldRenderContinuously({ visible, videoPlaying, controlsMoving, controlsChanged }) {
  return Boolean(visible && (videoPlaying || controlsMoving || controlsChanged))
}

export function shouldScheduleVideoFrame({ supported, visible, videoPlaying }) {
  return Boolean(supported && visible && videoPlaying)
}

export function shouldRefreshReflection({
  enabled,
  videoPlaying,
  reflectionInvalidated,
  elapsedMs = Number.POSITIVE_INFINITY,
  minimumIntervalMs = REFLECTION_REFRESH_INTERVAL_MS,
}) {
  return Boolean(
    enabled
      && (
        reflectionInvalidated
        || (videoPlaying && elapsedMs >= minimumIntervalMs)
      ),
  )
}
