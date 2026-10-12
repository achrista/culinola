import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Logger, layoutProblems } from '@culinola/sdk';
import type { LayoutConfig } from './config.ts';

/** Eine mitgelieferte Vorlage: ein Layout zum Anfangen, ohne Datenpunkte – die trägt man danach ein. */
export interface Template {
  /** Der Dateiname ohne Endung. */
  id: string;
  /** Name und ein Satz Beschreibung je Sprache: `{ "de": "Küche", "en": "Kitchen" }`. */
  name: Record<string, string>;
  text: Record<string, string>;
  layout: LayoutConfig;
}

const texts = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};

/** Liest eine Vorlage; wirft mit einer Meldung, die sagt, was an ihr nicht stimmt. */
export function parseTemplate(id: string, raw: unknown): Template {
  const { name, text, layout } = (raw && typeof raw === 'object' ? raw : {}) as { name?: unknown; text?: unknown; layout?: unknown };
  const problems = layoutProblems(layout);
  if (problems.length) throw new Error(problems[0]);
  if (!Object.keys(texts(name)).length) throw new Error('"name" fehlt – etwa { "de": "Küche", "en": "Kitchen" }.');
  return { id, name: texts(name), text: texts(text), layout: layout as LayoutConfig };
}

/** Liest die Vorlagen aus einem Ordner. Eine kaputte Datei ergibt eine Warnung und hält die anderen nicht auf. */
export function loadTemplates(dir: string, log: Logger): Template[] {
  if (!existsSync(dir)) return [];
  const templates: Template[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    try {
      templates.push(parseTemplate(file.slice(0, -'.json'.length), JSON.parse(readFileSync(join(dir, file), 'utf8'))));
    } catch (error) {
      log.warn(`Vorlage ${file} übergangen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return templates;
}
