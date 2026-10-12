import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { describe, expect, it } from 'vitest';
import { loadTemplates, parseTemplate } from './templates.ts';

const DATAPOINT_ID = /^[a-z][a-z0-9-]*:[\w.-]+$/;

/** Alle Texte in einem verschachtelten Wert. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
}

describe('mitgelieferte Vorlagen', () => {
  const warnings: string[] = [];
  const log: Logger = { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined };
  const templates = loadTemplates(resolve(import.meta.dirname, '../../../templates'), log);

  it('lassen sich alle lesen und haben Namen und Beschreibung in beiden Sprachen', () => {
    expect(warnings).toEqual([]);
    expect(templates.map((template) => template.id)).toEqual(['flur', 'haus', 'kueche']);
    for (const template of templates) {
      for (const language of ['de', 'en']) expect(template.name[language] && template.text[language], `${template.id} ${language}`).toBeTruthy();
    }
  });

  it('verweisen auf keine Datenpunkte und keine Quellen – die trägt ein, wer sie benutzt', () => {
    for (const template of templates) {
      for (const widget of template.layout.widgets) {
        expect(strings(widget.config).filter((text) => DATAPOINT_ID.test(text)), `${template.id} ${widget.type}`).toEqual([]);
        expect(Object.keys((widget.config ?? {}) as object).filter((key) => ['source', 'timer', 'tv'].includes(key)), `${template.id} ${widget.type}`).toEqual([]);
      }
    }
  });
});

describe('loadTemplates', () => {
  it('übergeht eine kaputte Vorlage mit einer Warnung und liefert die anderen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'culinola-vorlagen-'));
    const warnings: string[] = [];
    try {
      writeFileSync(join(dir, 'gut.json'), JSON.stringify({ name: { de: 'Gut' }, layout: { grid: { columns: 2, rows: 1 }, widgets: [] } }));
      writeFileSync(join(dir, 'kaputt.json'), '{ kaputt');
      writeFileSync(join(dir, 'ueberlappt.json'), JSON.stringify({ name: { de: 'x' }, layout: { grid: { columns: 2, rows: 1 }, widgets: [{ type: 'a', at: [0, 0, 2, 1] }, { type: 'b', at: [1, 0, 1, 1] }] } }));
      writeFileSync(join(dir, 'namenlos.json'), JSON.stringify({ layout: { grid: { columns: 2, rows: 1 }, widgets: [] } }));
      writeFileSync(join(dir, 'liesmich.txt'), 'keine Vorlage');
      const templates = loadTemplates(dir, { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined });
      expect(templates.map((template) => template.id)).toEqual(['gut']);
      expect(warnings).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(loadTemplates(join(dir, 'gibt-es-nicht'), { info: () => undefined, warn: () => undefined, error: () => undefined })).toEqual([]);
  });

  it('nimmt nur Texte als Namen', () => {
    expect(parseTemplate('x', { name: { de: 'Gut', en: 7 }, text: 'kein Objekt', layout: { grid: { columns: 1, rows: 1 }, widgets: [] } })).toMatchObject({ name: { de: 'Gut' }, text: {} });
  });
});
