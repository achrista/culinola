import { MAX_IMAGE_BYTES, MAX_IMAGES } from './office.ts';
import type { SourceImage } from './types.ts';

const MIN_PHOTO_BYTES = 15_000;

/**
 * Sucht die Fotos in einem PDF. Gefunden werden JPEG-Bilder, die unverändert eingebettet
 * sind – der übliche Fall bei Fotos. Anders gepackte Bilder bleiben unberücksichtigt; den
 * Text des PDFs liest ohnehin das Sprachmodell.
 */
export function pdfPhotos(data: Uint8Array): SourceImage[] {
  const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const text = raw.toString('latin1');
  const photos: SourceImage[] = [];
  const object = /<<((?:[^<>]|<<[^<>]*>>)*)>>\s*stream\r?\n/g;
  for (let match = object.exec(text); match; match = object.exec(text)) {
    const dictionary = match[1] ?? '';
    if (!/\/Subtype\s*\/Image/.test(dictionary) || !/\/Filter\s*(?:\/DCTDecode|\[\s*\/DCTDecode\s*\])/.test(dictionary)) continue;
    const start = match.index + match[0].length;
    const length = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)?.[1]);
    let end = Number.isFinite(length) && /^\s*endstream/.test(text.slice(start + length, start + length + 12)) ? start + length : text.indexOf('endstream', start);
    if (end < 0) continue;
    if (raw[end - 1] === 0x0a) end--;
    if (raw[end - 1] === 0x0d) end--;
    const photo = raw.subarray(start, end);
    if (photo[0] !== 0xff || photo[1] !== 0xd8 || photo.length < MIN_PHOTO_BYTES || photo.length > MAX_IMAGE_BYTES) continue;
    photos.push({ name: `bild-${photos.length + 1}.jpg`, mediaType: 'image/jpeg', data: new Uint8Array(photo) });
    object.lastIndex = end;
  }
  return photos.sort((a, b) => b.data.length - a.data.length).slice(0, MAX_IMAGES);
}
