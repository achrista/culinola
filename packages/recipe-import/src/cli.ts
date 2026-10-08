#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConversionError, convertMaterial, DEFAULT_MODEL, type ConvertedRecipe } from './convert.ts';
import { renderMarkdown } from './markdown.ts';
import { EmptySourceError, readSource, type RecipeInput } from './source.ts';

const HELP = `Wandelt Rezepte in das Format von Culinola und Merkio um.

  node src/cli.ts <Quelle …> [Optionen]

Quelle ist eine Datei, ein Ordner oder eine Webadresse.

  --out <Ordner>       Zielordner (Vorgabe: ausgabe)
  --label <Vermerk>    Herkunft, z. B. "Familienrezept"; wird auch Stichwort
  --tag <Stichwort>    zusätzliches Stichwort, mehrfach möglich
  --recursive          Unterordner mitlesen
  --language <Kürzel>  Sprache der Ausgabe: de, en, fr (Vorgabe: de)
  --model <Kennung>    Sprachmodell (Vorgabe: ${DEFAULT_MODEL})
  --concurrency <n>    gleichzeitige Anfragen (Vorgabe: 4)
  --limit <n>          höchstens n Quellen verarbeiten
  --force              bereits umgewandelte Quellen erneut umwandeln
  --dry-run            Quellen nur einlesen, das Sprachmodell nicht aufrufen
`;

const SOURCE_TYPES = new Set(['.pdf', '.docx', '.docm', '.odt', '.doc', '.txt', '.md', '.htm', '.html', '.jpg', '.jpeg', '.png', '.webp', '.gif']);
const PHOTO_ENDINGS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

interface Entry {
  hash: string;
  status: 'ok' | 'leer' | 'fehler';
  /** Erzeugte Dateien, relativ zum Zielordner. */
  files: string[];
  titles?: string[];
  error?: string;
}

interface Log {
  version: 1;
  entries: Record<string, Entry>;
}

/** Dateiname aus einem Titel: Umlaute bleiben, was Dateisysteme nicht mögen, fällt weg. */
export function fileName(title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return name || 'Rezept';
}

/** Kennung wie in Culinola: "Omas Käsekuchen" wird "omas-kaesekuchen". */
export function slug(title: string): string {
  const id = title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'rezept';
}

