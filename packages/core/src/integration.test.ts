import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Datapoint, Logger } from '@culinola/sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessToken } from './access.ts';
import { ActionRegistry } from './actions.ts';
import type { AppConfig } from './config.ts';
import { PluginHost } from './plugins.ts';
import { DatapointRegistry } from './registry.ts';
import { buildServer } from './server.ts';

/**
 * Zusammenspiel von Kern und Plugins: ein vollständiger Kern mit echten Plugins in einem
 * Wegwerf-Datenordner, angesprochen über die API – ohne Netz und ohne offenen Port.
 */
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const config: AppConfig = {
  port: 0,
  sources: [
    { id: 'demo', plugin: 'connector-demo' },
    { id: 'timer', plugin: 'timer' },
    { id: 'recipes', plugin: 'recipes' },
    { id: 'voice', plugin: 'voice' },
    { id: 'gibtesnicht', plugin: 'gibt-es-nicht' },
  ],
  layouts: { main: { grid: { columns: 2, rows: 1 }, widgets: [{ type: 'clock', at: [0, 0, 2, 1] }] } },
  site: { language: 'de', region: 'de-DE' },
};

let dataDir: string;
const hosts: PluginHost[] = [];
const servers: FastifyInstance[] = [];

async function core(access: readonly AccessToken[]): Promise<FastifyInstance> {
  const registry = new DatapointRegistry();
  const actions = new ActionRegistry();
  const plugins = new PluginHost(registry, actions, {}, quiet, dataDir);
  hosts.push(plugins);
  await plugins.startAll(config.sources);
  const server = await buildServer({ config, registry, plugins, actions, log: quiet, access });
  servers.push(server);
  return server;
}

beforeAll(() => {
  // Ein Schlüssel aus der Umgebung des Entwicklers darf hier keine Anfrage an die Claude-API auslösen
  delete process.env['ANTHROPIC_API_KEY'];
  dataDir = mkdtempSync(join(tmpdir(), 'culinola-test-'));
  mkdirSync(join(dataDir, 'recipes', 'Kuchen'), { recursive: true });
  writeFileSync(join(dataDir, 'recipes', 'Kuchen', 'Käsekuchen.md'), '---\ntime: 90 min\n---\n# Käsekuchen\n\n![Bild](bild.png)\n');
  writeFileSync(join(dataDir, 'recipes', 'Kuchen', 'bild.png'), 'kein echtes Bild');
  writeFileSync(join(dataDir, 'geheim.png'), 'liegt außerhalb des Rezeptordners');
});

