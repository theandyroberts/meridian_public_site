import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plate } from '@platelab/shared';
import type { CompositeClip } from '@/components/CompositeDetail';

/** Load the immutable, approved snapshot associated with this catalog release. */
export async function loadImportedComposite(plate: Plate): Promise<CompositeClip> {
  const ref = plate.composite;
  if (!ref || !/^[a-z0-9-]+$/.test(ref.id) || !/^[a-z0-9-]+$/.test(ref.release)) throw new Error('Invalid imported plate reference');
  const web = process.cwd().endsWith('/web') ? process.cwd() : path.join(process.cwd(), 'web');
  const clip = JSON.parse(await fs.readFile(path.join(web, 'public/media/imported-catalog', ref.release, `${ref.id}.json`), 'utf8'));
  if (clip.id !== ref.id || clip.sourceFingerprint !== ref.sourceFingerprint || clip.approval?.approvedAt !== ref.approvedAt || clip.approval?.status !== 'approved') throw new Error('Imported approval snapshot does not match the catalog');
  return clip;
}
