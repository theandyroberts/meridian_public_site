import { plateSchema, type Plate } from './catalog';
import { PER_MINUTE_USD, MINIMUM_MINUTES, priceForDuration } from './pricing';

/** Adapter for approved composite imports; original evidence remains in its snapshot. */
export function plateForComposite(clip: any, sku: string, release: string, approvedAt: string): Plate {
  if (clip.enrichment?.status !== 'complete' || clip.localization?.status !== 'complete') throw new Error('Import processing is incomplete');
  if (clip.publication.warnings.some((w: any) => w.blocking)) throw new Error('Import has blocking warnings');
  if (clip.watermark.status !== 'detected') throw new Error('A watermarked preview is required');
  if (!clip.stockId || !clip.sourceFingerprint || !clip.labels.length) throw new Error('Missing import identity or observations');
  const text = `${clip.title} ${clip.tags.join(' ')} ${clip.labels.filter((l: any) => l.category === 'production').map((l: any) => l.label).join(' ')}`.toLowerCase();
  const timeOfDay = /twilight|dusk|sunset/.test(text) ? 'dusk' : /dawn|sunrise/.test(text) ? 'dawn' : /nighttime|at night/.test(text) ? 'night' : /daylight|daytime/.test(text) ? 'day' : 'unverified';
  const weather = /clear sky|clear skies|sunny/.test(text) ? 'clear' : /overcast|cloudy/.test(text) ? 'cloudy' : /rainy|rainfall/.test(text) ? 'rain' : /foggy/.test(text) ? 'fog' : 'unverified';
  const shotType = /tunnel/.test(clip.title.toLowerCase()) ? 'tunnel' : /bridge|viaduct/.test(clip.title.toLowerCase()) ? 'bridge' : 'urban';
  const month = Number(clip.summary.captureDate.slice(5,7));
  const season = [12,1,2].includes(month) ? 'winter' : [3,4,5].includes(month) ? 'spring' : [6,7,8].includes(month) ? 'summer' : 'fall';
  return plateSchema.parse({
    sku, title: clip.title, description: clip.description, shootDate: clip.summary.captureDate,
    rig: 'Spheris XL · imported composite',
    media: {durationSec: clip.media.duration, fps: clip.media.fps, stitchedResolution: `${clip.media.width}x${clip.media.height}`, colorPipeline: `${clip.media.color.primaries}; transfer ${clip.media.color.transfer}`, masterFormat: `Imported ${clip.media.codec} composite; finishing scope to confirm`, cameraOriginals: 'Not included in imported package', timecode: clip.sourceTimecode},
    shotType, timeOfDay, weather, season, tags: clip.tags,
    objects: clip.labels.map((l: any) => ({label: l.label, confidence: l.confidence})),
    location: {name:'Downtown Los Angeles',city:'Los Angeles',region:'California',country:'United States'},
    imu: {collected: true, source:'Imported GPS/IMU; physical synchronization unverified'},
    status:'live',mmm:{stockClipId:clip.stockId},stageCompat:['led-volume','green-screen','projection'],availability:'available',
    pricing:{perMinuteUsd:PER_MINUTE_USD,totalUsd:priceForDuration(clip.media.duration),minimumMinutes:MINIMUM_MINUTES},
    renditions:{stitchedPreview:clip.videoURL,stagePreview:clip.videoURL,cameraPreviews:{},poster:clip.posterURL},
    security:{masterSha256:clip.hashes.rough_stitch,watermarked:true},ingestedAt:clip.publishedAt,
    composite:{id:clip.id,sourceFingerprint:clip.sourceFingerprint,release,approvedAt,coverageBottom:Math.min(1,(clip.coverage?.earliestBlackRowEstimate??clip.crop.height)/clip.media.height)},
  });
}