afterAll(async () => {
  for (const host of hosts) host.stopAll();
  await Promise.all(servers.map((server) => server.close()));
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Kern mit Plugins, API offen', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await core([]);
  });

  it('startet die Quellen und meldet eine, die nicht startet, ohne die anderen aufzuhalten', async () => {
    const status = (await app.inject('/api/v1/status')).json<{ sources: { id: string; state: string }[]; protected: boolean }>();
    expect(status.protected).toBe(false);
    expect(Object.fromEntries(status.sources.map((source) => [source.id, source.state]))).toEqual({ demo: 'running', timer: 'running', recipes: 'running', voice: 'running', gibtesnicht: 'failed' });
  });

  it('liefert Datenpunkte mit dem Präfix ihrer Quelle', async () => {
    const all = (await app.inject('/api/v1/datapoints')).json<Datapoint[]>();
    expect(all.some((datapoint) => datapoint.id.startsWith('demo:'))).toBe(true);
    expect(all.find((datapoint) => datapoint.id === 'timer:state')?.value).toBe('idle');
  });

  it('liefert Layout und Einstellungen der Anzeige', async () => {
    expect((await app.inject('/api/v1/layouts/main')).json()).toMatchObject({ grid: { columns: 2, rows: 1 } });
    expect((await app.inject('/api/v1/layouts/fehlt')).statusCode).toBe(404);
    expect((await app.inject('/api/v1/site')).json()).toEqual({ language: 'de', region: 'de-DE' });
  });

  it('stellt die Eieruhr über eine Aktion und zeigt den neuen Zustand', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/v1/actions/timer.start', payload: { minutes: 5 } });
    expect(started.statusCode).toBe(200);
    const all = (await app.inject('/api/v1/datapoints')).json<Datapoint[]>();
    expect(all.find((datapoint) => datapoint.id === 'timer:state')?.value).toBe('down');
    expect(all.find((datapoint) => datapoint.id === 'timer:duration')?.value).toBe(300);
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/timer.stop', payload: {} })).statusCode).toBe(200);
  });

  it('meldet falsche Eingaben als Fehler des Aufrufers', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/v1/actions/timer.start', payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(empty.json<{ error: string }>().error).toMatch(/mindestens eine Sekunde/);
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/gibt.es.nicht', payload: {} })).statusCode).toBe(404);
  });

  it('führt das Verzeichnis der Aktionen', async () => {
    const names = (await app.inject('/api/v1/actions')).json<{ name: string }[]>().map((action) => action.name);
    expect(names).toEqual(expect.arrayContaining(['timer.start', 'timer.stopwatch', 'timer.add', 'timer.stop']));
  });

  it('liest Rezepte und gibt nur Bilder aus dem Rezeptordner heraus', async () => {
    const list = (await app.inject('/api/v1/resources/recipes/list')).json<{ id: string; title: string; category?: string; image?: string }[]>();
    expect(list).toEqual([{ id: 'kuchen-kaesekuchen', title: 'Käsekuchen', category: 'Kuchen', tags: [], time: '90 min', image: 'bild.png' }]);
    expect((await app.inject('/api/v1/p/recipes/text/kuchen-kaesekuchen')).json()).toMatchObject({ title: 'Käsekuchen', markdown: '![Bild](bild.png)' });

    const image = await app.inject('/api/v1/p/recipes/file/kuchen-kaesekuchen/bild.png');
    expect([image.statusCode, image.headers['content-type']]).toEqual([200, 'image/png']);
    for (const path of ['..%2F..%2Fgeheim.png', '..%2FK%C3%A4sekuchen.md', 'fehlt.png']) {
      expect((await app.inject(`/api/v1/p/recipes/file/kuchen-kaesekuchen/${path}`)).statusCode, path).toBe(404);
    }
  });

  it('merkt sich, welches Rezept gerade gekocht wird', async () => {
    const cooking = async () => (await app.inject('/api/v1/datapoints/recipes:cooking')).json<Datapoint>().value;
    expect(await cooking()).toBe('');
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/recipes.cook', payload: { recipe: 'kuchen-kaesekuchen' } })).statusCode).toBe(200);
    expect(await cooking()).toBe('kuchen-kaesekuchen');
    const unknown = await app.inject({ method: 'POST', url: '/api/v1/actions/recipes.cook', payload: { recipe: 'gibt-es-nicht' } });
    expect([unknown.statusCode, await cooking()]).toEqual([400, 'kuchen-kaesekuchen']);
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/recipes.finish', payload: {} })).statusCode).toBe(200);
    expect(await cooking()).toBe('');
    // Der Vermerk im Rezeptordner ist kein Rezept
    expect((await app.inject('/api/v1/resources/recipes/list')).json<unknown[]>()).toHaveLength(1);
  });

  it('nimmt einen gesprochenen Satz an und sagt, wenn die Sprachsteuerung nicht eingerichtet ist', async () => {
    const say = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/p/voice/ask', payload });
    expect((await say({})).statusCode).toBe(400);
    const answer = await say({ text: 'Eieruhr auf 5 Minuten' });
    expect([answer.statusCode, answer.json<{ error: string }>().error]).toEqual([503, expect.stringMatching(/nicht eingerichtet/)]);
    expect((await app.inject('/api/v1/datapoints/voice:ready')).json<Datapoint>().value).toBe(false);
  });

  it('reicht Dateien als rohe Bytes an ein Plugin, auch über einem Megabyte', async () => {
    const upload = (bytes: number) => app.inject({ method: 'POST', url: '/api/v1/p/recipes/import?name=Rezept.pdf', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(bytes, 1) });
    // Ohne hinterlegten Schlüssel endet der Weg beim Plugin – angekommen ist die Datei trotzdem
    const arrived = await upload(3_000_000);
    expect([arrived.statusCode, arrived.json<{ error: string }>().error]).toEqual([503, expect.stringMatching(/anthropicApiKey/)]);
    expect((await upload(26_000_000)).statusCode).toBe(413);
    const nothing = await app.inject({ method: 'POST', url: '/api/v1/p/recipes/import', payload: {} });
    expect([nothing.statusCode, nothing.json<{ error: string }>().error]).toEqual([400, 'Es fehlt eine Webadresse, ein Text oder eine Datei.']);
    expect((await app.inject('/api/v1/datapoints/recipes:importReady')).json<Datapoint>().value).toBe(false);
  });
});

describe('Kern mit Zugriffsschutz', () => {
  let app: FastifyInstance;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    app = await core([
      { name: 'kueche', role: 'control', token: 'token-der-kueche-0123456789' },
      { name: 'flur', role: 'read', token: 'token-vom-flur-0123456789' },
    ]);
  });

  it('weist Aufrufe ohne oder mit falschem Token ab', async () => {
    expect((await app.inject('/api/v1/status')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/status', headers: as('falsch') })).statusCode).toBe(401);
  });

  it('lässt Lesen mit jedem gültigen Token zu, Schalten nur mit der passenden Stufe', async () => {
    expect((await app.inject({ url: '/api/v1/status', headers: as('token-vom-flur-0123456789') })).json()).toMatchObject({ protected: true });
    const stop = { method: 'POST', url: '/api/v1/actions/timer.stop', payload: {} } as const;
    expect((await app.inject({ ...stop, headers: as('token-vom-flur-0123456789') })).statusCode).toBe(403);
    expect((await app.inject({ ...stop, headers: as('token-der-kueche-0123456789') })).statusCode).toBe(200);
  });

  it('lässt neue Rezepte nur mit der Stufe zum Schalten zu', async () => {
    const add = { method: 'POST', url: '/api/v1/p/recipes/import', payload: {} } as const;
    expect((await app.inject(add)).statusCode).toBe(401);
    expect((await app.inject({ ...add, headers: as('token-vom-flur-0123456789') })).statusCode).toBe(403);
    expect((await app.inject({ ...add, headers: as('token-der-kueche-0123456789') })).statusCode).toBe(400);
  });

  it('nimmt das Token als Adresszusatz nur bei lesenden Plugin-Adressen an', async () => {
    expect((await app.inject('/api/v1/p/recipes/file/kuchen-kaesekuchen/bild.png?token=token-vom-flur-0123456789')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/status?token=token-vom-flur-0123456789')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/timer.stop?token=token-der-kueche-0123456789', payload: {} })).statusCode).toBe(401);
  });
});
