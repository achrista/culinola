import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { MAX_IMAGE_BYTES, readDoc, readDocx, readOdt } from './office.ts';
import { pdfPhotos } from './pdf.ts';
import type { SourceImage, SourceMaterial } from './types.ts';
import { download, readHtml } from './web.ts';

/** Woraus ein Rezept gelesen werden kann. */
export type RecipeInput =
  | { file: string }
  | { data: Uint8Array; name: string; mediaType?: string; /** Foto des Gerichts, das getrennt von der Vorlage mitkommt. */ photo?: { data: Uint8Array; name: string } }
  | { url: string }
  | { text: string; name?: string };

type Kind = 'pdf' | 'docx' | 'odt' | 'doc' | 'html' | 'text' | SourceImage['mediaType'];

/** Die Quelle enthält nichts, woraus sich ein Rezept lesen ließe. */
export class EmptySourceError extends Error {}

/** Mehr nimmt die Schnittstelle des Sprachmodells in einer Anfrage nicht an. */
const MAX_PDF_BYTES = 20_000_000;
/** Seiten mit mehr Text sind fast nur Beiwerk; der Hinweis auf die Kürzung geht an den Aufrufer. */
const MAX_TEXT_CHARS = 60_000;
/** Ein Foto, das nur abgelegt und nicht an das Modell geschickt wird, darf größer sein als eines für das Modell. */
const MAX_COVER_BYTES = 15_000_000;

const BY_EXTENSION: Record<string, Kind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.docm': 'docx',
  '.odt': 'odt',
  '.doc': 'doc',
  '.htm': 'html',
  '.html': 'html',
  '.txt': 'text',
  '.md': 'text',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const BY_MEDIA_TYPE: Record<string, Kind> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/msword': 'doc',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/plain': 'text',
  'text/markdown': 'text',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

