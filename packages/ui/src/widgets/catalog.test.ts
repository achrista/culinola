import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import de from '../locales/de.json' with { type: 'json' };
import en from '../locales/en.json' with { type: 'json' };
import { GROUPS, REFERENCE, catalog, initialConfig, minimumOf, sizeIn, sourceFor } from './catalog.ts';

/** Die Kachelarten, wie sie die Oberfläche kennt – aus der Zuordnung in `index.ts` gelesen, weil sich `.vue`-Dateien hier nicht laden lassen. */
const registered = [...readFileSync(new URL('./index.ts', import.meta.url), 'utf8').matchAll(/^\s+'?([a-z][a-z-]*)'?: [A-Z]\w+,$/gm)].map((match) => match[1]!);

describe('Beschreibungen der Kacheln', () => {
  it('gibt es für jede Kachelart – und für keine, die es nicht gibt', () => {
    expect(registered.length).toBeGreaterThan(15);
    expect(Object.keys(catalog).sort()).toEqual([...registered].sort());
  });

  it('nennen Gruppe, Zeichen und Größen, die ins Bezugsraster passen', () => {
    for (const [type, info] of Object.entries(catalog)) {
      expect(GROUPS, type).toContain(info.group);
      expect(info.icon, type).toMatch(/^M[\d\s.,a-zA-Z-]+$/);
      for (const [width, height] of [info.size, info.min]) {
        expect(Number.isInteger(width) && width >= 1 && width <= REFERENCE.columns, type).toBe(true);
        expect(Number.isInteger(height) && height >= 1 && height <= REFERENCE.rows, type).toBe(true);
      }
      expect(info.min[0] <= info.size[0] && info.min[1] <= info.size[1], type).toBe(true);
    }
  });

  it('haben Namen und Beschreibung in beiden Sprachen', () => {
    for (const messages of [de, en]) {
      const texts = messages.catalog as Record<string, { name?: string; text?: string }>;
      expect(Object.keys(texts).sort()).toEqual(Object.keys(catalog).sort());
      for (const [type, text] of Object.entries(texts)) expect(text.name && text.text, type).toBeTruthy();
      expect(Object.keys(messages.editor.group).sort()).toEqual([...GROUPS].sort());
    }
  });
});

describe('sizeIn', () => {
  it('rechnet Größen in ein gröberes oder feineres Raster um', () => {
    expect(sizeIn([24, 2], { columns: 48, rows: 24 })).toEqual([24, 2]);
    expect(sizeIn([24, 2], { columns: 12, rows: 6 })).toEqual([6, 1]);
    expect(sizeIn([8, 3], { columns: 96, rows: 48 })).toEqual([16, 6]);
  });

  it('bleibt bei mindestens einer Einheit und im Raster', () => {
    expect(sizeIn([3, 1], { columns: 12, rows: 6 })).toEqual([1, 1]);
    expect(sizeIn([24, 12], { columns: 2, rows: 1 })).toEqual([1, 1]);
    expect(minimumOf('chart', { columns: 12, rows: 6 })).toEqual([2, 1]);
    expect(minimumOf('gibt-es-nicht', { columns: 12, rows: 6 })).toEqual([1, 1]);
  });
});

describe('Quellen', () => {
  const sources = [
    { id: 'demo', plugin: 'connector-demo' },
    { id: 'radio', plugin: 'media-radio' },
    { id: 'kurzzeit', plugin: 'timer' },
    { id: 'telefon', plugin: 'source-fritzbox' },
  ];

  it('sagt, welche Quelle einer Kachel fehlt', () => {
    expect(sourceFor('mail', sources)).toEqual({ needed: 'source-mail' });
    expect(sourceFor('radio', sources)).toEqual({ instance: 'radio' });
    expect(sourceFor('value-tile', sources)).toEqual({});
    // Die Uhr läuft auch ohne Eieruhr
    expect(sourceFor('clock', [])).toEqual({});
  });

  it('trägt in eine neue Kachel die Vorgaben ein und die Quelle, wo sie anders heißt als üblich', () => {
    expect(initialConfig('radio', sources)).toBeUndefined();
    expect(initialConfig('calls', sources)).toEqual({ source: 'telefon' });
    expect(initialConfig('clock', sources)).toEqual({ timer: 'kurzzeit' });
    expect(initialConfig('clock', [])).toBeUndefined();
    expect(initialConfig('switches', sources)).toEqual({ items: [] });
    // Jede neue Kachel bekommt eigene Vorgaben, nicht die der Beschreibung selbst
    expect(initialConfig('switches', sources)).not.toBe(catalog['switches']!.defaults);
  });
});