function sources(target: string, recursive: boolean): string[] {
  if (/^https?:\/\//i.test(target)) return [target];
  const path = resolve(target);
  if (!existsSync(path)) throw new Error(`Nicht gefunden: ${target}`);
  if (statSync(path).isFile()) return [path];
  const found: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
    if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
    const full = join(path, entry.name);
    if (entry.isDirectory() && recursive) found.push(...sources(full, true));
    else if (entry.isFile() && SOURCE_TYPES.has(extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: 'ausgabe' },
      label: { type: 'string' },
      tag: { type: 'string', multiple: true },
      recursive: { type: 'boolean', default: false },
      language: { type: 'string', default: 'de' },
      model: { type: 'string', default: DEFAULT_MODEL },
      concurrency: { type: 'string', default: '4' },
      limit: { type: 'string' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || !positionals.length) {
    console.log(HELP);
    return values.help ? 0 : 1;
  }
  // Der API-Schlüssel darf in einer Datei .env neben dem Aufruf liegen
  if (existsSync('.env')) process.loadEnvFile('.env');

  const out = resolve(values.out);
  const logFile = join(out, 'protokoll.json');
  const log: Log = existsSync(logFile) ? (JSON.parse(readFileSync(logFile, 'utf8')) as Log) : { version: 1, entries: {} };
  const taken = new Set(Object.values(log.entries).flatMap((entry) => entry.files.map((file) => file.toLowerCase())));
  const saveLog = () => {
    mkdirSync(out, { recursive: true });
    writeFileSync(logFile, `${JSON.stringify(log, null, 2)}\n`);
  };

  const all = positionals.flatMap((target) => sources(target, values.recursive));
  const queue = values.limit ? all.slice(0, Number(values.limit)) : all;
  const dryRun = values['dry-run'];
  const client = dryRun ? undefined : new Anthropic({ maxRetries: 5 });
  const total = { ok: 0, recipes: 0, empty: 0, failed: 0, skipped: 0, input: 0, output: 0 };
  let aborted: string | undefined;

  /** Ein freier Pfad im Zielordner; Namen anderer Quellen werden nicht überschrieben. */
  const free = (folder: string, name: string, ending: string): string => {
    for (let count = 1; ; count++) {
      const path = join(folder, `${name}${count > 1 ? ` (${count})` : ''}${ending}`).replaceAll('\\', '/');
      if (!taken.has(path.toLowerCase()) && !existsSync(join(out, path))) {
        taken.add(path.toLowerCase());
        return path;
      }
    }
  };

  const write = (converted: ConvertedRecipe): string[] => {
    const { recipe, photo } = converted;
    const name = fileName(recipe.title);
    const markdownPath = free(join('culinola', fileName(recipe.category ?? 'Sonstiges')), name, '.md');
    const files = [markdownPath];
    if (photo) {
      const photoPath = free(dirname(markdownPath), markdownPath.slice(markdownPath.lastIndexOf('/') + 1, -3), PHOTO_ENDINGS[photo.mediaType] ?? '.jpg');
      recipe.image = photoPath.slice(photoPath.lastIndexOf('/') + 1);
      files.push(photoPath);
      mkdirSync(dirname(join(out, photoPath)), { recursive: true });
      writeFileSync(join(out, photoPath), photo.data);
    }
    const markdown = renderMarkdown(recipe, values.language);
    const jsonPath = free('merkio', slug(recipe.title), '.json');
    files.push(jsonPath);
    for (const [path, text] of [
      [markdownPath, markdown],
      [jsonPath, `${JSON.stringify({ ...recipe, markdown }, null, 2)}\n`],
    ] as const) {
      mkdirSync(dirname(join(out, path)), { recursive: true });
      writeFileSync(join(out, path), text);
    }
    return files;
  };

  const handle = async (source: string, position: number): Promise<void> => {
    const isUrl = /^https?:\/\//i.test(source);
    const shown = isUrl ? source : relative(process.cwd(), source) || source;
    const prefix = `[${position}/${queue.length}] ${shown}`;
    const input: RecipeInput = isUrl ? { url: source } : { file: source };
    const hash = isUrl ? '' : createHash('sha256').update(readFileSync(source)).digest('hex');
    const known = log.entries[source];
    if (!dryRun && !values.force && known && known.status !== 'fehler' && known.hash === hash && !isUrl) {
      total.skipped++;
      return;
    }
    let phase: 'read' | 'model' | 'write' = 'read';
    try {
      const material = await readSource(input);
      phase = 'model';
      if (dryRun) {
        const parts = [material.text ? `${material.text.length} Zeichen Text` : '', material.pdf ? `PDF ${Math.round(material.pdf.length / 1024)} KB` : '', material.images.length ? `${material.images.length} Bild(er)` : ''];
        console.log(`${prefix}: ${parts.filter(Boolean).join(', ')}`);
        total.ok++;
        return;
      }
      const result = await convertMaterial(material, {
        client: client!,
        model: values.model,
        language: values.language,
        ...(values.label ? { label: values.label } : {}),
        ...(values.tag ? { tags: values.tag } : {}),
      });
      phase = 'write';
      total.input += result.usage.inputTokens;
      total.output += result.usage.outputTokens;
      // Frühere Ergebnisse derselben Quelle weichen den neuen
      for (const file of known?.files ?? []) {
        rmSync(join(out, file), { force: true });
        taken.delete(file.toLowerCase());
      }
      const files = result.recipes.flatMap(write);
      log.entries[source] = { hash, status: result.recipes.length ? 'ok' : 'leer', files, titles: result.recipes.map(({ recipe }) => recipe.title) };
      if (result.recipes.length) {
        total.ok++;
        total.recipes += result.recipes.length;
        console.log(`${prefix}: ${result.recipes.map(({ recipe }) => recipe.title).join(' · ')}`);
      } else {
        total.empty++;
        console.log(`${prefix}: kein Rezept gefunden`);
      }
      for (const warning of result.warnings) console.log(`    Hinweis: ${warning}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Fehlt der Zugang, scheitert jede weitere Quelle genauso: Der Lauf endet hier.
      // Ohne hinterlegten Schlüssel meldet das SDK das als gewöhnlichen Fehler, noch vor der ersten Anfrage.
      const noAccess = error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || (phase === 'model' && !(error instanceof Anthropic.APIError) && !(error instanceof ConversionError));
      if (noAccess) {
        aborted ??= `Kein Zugang zur Claude-API: ${message}\n\nAPI-Schlüssel als Umgebungsvariable ANTHROPIC_API_KEY setzen oder in eine Datei .env im Projektordner schreiben (ANTHROPIC_API_KEY=…).`;
        return;
      }
      if (error instanceof EmptySourceError) total.empty++;
      else total.failed++;
      if (!dryRun) log.entries[source] = { hash, status: error instanceof EmptySourceError ? 'leer' : 'fehler', files: known?.files ?? [], error: message };
      console.log(`${prefix}: ${error instanceof EmptySourceError ? 'leer' : 'FEHLER'} – ${message}`);
    }
    if (!dryRun) saveLog();
  };

  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(8, Number(values.concurrency) || 1)) }, async () => {
    while (next < queue.length && !aborted) {
      const position = ++next;
      await handle(queue[position - 1]!, position);
    }
  });
  await Promise.all(workers);

  if (aborted) {
    console.error(`\n${aborted}`);
    return 2;
  }
  console.log(
    dryRun
      ? `\n${total.ok} Quellen lesbar, ${total.empty} leer, ${total.failed} mit Fehler.`
      : `\n${total.recipes} Rezepte aus ${total.ok} Quellen, ${total.empty} ohne Rezept, ${total.failed} mit Fehler, ${total.skipped} schon vorhanden.\nVerbrauch: ${total.input} Eingabe- und ${total.output} Ausgabe-Token.\nErgebnis in ${out}`,
  );
  return total.failed ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main();
