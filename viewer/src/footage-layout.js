export function detectDecodedFootagePreset({ width = 0, height = 0, label = '', fallback = 'canyon' } = {}) {
  const aspect = width > 0 && height > 0 ? width / height : 0

  // A wide, shallow ring stitch is a wall strip, not a full sphere. Using a
  // spherical crop on it throws away scarce vertical pixels and displaces the
  // horizon. A 2:1 decode is a conventional equirectangular sphere.
  if (aspect >= 3) return 'ringStrip'
  if (aspect >= 1.8 && aspect <= 2.2) return 'fullSphere'

  const normalized = label.toLowerCase()
  if (normalized.includes('a001a003') || normalized.includes('stitch_v01')) return 'dtla'
  if (normalized.includes('fp_c15')) return 'canyon'
  return fallback
}