function startsWith(data: Uint8Array, ...bytes: number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

/** Erkennt die Art einer Datei: am Inhalt, wo er eindeutig ist, sonst an Typangabe und Endung. */
export function kindOf(data: Uint8Array, name: string, mediaType?: string): Kind | undefined {
  if (startsWith(data, 0x25, 0x50, 0x44, 0x46)) return 'pdf';
  if (startsWith(data, 0xd0, 0xcf, 0x11, 0xe0)) return 'doc';
  if (startsWith(data, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(data, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(data, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(data, 0x52, 0x49, 0x46, 0x46) && data[8] === 0x57 && data[9] === 0x45) return 'image/webp';
  const known = BY_MEDIA_TYPE[mediaType?.split(';')[0]?.trim().toLowerCase() ?? ''] ?? BY_EXTENSION[extname(name).toLowerCase()];
  if (startsWith(data, 0x50, 0x4b)) return known === 'odt' ? 'odt' : 'docx';
  if (known === 'html' || known === 'text') return known;
  // Was keine der bekannten Kennungen trägt und keine Nullbytes enthält, ist Text – auch wenn die Endung anderes behauptet
  if (!data.subarray(0, 4000).includes(0)) return /^\s*<(!doctype|html)/i.test(Buffer.from(data.subarray(0, 200)).toString('utf8')) ? 'html' : 'text';
  return undefined;
}

function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(data);
  // Ältere Textdateien aus Windows sind selten UTF-8
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(data) : utf8;
}

async function fromData(data: Uint8Array, name: string, mediaType?: string, url?: string): Promise<SourceMaterial> {
  const material: SourceMaterial = { name, images: [], warnings: [], ...(url ? { url } : {}) };
  const kind = kindOf(data, name, mediaType);
  if (!kind) throw new Error(`Dieses Dateiformat wird nicht unterstützt: ${extname(name) || mediaType || 'unbekannt'}`);

  if (kind === 'pdf') {
    if (data.length > MAX_PDF_BYTES) throw new Error('Das PDF ist größer als 20 MB.');
    material.pdf = data;
    material.images = pdfPhotos(data);
  } else if (kind === 'docx' || kind === 'odt' || kind === 'doc') {
    const content = kind === 'docx' ? readDocx(data) : kind === 'odt' ? readOdt(data) : await readDoc(data);
    material.text = content.text;
    material.images = content.images;
  } else if (kind === 'html') {
    const page = readHtml(decodeText(data), url ?? 'http://localhost/');
    material.text = page.text;
    if (page.imageUrl && url) material.imageUrl = page.imageUrl;
  } else if (kind === 'text') {
    material.text = decodeText(data).trim();
  } else {
    if (data.length > MAX_IMAGE_BYTES) throw new Error('Das Bild ist größer als 5 MB.');
    material.images = [{ name: basename(name), mediaType: kind, data }];
  }

  if (material.text && material.text.length > MAX_TEXT_CHARS) {
    material.text = material.text.slice(0, MAX_TEXT_CHARS);
    material.warnings.push(`Der Text wurde auf ${MAX_TEXT_CHARS} Zeichen gekürzt.`);
  }
  if (!material.text && !material.pdf && !material.images.length) throw new EmptySourceError('Die Quelle enthält keinen lesbaren Inhalt.');
  return material;
}

/** Prüft, ob Daten ein Bild in brauchbarer Größe sind, und gibt sie dann als Bild zurück. */
function asImage(data: Uint8Array, name: string): SourceImage | undefined {
  const kind = kindOf(data, name);
  return kind?.startsWith('image/') && data.length <= MAX_COVER_BYTES ? { name, mediaType: kind as SourceImage['mediaType'], data } : undefined;
}

/**
 * Sucht neben einer Vorlage ein Bild gleichen Namens – "Apfelkuchen.pdf" und "Apfelkuchen.jpg".
 * So bekommt auch ein Rezept ein Foto, dessen Vorlage selbst keines enthält.
 */
async function sidecar(file: string): Promise<SourceImage | undefined> {
  const stem = join(dirname(file), basename(file, extname(file)));
  for (const ending of ['.jpg', '.jpeg', '.png', '.webp']) {
    for (const candidate of [stem + ending, stem + ending.toUpperCase()]) {
      if (candidate === file) continue;
      const data = await readFile(candidate).catch(() => undefined);
      const image = data && asImage(data, basename(candidate));
      if (image) return image;
    }
  }
  return undefined;
}

/** Liest eine Quelle ein – Datei, hochgeladene Daten, Webadresse oder eingegebenen Text. */
export async function readSource(input: RecipeInput, signal?: AbortSignal): Promise<SourceMaterial> {
  if ('file' in input) {
    const material = await fromData(await readFile(input.file), basename(input.file));
    // Ist die Vorlage selbst ein Bild, zeigt sie das Rezept oder das Gericht; ein zweites daneben wäre geraten
    const cover = material.images.length === 1 && !material.text && !material.pdf ? undefined : await sidecar(input.file);
    return cover ? { ...material, cover } : material;
  }
  if ('data' in input) {
    const material = await fromData(input.data, input.name, input.mediaType);
    if (!input.photo) return material;
    // Der Name kann von einem anderen System kommen – vom Pfad zählt nur das letzte Stück, gleich mit welchem Trenner
    const cover = asImage(input.photo.data, input.photo.name.split(/[\\/]/).pop() || 'foto');
    if (!cover) material.warnings.push('Das mitgegebene Foto ist kein Bild in brauchbarer Größe und wurde nicht übernommen.');
    return cover ? { ...material, cover } : material;
  }
  if ('url' in input) {
    const page = await download(input.url, signal);
    const material = await fromData(page.data, page.url, page.contentType, page.url);
    if (material.imageUrl) {
      // Das Titelbild wird geholt und beim Rezept abgelegt: Adressen von Bildern gelten oft nur Stunden
      try {
        const picture = await download(material.imageUrl, signal);
        const cover = asImage(picture.data, basename(new URL(picture.url).pathname) || 'titelbild');
        if (cover) material.cover = cover;
        else material.warnings.push('Das Titelbild der Seite ist kein Bild in brauchbarer Größe und wurde nicht übernommen.');
      } catch (error) {
        material.warnings.push(`Das Titelbild der Seite ließ sich nicht holen: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return material;
  }
  const text = input.text.trim();
  if (!text) throw new EmptySourceError('Die Quelle enthält keinen lesbaren Inhalt.');
  return { name: input.name ?? 'Eingabe', text: text.slice(0, MAX_TEXT_CHARS), images: [], warnings: text.length > MAX_TEXT_CHARS ? [`Der Text wurde auf ${MAX_TEXT_CHARS} Zeichen gekürzt.`] : [] };
}
