import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LayoutConfig } from './config.ts';
import { InvalidLayout, LayoutConflict, LayoutStore, UnknownLayout, revisionOf } from './layouts.ts';

const main: LayoutConfig = {
  grid: { columns: 12, rows: 6 },
  widgets: [
    { type: 'clock', at: [0, 0, 4, 2] },
    { type: 'note', at: [4, 0, 4, 2], config: { text: 'Hallo', eigenes: { bleibt: true } } },
  ],
};
const moved = (): LayoutConfig => ({ ...structuredClone(main), widgets: [{ type: 'clock', at: [8, 4, 4, 2] }, structuredClone(main.widgets[1]!)] });

let dir: string;
let file: string;
let warnings: string[];
let log: Logger;

/** Legt eine Konfiguration ab, wie sie jemand von Hand geschrieben hat, und startet einen Kern darauf. */
function start(config: Record<string, unknown> = { port: 8090, sources: [{ id: 'demo', plugin: 'connector-demo' }], eigenes: 'bleibt', layouts: { main, flur: { grid: { columns: 2, rows: 1 }, widgets: [] } } }) {
  writeFileSync(file, JSON.stringify(config, null, 2));
  const layouts = structuredClone(config['layouts']) as Record<string, LayoutConfig>;
  return { layouts, store: new LayoutStore(layouts, file, config, log) };
}
const onDisk = () => JSON.parse(readFileSync(file, 'utf8')) as { layouts: Record<string, LayoutConfig> } & Record<string, unknown>;
const backups = () => readdirSync(dir).filter((name) => name.startsWith('config.vor-')).sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'culinola-layouts-'));
  file = join(dir, 'config.json');
  warnings = [];
  log = { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('LayoutStore.save', () => {
  it('schreibt das Layout in die Datei, lässt alles andere stehen und meldet die Änderung', () => {
    const { layouts, store } = start();
    const seen: [string, string | undefined][] = [];
    store.onChange((id, rev) => seen.push([id, rev]));

    const rev = store.save('main', moved(), store.rev('main'));

    expect(rev).toBe(revisionOf(moved()));
    expect(onDisk()).toEqual({ port: 8090, sources: [{ id: 'demo', plugin: 'connector-demo' }], eigenes: 'bleibt', layouts: { main: moved(), flur: { grid: { columns: 2, rows: 1 }, widgets: [] } } });
    // Dasselbe Objekt, das der übrige Kern hält, zeigt den neuen Stand
    expect(layouts['main']).toEqual(moved());
    expect(seen).toEqual([['main', rev]]);
    expect(existsSync(`${file}.neu`)).toBe(false);
    expect(readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('erhält Angaben, die es nicht kennt – am Layout, an der Kachel und in deren Einstellungen', () => {
    const { store } = start();
    const layout = { ...moved(), screen: [16, 10], merkzettel: 'Entwurf', widgets: [{ type: 'neu-und-unbekannt', at: [0, 0, 1, 1], hinweis: 'x', config: { tief: [{ a: 1 }] } }] };
    store.save('main', layout, store.rev('main'));
    expect(onDisk().layouts['main']).toEqual(layout);
  });

  it('sichert vorher die bisherige Datei und behält davon die letzten zehn', () => {
    const { store } = start();
    const before = readFileSync(file, 'utf8');
    writeFileSync(join(dir, 'config.vor-umbau.json'), 'von Hand gesichert');

    store.save('main', moved(), store.rev('main'));
    const own = backups().filter((name) => name !== 'config.vor-umbau.json');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/^config\.vor-\d{8}-\d{6}-\d{3}\.json$/);
    expect(readFileSync(join(dir, own[0]!), 'utf8')).toBe(before);

    // Ältere eigene Sicherungen weichen, von Hand benannte bleiben
    for (let n = 0; n < 12; n++) writeFileSync(join(dir, `config.vor-20200101-0000${String(n).padStart(2, '0')}-000.json`), '{}');
    store.save('main', main, store.rev('main'));
    expect(backups().filter((name) => name !== 'config.vor-umbau.json')).toHaveLength(10);
    expect(backups()).toContain('config.vor-umbau.json');
    expect(backups()).not.toContain('config.vor-20200101-000000-000.json');
  });

  it('weist ab, was nicht passt, und lässt die Datei dann unberührt', () => {
    const { store } = start();
    const before = readFileSync(file, 'utf8');
    const rev = store.rev('main');
    const overlapping = { ...main, widgets: [...main.widgets, { type: 'note', at: [3, 1, 2, 2] }] };

    expect(() => store.save('main', overlapping, rev)).toThrow(InvalidLayout);
    expect(() => store.save('main', overlapping, rev)).toThrow(/Kachel 3 \("note"\) liegt über Kachel 1 \("clock"\)/);
    expect(() => store.save('main', { ...main, widgets: [{ type: 'clock', at: [10, 0, 4, 2] }] }, rev)).toThrow(/nicht ganz im Raster/);
    expect(() => store.save('main', 'kein Layout', rev)).toThrow(InvalidLayout);
    expect(() => store.save('gibt-es-nicht', main, rev)).toThrow(UnknownLayout);
    expect(() => store.save('__proto__', main, rev)).toThrow(UnknownLayout);

    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('überschreibt nicht, was ein anderer inzwischen gespeichert hat – außer ausdrücklich', () => {
    const { store } = start();
    const first = store.rev('main');
    const second = store.save('main', moved(), first);
    const late = { ...main, widgets: [] };

    let conflict: unknown;
    try {
      store.save('main', late, first);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(LayoutConflict);
    expect((conflict as LayoutConflict).rev).toBe(second);
    expect(() => store.save('main', late, undefined)).toThrow(LayoutConflict);
    expect(onDisk().layouts['main']).toEqual(moved());

    expect(store.save('main', late, undefined, true)).toBe(revisionOf(late));
    expect(onDisk().layouts['main']).toEqual(late);
  });

  it('schreibt nichts, wenn sich nichts geändert hat', () => {
    const { store } = start();
    expect(store.save('main', structuredClone(main), store.rev('main'))).toBe(store.rev('main'));
    expect(backups()).toEqual([]);
  });

  it('bemerkt eine Änderung von Hand, bevor es darüber schreibt', () => {
    const { store } = start();
    const rev = store.rev('main');
    const byHand = onDisk();
    byHand.layouts['main'] = { ...main, widgets: [] };
    byHand['port'] = 8091;
    writeFileSync(file, JSON.stringify(byHand));

    expect(() => store.save('main', moved(), rev)).toThrow(LayoutConflict);
    expect(onDisk()).toEqual(byHand);
    // Was von Hand außerhalb der Layouts geändert wurde, bleibt beim nächsten Speichern erhalten
    store.save('main', moved(), store.rev('main'));
    expect(onDisk()['port']).toBe(8091);
  });

  it('schreibt nicht über eine Datei, die sich gerade nicht lesen lässt', () => {
    const { store } = start();
    const rev = store.rev('main');
    writeFileSync(file, '{ "layouts": { "main": ');
    expect(() => store.save('main', moved(), rev)).toThrow(/lässt sich nicht lesen.*Gespeichert wurde nichts/s);
    expect(readFileSync(file, 'utf8')).toBe('{ "layouts": { "main": ');
  });

  it('legt die Datei an, wenn der Kern mit Beispielwerten läuft', () => {
    const demo = { port: 8090, sources: [{ id: 'demo', plugin: 'connector-demo' }], layouts: { main: structuredClone(main) } };
    const store = new LayoutStore(demo.layouts, file, demo, log);
    store.save('main', moved(), store.rev('main'));
    expect(onDisk()).toEqual({ ...demo, layouts: { main: moved() } });
    expect(backups()).toEqual([]);
  });
});

describe('LayoutStore.sync', () => {
  it('übernimmt geänderte, neue und entfernte Layouts aus der Datei und meldet genau diese', () => {
    const { layouts, store } = start();
    const seen: [string, string | undefined][] = [];
    store.onChange((id, rev) => seen.push([id, rev]));

    store.sync();
    expect(seen).toEqual([]);

    const byHand = onDisk();
    byHand.layouts = { main: moved(), kueche: { grid: { columns: 4, rows: 4 }, widgets: [] } };
    writeFileSync(file, JSON.stringify(byHand));
    store.sync();

    expect(Object.keys(layouts).sort()).toEqual(['kueche', 'main']);
    expect(layouts['main']).toEqual(moved());
    expect(seen.sort()).toEqual([['flur', undefined], ['kueche', store.rev('kueche')], ['main', revisionOf(moved())]].sort());
    expect(warnings).toEqual([]);
  });

  it('sagt, dass Änderungen außerhalb der Layouts einen Neustart brauchen', () => {
    const { store } = start();
    writeFileSync(file, JSON.stringify({ ...onDisk(), port: 9000 }));
    store.sync();
    expect(warnings).toEqual([expect.stringMatching(/außerhalb der Layouts geändert.*Neustart/)]);
    store.sync();
    expect(warnings).toHaveLength(1);
  });

  it('behält den bisherigen Stand, solange die Datei kaputt ist', () => {
    const { layouts, store } = start();
    writeFileSync(file, '{ kaputt');
    expect(() => store.sync()).toThrow(/lässt sich nicht lesen/);
    writeFileSync(file, JSON.stringify({ sources: [] }));
    expect(() => store.sync()).toThrow(/"layouts" fehlt/);
    expect(layouts['main']).toEqual(main);
  });
});

describe('LayoutStore: anlegen, umbenennen, löschen', () => {
  it('meldet den Anzeigen jedes Layout, das dazukommt, wegfällt oder den Namen wechselt', () => {
    const { layouts, store } = start();
    const seen: [string, string | undefined][] = [];
    store.onChange((id, rev) => seen.push([id, rev]));

    const rev = store.create('kueche', moved());
    store.rename('kueche', 'bad');
    store.remove('flur');

    expect(seen).toEqual([['kueche', rev], ['kueche', undefined], ['bad', rev], ['flur', undefined]]);
    expect(Object.keys(layouts)).toEqual(['main', 'bad']);
    expect(Object.keys(onDisk().layouts)).toEqual(['main', 'bad']);
    expect(onDisk()['eigenes']).toBe('bleibt');
    expect(backups()).toHaveLength(3);
  });

  it('behält beim Umbenennen den Platz in der Datei', () => {
    const { store } = start();
    store.rename('main', 'kueche');
    expect(Object.keys(onDisk().layouts)).toEqual(['kueche', 'flur']);
    store.rename('kueche', 'kueche');
    expect(backups()).toHaveLength(1);
  });

  it('weist ab, was nicht geht, und lässt die Datei dann unberührt', () => {
    const { store } = start();
    const before = readFileSync(file, 'utf8');
    expect(() => store.create('main', main)).toThrow(LayoutConflict);
    for (const id of ['Küche', 'mit leer', '../x', '', '9lives', '__proto__', 'a'.repeat(41)]) expect(() => store.create(id, main), id).toThrow(InvalidLayout);
    expect(() => store.create('neu', { grid: { columns: 1, rows: 1 }, widgets: [{ type: 'clock', at: [0, 0, 2, 1] }] })).toThrow(InvalidLayout);
    expect(() => store.rename('main', 'flur')).toThrow(LayoutConflict);
    expect(() => store.rename('fehlt', 'neu')).toThrow(UnknownLayout);
    expect(() => store.remove('fehlt')).toThrow(UnknownLayout);
    expect(readFileSync(file, 'utf8')).toBe(before);

    store.remove('flur');
    expect(() => store.remove('main')).toThrow(/letzte Layout/);
    expect(Object.keys(onDisk().layouts)).toEqual(['main']);
  });
});
