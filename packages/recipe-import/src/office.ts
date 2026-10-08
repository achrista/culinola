import { strFromU8, unzipSync } from 'fflate';
import WordExtractor from 'word-extractor';
import type { SourceImage } from './types.ts';

export interface OfficeContent {
  text: string;
  images: SourceImage[];
}

/** Welche Elemente in einem Textdokument Absätze, Tabellen und Sonderzeichen bilden. */
interface Dialect {
  table: string;
  row: string;
  cell: string;
  paragraphs: Set<string>;
  /** Nur Text innerhalb dieses Elements zählt; ohne Angabe jeder Text in einem Absatz. */
  textRun?: string;
  tab: string;
  lineBreaks: Set<string>;
  /** Element, das mehrere Leerzeichen abkürzt (OpenDocument). */
  spaces?: string;
}

const DOCX: Dialect = {
  table: 'w:tbl',
  row: 'w:tr',
  cell: 'w:tc',
  paragraphs: new Set(['w:p']),
  textRun: 'w:t',
  tab: 'w:tab',
  lineBreaks: new Set(['w:br', 'w:cr']),
};

const ODT: Dialect = {
  table: 'table:table',
  row: 'table:table-row',
  cell: 'table:table-cell',
  paragraphs: new Set(['text:p', 'text:h']),
  tab: 'text:tab',
  lineBreaks: new Set(['text:line-break']),
  spaces: 'text:s',
};

const IMAGE_TYPES: Record<string, SourceImage['mediaType']> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};
/** Kleinere Bilder sind Zierrat – Linien, Aufzählungszeichen, Logos. */
const MIN_IMAGE_BYTES = 8_000;
/** Mehr nimmt die Schnittstelle des Sprachmodells je Bild nicht an. */
export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_IMAGES = 4;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

interface Table {
  rows: string[];
  row: string[][];
  cell: string[];
}

/**
 * Liest den Fließtext aus dem XML eines Textdokuments. Tabellenzeilen mit einfachen Zellen
 * werden zu einer Zeile mit Tabulatoren ("250 g⇥Mehl"); Zellen mit mehreren Absätzen – etwa
 * eine Zutatenspalte neben einer Zubereitungsspalte – bleiben als Absätze untereinander stehen.
 */
export function xmlToText(xml: string, dialect: Dialect): string {
  const lines: string[] = [];
  const tables: Table[] = [];
  let paragraph = '';
  let depth = 0;
  let inRun = false;

  const emit = (text: string) => {
    const table = tables.at(-1);
    if (table) table.cell.push(text);
    else lines.push(text);
  };

  const token = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  for (let match = token.exec(xml); match; match = token.exec(xml)) {
    const [, closing, name = '', attributes = '', selfClosing, text] = match;
    if (text !== undefined) {
      if (depth > 0 && (dialect.textRun ? inRun : true)) paragraph += decodeEntities(text);
      continue;
    }
    if (name === dialect.textRun) inRun = !closing && !selfClosing;
    else if (dialect.paragraphs.has(name)) {
      if (selfClosing) emit('');
      else if (!closing) depth++;
      else {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          emit(paragraph.replace(/[ \t]+$/gm, ''));
          paragraph = '';
        } else paragraph += '\n';
      }
    } else if (name === dialect.tab) {
      // In Word heißt auch die Festlegung eines Tabulatorstopps so; die trägt eine Position
      if (!attributes.includes('w:pos=')) paragraph += '\t';
    }
    else if (dialect.lineBreaks.has(name)) paragraph += '\n';
    else if (name === dialect.spaces) paragraph += ' '.repeat(Number(/c="(\d+)"/.exec(attributes)?.[1] ?? 1));
    else if (name === dialect.table) {
      if (!closing) tables.push({ rows: [], row: [], cell: [] });
      else {
        const table = tables.pop();
        if (table) for (const row of table.rows) emit(row);
      }
    } else if (name === dialect.row && closing) {
      const table = tables.at(-1);
      if (!table) continue;
      const cells = table.row.map((cell) => cell.filter((entry) => entry.trim()));
      const simple = cells.every((cell) => cell.length <= 1 && !cell[0]?.includes('\n'));
      table.rows.push(simple ? cells.map((cell) => cell[0] ?? '').join('\t') : cells.map((cell) => cell.join('\n')).join('\n\n'));
      table.row = [];
    } else if (name === dialect.cell && (closing || selfClosing)) {
      const table = tables.at(-1);
      if (!table) continue;
      table.row.push(table.cell);
      table.cell = [];
    }
  }
  return lines
    .join('\n')
    .replace(/ /g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function unzip(data: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(data);
  } catch {
    throw new Error('Die Datei ist beschädigt oder kein gültiges Dokument.');
  }
}

/** Die brauchbaren Bilder eines Dokuments, das größte zuerst. */
function pictures(files: Record<string, Uint8Array>, folder: string): SourceImage[] {
  return Object.entries(files)
    .filter(([path]) => path.startsWith(folder))
    .map(([path, data]) => ({ name: path.slice(path.lastIndexOf('/') + 1), mediaType: IMAGE_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()], data }))
    .filter((image): image is SourceImage => !!image.mediaType && image.data.length >= MIN_IMAGE_BYTES && image.data.length <= MAX_IMAGE_BYTES)
    .sort((a, b) => b.data.length - a.data.length)
    .slice(0, MAX_IMAGES);
}

/** Word-Dokument (.docx). */
export function readDocx(data: Uint8Array): OfficeContent {
  const files = unzip(data);
  const document = files['word/document.xml'];
  if (!document) throw new Error('Die Datei ist kein Word-Dokument.');
  return { text: xmlToText(strFromU8(document), DOCX), images: pictures(files, 'word/media/') };
}

/** OpenDocument-Text (.odt), das Format von LibreOffice. */
export function readOdt(data: Uint8Array): OfficeContent {
  const files = unzip(data);
  const content = files['content.xml'];
  if (!content) throw new Error('Die Datei ist kein OpenDocument-Text.');
  const body = /<office:body>([\s\S]*)<\/office:body>/.exec(strFromU8(content))?.[1] ?? '';
  return { text: xmlToText(body, ODT), images: pictures(files, 'Pictures/') };
}

/**
 * Notbehelf für Word-Dateien vor Word 97: Dort steht der Text als zusammenhängende Folge
 * von Zeichen in der Datei. Was mitkommt – Schriftnamen, Druckername –, sortiert das
 * Sprachmodell aus.
 */
export function legacyDocText(data: Uint8Array): string {
  // Füllbytes (FF, FE, FD) stehen in Reihen zwischen den Abschnitten der Datei
  const raw = new TextDecoder('windows-1252').decode(data).replace(/[ýþÿ]{3,}/g, '\0');
  const runs = raw.match(/[\x20-\x7e\xa0-\xff\r\t\x07\x0b]{4,}/g) ?? [];
  return runs
    .map((run) => run.replace(/[\r\x0b]/g, '\n').replace(/\x07/g, '\t'))
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Altes Word-Format (.doc); Bilder lassen sich daraus nicht lesen. */
export async function readDoc(data: Uint8Array): Promise<OfficeContent> {
  try {
    const document = await new WordExtractor().extract(Buffer.from(data));
    return { text: document.getBody().replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), images: [] };
  } catch {
    const text = legacyDocText(data);
    if (text.length < 40) throw new Error('Die Datei ist beschädigt oder kein gültiges Word-Dokument.');
    return { text, images: [] };
  }
}
