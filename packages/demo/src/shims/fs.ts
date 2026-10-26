// Ein Dateisystem im Arbeitsspeicher an Stelle von `node:fs`. Kern und Plugins lesen und schreiben hier
// wie auf der Platte; was nach dem Start geschrieben wird, bleibt im Browser des Besuchers erhalten.
import { basename, dirname, resolve } from './path.ts';

type Content = string | Uint8Array;

const files = new Map<string, Content>();
const dirs = new Set<string>(['/']);
const written = new Set<string>();
const watchers = new Set<{ dir: string; listener: () => void }>();

/** Ändert sich die mitgelieferte Einrichtung grundlegend, beginnt mit einer neuen Nummer jeder Besucher frisch. */
const STORE_KEY = 'culinola.demo.files.1';
/** Sicherungen, die der Kern vor jedem Schreiben anlegt, braucht im Browser niemand. */
const SKIP = /\.vor-|\.neu$/;
let sealed = false;
let storeKey = STORE_KEY;
let saving: number | undefined;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function missing(path: string, call: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, ${call} '${path}'`), { code: 'ENOENT' });
}

function addDirs(path: string): void {
  for (let dir = path; !dirs.has(dir); dir = dirname(dir)) dirs.add(dir);
}

function changed(path: string): void {
  if (sealed && !SKIP.test(path)) {
    written.add(path);
    window.clearTimeout(saving);
    saving = window.setTimeout(save, 300);
  }
  for (const watcher of watchers) if (path.startsWith(`${watcher.dir}/`)) watcher.listener();
}

function save(): void {
  const kept: Record<string, string> = {};
  for (const path of written) {
    const content = files.get(path);
    if (typeof content === 'string') kept[path] = content;
  }
  try {
    localStorage.setItem(storeKey, JSON.stringify(kept));
  } catch {
    // Ohne Speicher gilt eben nur, was diese Seite gerade weiß.
  }
}

/** Legt eine mitgelieferte Datei an – sie gehört zur Demo, nicht zu dem, was der Besucher geändert hat. */
export function seed(path: string, content: Content): void {
  const full = resolve(path);
  addDirs(dirname(full));
  files.set(full, content);
}

/**
 * Übernimmt, was der Besucher beim letzten Mal geändert hat; ab jetzt wird jedes Schreiben gemerkt. `scope` trennt
 * Stände, die nicht zusammengehören – etwa die deutsche und die englische Demo.
 */
export function restore(scope: string): void {
  storeKey = `${STORE_KEY}.${scope}`;
  try {
    const kept = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, string>;
    for (const [path, content] of Object.entries(kept)) {
      seed(path, content);
      written.add(path);
    }
  } catch {
    // Unlesbar oder nicht erlaubt: Die Demo beginnt frisch.
  }
  sealed = true;
}

/** Vergisst alle Änderungen des Besuchers. */
export function forget(): void {
  try {
    localStorage.removeItem(storeKey);
  } catch {
    // Dann gab es auch nichts zu vergessen.
  }
  written.clear();
}

export function existsSync(path: string): boolean {
  const full = resolve(path);
  return files.has(full) || dirs.has(full);
}

export function readFileSync(path: string | URL, encoding?: string | { encoding?: string }): any {
  const full = resolve(String(path));
  const content = files.get(full);
  if (content === undefined) throw missing(full, 'open');
  const wanted = typeof encoding === 'string' ? encoding : encoding?.encoding;
  if (wanted) return typeof content === 'string' ? content : decoder.decode(content);
  return typeof content === 'string' ? encoder.encode(content) : content;
}

export function writeFileSync(path: string, content: string | Uint8Array): void {
  const full = resolve(path);
  if (!dirs.has(dirname(full))) throw missing(full, 'open');
  files.set(full, typeof content === 'string' ? content : new Uint8Array(content));
  changed(full);
}

export function mkdirSync(path: string, options?: { recursive?: boolean }): void {
  const full = resolve(path);
  if (!options?.recursive && !dirs.has(dirname(full))) throw missing(full, 'mkdir');
  addDirs(full);
}

interface Entry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export function readdirSync(path: string, options?: { withFileTypes?: boolean }): any[] {
  const full = resolve(path);
  if (!dirs.has(full)) throw missing(full, 'scandir');
  const prefix = full === '/' ? '/' : `${full}/`;
  const entries = new Map<string, Entry>();
  const direct = (candidate: string) => candidate.startsWith(prefix) && candidate !== full && !candidate.slice(prefix.length).includes('/');
  for (const dir of dirs) if (direct(dir)) entries.set(basename(dir), { name: basename(dir), isFile: () => false, isDirectory: () => true });
  for (const file of files.keys()) if (direct(file)) entries.set(basename(file), { name: basename(file), isFile: () => true, isDirectory: () => false });
  const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  return options?.withFileTypes ? sorted : sorted.map((entry) => entry.name);
}

export function statSync(path: string): { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean } {
  const full = resolve(path);
  const content = files.get(full);
  if (content === undefined && !dirs.has(full)) throw missing(full, 'stat');
  const size = content === undefined ? 0 : typeof content === 'string' ? encoder.encode(content).length : content.length;
  return { size, mtimeMs: 0, isFile: () => content !== undefined, isDirectory: () => content === undefined };
}

export function copyFileSync(from: string, to: string): void {
  writeFileSync(to, readFileSync(from) as Uint8Array);
}

export function renameSync(from: string, to: string): void {
  const source = resolve(from);
  const content = files.get(source);
  if (content === undefined) throw missing(source, 'rename');
  files.delete(source);
  written.delete(source);
  writeFileSync(to, content);
}

export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void {
  const full = resolve(path);
  if (!files.delete(full) && !options?.force) throw missing(full, 'rm');
  written.delete(full);
  changed(full);
}

// Schreiben über einen Dateizeiger, wie es `JsonFile` tut: Der Inhalt sammelt sich und steht beim Schließen da.
const open = new Map<number, { path: string; parts: string[] }>();
let handles = 10;

export function openSync(path: string): number {
  open.set(++handles, { path, parts: [] });
  return handles;
}

export function writeSync(handle: number, text: string): void {
  open.get(handle)?.parts.push(text);
}

export function fsyncSync(): void {}

export function closeSync(handle: number): void {
  const pending = open.get(handle);
  open.delete(handle);
  if (pending) writeFileSync(pending.path, pending.parts.join(''));
}

/** Beobachten einer Datei auf Änderungen von Hand – die gibt es im Browser nicht. */
export function watchFile(): void {}
export function unwatchFile(): void {}

/** Meldet jedes Schreiben unterhalb eines Ordners, wie es das Beobachten eines Ordners auf der Platte täte. */
export function watch(path: string, _options: unknown, listener: () => void): { on(): void; close(): void } {
  const watcher = { dir: resolve(path), listener };
  watchers.add(watcher);
  return { on: () => undefined, close: () => void watchers.delete(watcher) };
}

export function createReadStream(): never {
  throw new Error('Datenströme aus Dateien gibt es in der Demo nicht.');
}

export default { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, renameSync, rmSync, openSync, writeSync, fsyncSync, closeSync, watchFile, unwatchFile, watch, createReadStream };
