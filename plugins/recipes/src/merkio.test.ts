import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Datapoint, PluginContext, RouteHandler } from '@culinola/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import plugin from './index.ts';

let dir: string;
const running: AbortController[] = [];

/** Startet das Plugin mit Rezepten aus Merkio; `merkio` sind die Datenpunkte, die die Merkio-Quelle meldet. */
function start(name: string, merkio: Datapoint[], config: Record<string, unknown> = {}) {
  const stop = new AbortController();
  running.push(stop);
  const routes = new Map<string, RouteHandler>();
  const datapoints = new Map<string, unknown>();
  const resources = new Map<string, unknown>();
  const warnings: string[] = [];
  const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
    instanceId: 'recipes',
    config: plugin.parseConfig!({ origin: 'merkio', ...config }),
    log: { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined },
    // Mit Schlüssel: Gesperrt ist das Hinzufügen also nur, weil die Rezepte aus Merkio kommen
    secrets: { get: (key) => (key === 'anthropicApiKey' ? 'schluessel-fuer-den-test' : undefined) },
    storageDir: join(dir, name),
    datapoints: { set: (update) => void datapoints.set(update.id, update.value), list: () => merkio, shown: () => [] },
    actions: { register: () => undefined, list: () => [], run: async () => undefined },
    resources: { set: (key, value) => void resources.set(key, value) },
    routes: { get: (path, handler) => void routes.set(`GET ${path}`, handler), post: (path, handler) => void routes.set(`POST ${path}`, handler) },
    onCommand: () => undefined,
    provideHistory: () => undefined,
    signal: stop.signal,
  };
  void plugin.start!(context);
  const call = (route: string, params: Record<string, string>, body?: unknown) => routes.get(route)!({ params, query: {}, body, signal: new AbortController().signal });
  return { call, datapoints, warnings, titles: () => (resources.get('list') as { title: string }[]).map((entry) => entry.title) };
}

/** Ein Ordner, wie ihn die Merkio-Quelle füllt, und der Datenpunkt, der ihn nennt. */
function mirrored(name: string): { folder: string; point: Datapoint } {
  const folder = join(dir, name, 'rezepte');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'Pfannkuchen.md'), '---\ntitle: Pfannkuchen\ncategory: Hauptgericht\n---\n\n## Zutaten\n\n| Menge | Zutat |\n|---|---|\n| 250 g | Mehl |\n');
  return { folder, point: { id: 'merkio:recipeFolder', value: folder, ts: new Date().toISOString(), quality: 'good' } };
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 300; tries++) {
    if (condition()) return;
    await new Promise((resume) => setTimeout(resume, 15));
  }
  throw new Error(`Nicht eingetreten: ${what}`);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'culinola-rezepte-merkio-'));
});
afterEach(() => {
  for (const stop of running.splice(0)) stop.abort();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Rezepte aus Merkio', () => {
  it('zeigt die Rezepte aus dem Ordner der Merkio-Quelle und folgt ihm', async () => {
    const { folder, point } = mirrored('gemeldet');
    const recipes = start('gemeldet', [point]);
    expect(recipes.titles()).toEqual(['Pfannkuchen']);
    writeFileSync(join(folder, 'Linsensuppe.md'), '# Linsensuppe\n\nLinsen kochen.\n');
    await until(() => recipes.titles().length === 2, 'neues Rezept aus Merkio');
    expect(recipes.titles()).toEqual(['Linsensuppe', 'Pfannkuchen']);
    const text = (await (await recipes.call('GET /text/:id', { id: 'pfannkuchen' })).json()) as { title: string; category: string };
    expect(text).toMatchObject({ title: 'Pfannkuchen', category: 'Hauptgericht' });
  });

  it('nimmt keine neuen Rezepte an – sie werden in Merkio hinzugefügt', async () => {
    const { point } = mirrored('gesperrt');
    const recipes = start('gesperrt', [point]);
    expect(recipes.datapoints.get('importReady')).toBe(false);
    const answer = await recipes.call('POST /import', {}, { text: 'Rührei\n3 Eier verrühren.' });
    expect(answer.status).toBe(409);
    expect(((await answer.json()) as { error: string }).error).toMatch(/aus Merkio/);
  });

  it('wartet auf die Merkio-Quelle, wenn sie später startet', async () => {
    const reported: Datapoint[] = [];
    const recipes = start('spaeter', reported, { merkio: 'kueche' });
    expect(recipes.titles()).toEqual([]);
    const { point } = mirrored('spaeter');
    reported.push({ ...point, id: 'kueche:recipeFolder' });
    await until(() => recipes.titles().length === 1, 'Ordner übernommen');
  });

  it('lässt das eigene Verzeichnis unberührt und liest es nicht', async () => {
    const { point } = mirrored('nur-merkio');
    // Was vorher im eigenen Ordner lag, bleibt liegen, wird aber nicht mehr gezeigt
    writeFileSync(join(dir, 'nur-merkio', 'Altes Rezept.md'), '# Altes Rezept\n');
    const recipes = start('nur-merkio', [point]);
    expect(recipes.titles()).toEqual(['Pfannkuchen']);
  });
});

describe('Konfiguration der Herkunft', () => {
  it('kennt Ordner und Merkio', () => {
    expect(plugin.parseConfig!({})).toEqual({});
    expect(plugin.parseConfig!({ origin: 'folder' })).toEqual({});
    expect(plugin.parseConfig!({ origin: 'merkio', merkio: ' kueche ' })).toEqual({ origin: 'merkio', merkio: 'kueche' });
    for (const raw of [{ origin: 'web' }, { merkio: '' }, { merkio: 3 }]) expect(() => plugin.parseConfig!(raw), JSON.stringify(raw)).toThrow();
  });
});
