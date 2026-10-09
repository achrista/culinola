import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext, RouteHandler } from '@culinola/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Der Platzhalter für die Claude-API gehört zum Import-Werkzeug, ist aber nicht Teil dessen, was es nach außen anbietet
import { startStandIn, type StandIn } from '../../../packages/recipe-import/src/standin.ts';
import { ImportRefused, importInput, statusOf } from './importer.ts';
import plugin from './index.ts';

describe('Eingabe für ein neues Rezept', () => {
  const input = (body: unknown, query: Record<string, string> = {}) => importInput({ body, query });

  it('nimmt Webadresse, Text und Datei an', () => {
    expect(input({ url: ' https://example.org/rezept ' })).toEqual({ url: 'https://example.org/rezept' });
    expect(input({ text: 'Pfannkuchen\n250 g Mehl' })).toEqual({ text: 'Pfannkuchen\n250 g Mehl' });
    expect(input(Buffer.from('%PDF'), { name: 'C:\\Rezepte\\Omas Kuchen.pdf' })).toEqual({ data: Buffer.from('%PDF'), name: 'Omas Kuchen.pdf' });
    expect(input(Buffer.from('%PDF'))).toMatchObject({ name: 'Vorlage' });
  });

  it('weist Unbrauchbares als Fehler des Aufrufers zurück', () => {
    for (const body of [undefined, null, {}, { url: '  ' }, { url: 'ftp://example.org/a' }, { url: 'javascript:alert(1)' }, { url: 'https://example.org/a b' }, { url: `https://example.org/${'a'.repeat(2000)}` }, { text: ' \n' }, { url: 7 }, Buffer.alloc(0)]) {
      expect(() => input(body), JSON.stringify(body)).toThrow(ImportRefused);
    }
  });

  it('unterscheidet, wer einen Fehler beheben kann', () => {
    expect([statusOf('access'), statusOf('busy'), statusOf('model'), statusOf('empty'), statusOf('source')]).toEqual([503, 503, 502, 422, 422]);
  });
});

describe('Neues Rezept über das Plugin', () => {
  let dir: string;
  let standIn: StandIn;
  const before = { key: process.env['ANTHROPIC_API_KEY'], url: process.env['ANTHROPIC_BASE_URL'] };
  const stop = new AbortController();

  /** Startet das Plugin in einem eigenen Ordner und gibt seine Adresse zum Hinzufügen zurück. */
  function start(name: string, secrets: Record<string, string>) {
    const routes = new Map<string, RouteHandler>();
    const datapoints = new Map<string, unknown>();
    const resources = new Map<string, unknown>();
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'recipes',
      config: {},
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      secrets: { get: (key) => secrets[key] },
      storageDir: join(dir, name),
      datapoints: { set: (update) => void datapoints.set(update.id, update.value) },
      actions: { register: () => undefined, list: () => [], run: async () => undefined },
      resources: { set: (key, value) => void resources.set(key, value) },
      routes: { get: (path, handler) => void routes.set(`GET ${path}`, handler), post: (path, handler) => void routes.set(`POST ${path}`, handler) },
      onCommand: () => undefined,
      provideHistory: () => undefined,
      signal: stop.signal,
    };
    void plugin.start!(context);
    const handler = routes.get('POST /import')!;
    const add = async (body: unknown, query: Record<string, string> = {}) => handler({ params: {}, query, body, signal: new AbortController().signal });
    return { add, datapoints, list: () => resources.get('list') as { id: string; title: string; image?: string }[], folder: context.storageDir };
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'culinola-import-'));
    standIn = await startStandIn();
    // Anfragen gehen an den Platzhalter auf diesem Rechner, nie an die echte Schnittstelle
    process.env['ANTHROPIC_BASE_URL'] = standIn.url;
    delete process.env['ANTHROPIC_API_KEY'];
  });
  afterAll(async () => {
    stop.abort();
    await standIn.close();
    for (const [name, value] of [['ANTHROPIC_API_KEY', before.key], ['ANTHROPIC_BASE_URL', before.url]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('meldet ohne Schlüssel, dass das Hinzufügen nicht eingerichtet ist', async () => {
    const recipes = start('ohne', {});
    expect(recipes.datapoints.get('importReady')).toBe(false);
    const answer = await recipes.add({ text: 'Pfannkuchen' });
    expect(answer.status).toBe(503);
    expect(((await answer.json()) as { error: string }).error).toMatch(/anthropicApiKey/);
    expect((await recipes.add({})).status).toBe(400);
    expect(standIn.requests).toHaveLength(0);
  });

  it('legt aus einem Text ein Rezept in den Ordner und nennt dessen Kennung', async () => {
    const recipes = start('text', { anthropicApiKey: 'schluessel-fuer-den-test' });
    expect(recipes.datapoints.get('importReady')).toBe(true);
    const answer = await recipes.add({ text: 'Rührei\n3 Eier, 1 Prise Salz. Alles verrühren.' });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ recipes: [{ title: 'Rührei', id: 'sonstiges-ruehrei' }], warnings: [] });
    expect(readFileSync(join(recipes.folder, 'Sonstiges', 'Rührei.md'), 'utf8')).toMatch(/^title: Rührei$/m);
    // Die Liste ist schon neu gelesen, wenn die Antwort kommt
    expect(recipes.list().map((entry) => entry.id)).toEqual(['sonstiges-ruehrei']);
    expect(standIn.requests.at(-1)!.model).toBe('claude-haiku-5-5');
  });

  it('nimmt ein hochgeladenes Foto als Vorlage und legt es als Bild des Rezepts ab', async () => {
    const recipes = start('foto', { anthropicApiKey: 'schluessel-fuer-den-test' });
    const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 9)]);
    const answer = await recipes.add(photo, { name: 'Kochbuch Seite 12.jpg' });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ recipes: [{ title: 'Kochbuch Seite 12' }] });
    expect(recipes.list()).toMatchObject([{ title: 'Kochbuch Seite 12', image: 'Kochbuch Seite 12.jpg' }]);
    expect(readFileSync(join(recipes.folder, 'Sonstiges', 'Kochbuch Seite 12.jpg')).equals(photo)).toBe(true);
  });

  it('legt nichts ab, wenn die Vorlage kein Rezept enthält oder nicht lesbar ist', async () => {
    const recipes = start('leer', { anthropicApiKey: 'schluessel-fuer-den-test' });
    const none = await recipes.add({ text: 'Kein Rezept, nur ein Einkaufszettel.' });
    expect([none.status, ((await none.json()) as { error: string }).error]).toEqual([422, 'In der Vorlage wurde kein Rezept gefunden.']);
    const unreadable = await recipes.add(Buffer.from([1, 0, 2, 0, 3]), { name: 'daten.bin' });
    expect(unreadable.status).toBe(422);
    const local = await recipes.add({ url: 'http://192.168.178.1/rezept' });
    expect([local.status, ((await local.json()) as { error: string }).error]).toEqual([422, 'Diese Adresse wird nicht gelesen.']);
    expect(existsSync(join(recipes.folder, 'Sonstiges'))).toBe(false);
  });
});
