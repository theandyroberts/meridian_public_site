function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function buildScreenshotDetails(context = {}, capturedAt = new Date()) {
  const sku = String(context.sku || '').trim()
  const projectName = String(context.projectName || '').trim()
  const sceneName = String(context.sceneName || '').trim()
  const date = capturedAt instanceof Date && !Number.isNaN(capturedAt.valueOf())
    ? capturedAt.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  const identity = slugify(sku || sceneName || projectName || 'stage-preview')

  return {
    filename: `tpl-studio-${identity}-${date}.png`,
    clipLabel: sku ? `PLATE ${sku}` : 'AD HOC PREVIEW',
    contextLabel: [projectName, sceneName].filter(Boolean).join('  /  ') || '360 Studio stage preview',
  }
}

export function describeScreenshotError(error) {
  if (error?.name === 'SecurityError') {
    return 'Screenshot blocked by the footage host. Open a Plate Lab-hosted preview or ask the host to allow cross-origin image capture.'
  }

  return 'Screenshot could not be created. Wait for the stage and footage to finish loading, then try again.'
}
