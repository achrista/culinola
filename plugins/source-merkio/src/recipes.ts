import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { explain } from '@culinola/sdk';
import type { MerkioItem } from './merkio.ts';

/** Was von einem Rezept in den Ordner kam: Name der Dateien, Stand des Eintrags, Foto. */
interface Copy {
  base: string;
  stamp: string;
  photo?: string;
  photoRev?: string;
}

interface Index {
  list: number;
  copies: Record<string, Copy>;
}

export interface MirrorResult {
  written: string[];
  removed: string[];
  failed: string[];
}

/** Holt eine Datei aus Merkio, etwa `/items/7/export.md`. */
export type FetchFile = (path: string) => Promise<{ data: Uint8Array; type: string }>;

/** Führt Buch darüber, welche Datei zu welchem Eintrag gehört; Dateien mit Punkt davor liest das Rezept-Plugin nicht. */
const INDEX = '.merkio.json';
const PHOTO_ENDINGS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---/;

/** Dateiname aus einem Titel, wie ihn auch Culinolas Rezept-Import vergibt: Umlaute bleiben, was Dateisysteme nicht mögen, fällt weg. */
export function fileName(title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return name || 'Rezept';
}

/** Setzt in den Kopfdaten das Foto, das neben der Datei liegt – oder nimmt die Angabe heraus, wenn es keines gibt. */
export function withImage(markdown: string, image: string | undefined): string {
  const front = FRONT_MATTER.exec(markdown);
  if (!front) return image ? `---\nimage: ${JSON.stringify(image)}\n---\n\n${markdown}` : markdown;
  const lines = front[1]!.split(/\r?\n/).filter((line) => !/^image\s*:/i.test(line));
  if (image) lines.push(`image: ${JSON.stringify(image)}`);
  return `---\n${lines.join('\n')}\n---${markdown.slice(front[0].length)}`;
}

/** Ändert sich irgendetwas am Eintrag, ändert sich dieser Stempel. */
function stampOf(item: MerkioItem): string {
  return createHash('sha1')
    .update(JSON.stringify([item.updatedAt ?? null, item.name, item.category ?? null, item.content ?? null]))
    .digest('hex');
}

/** Das Foto eines Rezepts: ob es eines gibt und welchen Stand es hat. */
function photoOf(item: MerkioItem): { image: boolean; rev: string } {
  try {
    const content = JSON.parse(item.content || '{}') as { image?: unknown; photoRev?: unknown };
    return { image: typeof content.image === 'string' && !!content.image, rev: String(content.photoRev ?? '') };
  } catch {
    return { image: false, rev: '' };
  }
}

function readIndex(folder: string): Index {
  try {
    const saved = JSON.parse(readFileSync(join(folder, INDEX), 'utf8')) as Partial<Index>;
    if (typeof saved.list === 'number' && saved.copies && typeof saved.copies === 'object') return { list: saved.list, copies: saved.copies };
  } catch {
    // Beim ersten Abgleich gibt es noch kein Verzeichnis.
  }
  return { list: -1, copies: {} };
}

/** Schreibt erst unter einem Namen, den das Rezept-Plugin übergeht, und benennt dann um – so liest es nie eine halbe Datei. */
function put(folder: string, name: string, data: string | Uint8Array): void {
  const temporary = join(folder, `.${name}.tmp`);
  writeFileSync(temporary, data);
  renameSync(temporary, join(folder, name));
}

const filesOf = (copy: Copy) => [`${copy.base}.md`, ...(copy.photo ? [copy.photo] : [])];

/** Gilt der bisherige Name noch für den Titel – auch mit der Nummer, die ein gleichnamiges Rezept nötig machte? */
function fits(base: string, title: string): boolean {
  const wanted = fileName(title);
  return base === wanted || (base.startsWith(`${wanted} (`) && /^ \(\d+\)$/.test(base.slice(wanted.length)));
}

/**
 * Bringt einen Ordner auf den Stand einer Rezeptliste in Merkio: je Rezept die Datei, wie Merkio sie
 * für Culinola ausgibt, und das Foto daneben. Geholt wird nur, was sich geändert hat. Was in Merkio
 * gelöscht wurde, verschwindet; scheitert ein einzelnes Rezept, bleibt sein letzter Stand liegen.
 */
export async function mirrorRecipes(folder: string, list: number, items: MerkioItem[], fetchFile: FetchFile): Promise<MirrorResult> {
  mkdirSync(folder, { recursive: true });
  const result: MirrorResult = { written: [], removed: [], failed: [] };
  const stale: string[] = [];
  let index = readIndex(folder);
  const save = () => writeFileSync(join(folder, INDEX), JSON.stringify(index));

  // Eine andere Liste ersetzt den ganzen Bestand
  if (index.list !== list) {
    for (const copy of Object.values(index.copies)) stale.push(...filesOf(copy));
    index = { list, copies: {} };
  }
  const present = new Set(items.map((item) => String(item.id)));
  for (const [id, copy] of Object.entries(index.copies)) {
    if (present.has(id)) continue;
    stale.push(...filesOf(copy));
    result.removed.push(copy.base);
    delete index.copies[id];
  }

  // Wer seinen Namen behalten kann, behält ihn – sonst wechselte die Kennung eines Rezepts, nur weil ein anderes dazukam
  const taken = new Set<string>();
  const names = new Map<number, string>();
  for (const item of items) {
    const base = index.copies[item.id]?.base;
    if (base && fits(base, item.name) && !taken.has(base.toLowerCase())) {
      names.set(item.id, base);
      taken.add(base.toLowerCase());
    }
  }
  for (const item of items) {
    if (names.has(item.id)) continue;
    const wanted = fileName(item.name);
    let base = wanted;
    for (let count = 2; taken.has(base.toLowerCase()); count++) base = `${wanted} (${count})`;
    names.set(item.id, base);
    taken.add(base.toLowerCase());
  }

  for (const item of items) {
    const base = names.get(item.id)!;
    const old = index.copies[item.id];
    const stamp = stampOf(item);
    if (old && old.base === base && old.stamp === stamp && existsSync(join(folder, `${base}.md`))) continue;
    try {
      const { image, rev } = photoOf(item);
      let photo: string | undefined;
      if (image && old?.photo && old.base === base && old.photoRev === rev && existsSync(join(folder, old.photo))) photo = old.photo;
      else if (image) {
        const got = await fetchFile(`/items/${item.id}/photo`);
        photo = base + (PHOTO_ENDINGS[got.type] ?? '.jpg');
        put(folder, photo, got.data);
      }
      const markdown = new TextDecoder().decode((await fetchFile(`/items/${item.id}/export.md`)).data);
      put(folder, `${base}.md`, withImage(markdown, photo));
      if (old) stale.push(...filesOf(old));
      index.copies[item.id] = { base, stamp, ...(photo ? { photo, photoRev: rev } : {}) };
      save();
      result.written.push(base);
    } catch (error) {
      result.failed.push(`${item.name}: ${explain(error)}`);
    }
  }
  save();

  // Erst zum Schluss aufräumen: Eine alte Datei kann inzwischen einem anderen Rezept gehören
  const claimed = new Set(Object.values(index.copies).flatMap(filesOf).map((name) => name.toLowerCase()));
  for (const name of new Set(stale)) if (!claimed.has(name.toLowerCase())) rmSync(join(folder, name), { force: true });
  return result;
}
