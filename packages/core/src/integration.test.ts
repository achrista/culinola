import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Datapoint, Logger } from '@culinola/sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessToken } from './access.ts';
import { ActionRegistry } from './actions.ts';
import { Auth, RESET_FILE } from './auth.ts';
import { registerBuiltinActions } from './builtin.ts';
import type { AppConfig } from './config.ts';
import { EventHub, parseEvents } from './events.ts';
import { JsonFile } from './jsonfile.ts';
import { LayoutStore } from './layouts.ts';
import { Pairing } from './pairing.ts';
import { PluginHost } from './plugins.ts';
import { DatapointRegistry } from './registry.ts';
import { buildServer } from './server.ts';
import { SettingsStore } from './settings.ts';
import { SourceStore } from './sources.ts';
import { parseTemplate } from './templates.ts';

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
  layouts: {
    main: {
      grid: { columns: 2, rows: 1 },
      widgets: [
        { type: 'clock', at: [0, 0, 1, 1] },
        { type: 'web', at: [1, 0, 1, 1], config: { url: 'https://seite.example/' } },
      ],
    },
  },
  site: { language: 'de', region: 'de-DE' },
  events: parseEvents({
    hausglocke: { text: 'Jemand klingelt!', sound: 'bell', video: 'kamera3' },
    eieruhr: { text: 'Die Zeit ist um.', when: { datapoint: 'timer:state', equals: 'done' } },
  }),
};

let dataDir: string;
const hosts: PluginHost[] = [];
const servers: FastifyInstance[] = [];

async function core(given: readonly AccessToken[]): Promise<FastifyInstance> {
  const access = [...given];
  const registry = new DatapointRegistry();
  const actions = new ActionRegistry();
  // Jeder Kern bekommt eigene Layouts und eine eigene Datei: Was der eine speichert, sieht der andere nicht
  const own = { ...config, layouts: structuredClone(config.layouts), sources: structuredClone(config.sources) };
  const file = new JsonFile(join(dataDir, `kern-${servers.length}`, 'config.json'));
  const layouts = new LayoutStore(own.layouts, file, own, quiet);
  const secrets: Record<string, Record<string, string>> = {};
  const plugins = new PluginHost(registry, actions, secrets, quiet, dataDir, own.layouts);
  const secretsFile = new JsonFile(join(dataDir, `kern-${servers.length}`, 'secrets.json'));
  const sources = new SourceStore({ sources: own.sources, secrets, plugins, configFile: file, secretsFile, initial: own, log: quiet });
  registerBuiltinActions(actions, registry, plugins);
  own.events = structuredClone(config.events ?? {});
  const events = new EventHub(own.events, quiet);
  registry.on('change', (datapoint) => events.observe(datapoint));
  hosts.push(plugins);
  await plugins.startAll(own.sources);
  // Zwei Adressen wie von einem Plugin angemeldet: eine, die nur liest, obwohl sie POST benutzt, und eine gewöhnliche
  plugins.routes.push({ method: 'POST', instance: 'probe', path: '/lesen', role: 'read', handler: () => Response.json({ ok: true }) });
  plugins.routes.push({ method: 'POST', instance: 'probe', path: '/schalten', handler: () => Response.json({ ok: true }) });
  const auth = new Auth({ secrets, secretsFile, access, dataDir: join(dataDir, `kern-${servers.length}`), log: quiet });
  const server = await buildServer({ config: own, registry, plugins, actions, events, layouts, sources, settings: new SettingsStore({ config: own, events, access, secrets, configFile: file, secretsFile, log: quiet, hasPassword: () => auth.hasPassword() }), auth, pairing: new Pairing(), templates: [parseTemplate('klein', { name: { de: 'Klein' }, layout: { grid: { columns: 4, rows: 2 }, widgets: [{ type: 'clock', at: [0, 0, 4, 2] }] } })], log: quiet, access });
  servers.push(server);
  return server;
}

beforeAll(() => {
  // Ein Schlüssel aus der Umgebung des Entwicklers darf hier keine Anfrage an die Claude-API auslösen
  delete process.env['ANTHROPIC_API_KEY'];
  dataDir = mkdtempSync(join(tmpdir(), 'culinola-test-'));
  mkdirSync(join(dataDir, 'recipes', 'Kuchen'), { recursive: true });
  writeFileSync(join(dataDir, 'recipes', 'Kuchen', 'Käsekuchen.md'), '---\ntime: 90 min\nservings: 12 Stücke\n---\n# Käsekuchen\n\n![Bild](bild.png)\n\n## Zutaten\n\n| Menge | Zutat |\n|-------|-------|\n| 750 g | Quark |\n| 3     | Eier (Größe M) |\n');
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

  it('speichert ein Layout über die API, schreibt es in die Datei und sagt es den Anzeigen', async () => {
    const loaded = (await app.inject('/api/v1/layouts/main')).json<{ rev: string; grid: unknown; widgets: { type: string; at: number[]; config?: unknown }[] }>();
    expect((await app.inject('/api/v1/layouts')).json()).toEqual([{ id: 'main', grid: { columns: 2, rows: 1 }, widgets: 2, rev: loaded.rev }]);
    const socket = await app.injectWS('/api/v1/stream');
    const seen: unknown[] = [];
    socket.on('message', (data: Buffer) => seen.push(JSON.parse(data.toString())));
    socket.send(JSON.stringify({ op: 'sub', topics: ['layout/main'] }));
    await new Promise((resume) => setTimeout(resume, 50));

    // Die beiden Kacheln tauschen die Plätze; die Seite der zweiten wird eine andere
    const { rev, ...layout } = loaded;
    layout.widgets = [{ ...layout.widgets[0]!, at: [1, 0, 1, 1] }, { ...layout.widgets[1]!, at: [0, 0, 1, 1], config: { url: 'https://andere.example/' } }];
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/v1/layouts/main', payload });
    const saved = await put({ layout, rev });
    expect(saved.statusCode).toBe(200);
    const next = saved.json<{ rev: string }>().rev;
    await new Promise((resume) => setTimeout(resume, 50));
    socket.terminate();

    expect((await app.inject('/api/v1/layouts/main')).json()).toEqual({ ...layout, rev: next });
    expect(seen).toEqual([{ t: 'layout/main', d: { id: 'main', rev: next } }]);
    expect(JSON.parse(readFileSync(join(dataDir, 'kern-0', 'config.json'), 'utf8')).layouts.main).toEqual(layout);
    // Was der Kern sonst aus den Layouts liest, folgt: Die neue Seite darf geprüft werden, die alte nicht mehr
    expect((await app.inject('/api/v1/embed?url=https%3A%2F%2Fseite.example%2F')).statusCode).toBe(400);

    // Auf dem alten Stand speichern: abgelehnt mit dem Stand, der jetzt gilt
    const late = await put({ layout, rev });
    expect([late.statusCode, late.json<{ rev: string }>().rev]).toEqual([409, next]);
    const overlapping = await put({ layout: { ...layout, widgets: [layout.widgets[0], layout.widgets[0]] }, rev: next });
    expect([overlapping.statusCode, overlapping.json<{ error: string }>().error]).toEqual([400, 'Kachel 2 ("clock") liegt über Kachel 1 ("clock").']);
    expect((await put({ layout })).statusCode).toBe(400);
    expect((await put({ rev: next })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/layouts/fehlt', payload: { layout, rev: next } })).statusCode).toBe(404);
  });

  it('legt Layouts an, benennt sie um und löscht sie – nur das letzte nicht', async () => {
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
    const names = async () => (await app.inject('/api/v1/layouts')).json<{ id: string }[]>().map((entry) => entry.id);
    expect((await app.inject('/api/v1/templates')).json()).toEqual([{ id: 'klein', name: { de: 'Klein' }, text: {}, grid: { columns: 4, rows: 2 }, widgets: 1 }]);

    expect((await post('/api/v1/layouts', { id: 'leer' })).statusCode).toBe(200);
    expect((await post('/api/v1/layouts', { id: 'kopie', copy: 'main' })).statusCode).toBe(200);
    expect((await post('/api/v1/layouts', { id: 'vorlage', template: 'klein' })).statusCode).toBe(200);
    expect(await names()).toEqual(['main', 'leer', 'kopie', 'vorlage']);
    expect((await app.inject('/api/v1/layouts/leer')).json()).toMatchObject({ grid: { columns: 48, rows: 24 }, widgets: [] });
    expect((await app.inject('/api/v1/layouts/kopie')).json<{ rev: string }>().rev).toBe((await app.inject('/api/v1/layouts/main')).json<{ rev: string }>().rev);
    expect((await app.inject('/api/v1/layouts/vorlage')).json()).toMatchObject({ widgets: [{ type: 'clock' }] });

    for (const [payload, status] of [[{ id: 'leer' }, 409], [{ id: 'Küche' }, 400], [{ id: '../x' }, 400], [{}, 400], [{ id: 'x', copy: 'fehlt' }, 404], [{ id: 'x', template: 'fehlt' }, 404], [{ id: 'x', layout: { grid: {} } }, 400]] as const) {
      expect((await post('/api/v1/layouts', payload)).statusCode, JSON.stringify(payload)).toBe(status);
    }

    expect((await post('/api/v1/layouts/leer/rename', { id: 'flur' })).statusCode).toBe(200);
    expect((await post('/api/v1/layouts/flur/rename', { id: 'main' })).statusCode).toBe(409);
    expect((await post('/api/v1/layouts/fehlt/rename', { id: 'x' })).statusCode).toBe(404);
    expect(await names()).toEqual(['main', 'flur', 'kopie', 'vorlage']);

    for (const id of ['flur', 'kopie', 'vorlage']) expect((await app.inject({ method: 'DELETE', url: `/api/v1/layouts/${id}` })).statusCode, id).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/layouts/flur' })).statusCode).toBe(404);
    const last = await app.inject({ method: 'DELETE', url: '/api/v1/layouts/main' });
    expect([last.statusCode, last.json<{ error: string }>().error]).toEqual([409, 'Das letzte Layout lässt sich nicht löschen.']);
    expect(Object.keys(JSON.parse(readFileSync(join(dataDir, 'kern-0', 'config.json'), 'utf8')).layouts)).toEqual(['main']);
  });

  it('richtet Quellen im Betrieb ein: anlegen, ändern, neu starten, entfernen', async () => {
    const call = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => app.inject({ method, url, ...(payload ? { payload } : {}) });
    const ids = async (prefix: string) => (await app.inject('/api/v1/datapoints')).json<Datapoint[]>().filter((datapoint) => datapoint.id.startsWith(prefix)).length;
    const onDisk = (name: string) => JSON.parse(readFileSync(join(dataDir, 'kern-0', name), 'utf8'));

    const listed = (await app.inject('/api/v1/sources')).json<{ id: string; state: string; secrets: string[]; config: unknown }[]>();
    expect(listed.map((source) => [source.id, source.state])).toEqual([['demo', 'running'], ['timer', 'running'], ['recipes', 'running'], ['voice', 'running'], ['gibtesnicht', 'failed']]);
    const installed = (await app.inject('/api/v1/plugins')).json<{ id: string }[]>().map((plugin) => plugin.id);
    expect(installed).toEqual(expect.arrayContaining(['connector-demo', 'media-radio', 'timer']));

    // Eine zweite Quelle mit Beispielwerten kommt dazu – ohne Neustart sind ihre Datenpunkte da
    const created = await call('POST', '/api/v1/sources', { id: 'zwei', plugin: 'connector-demo', secrets: { token: 'streng-geheimer-wert' } });
    expect([created.statusCode, created.json()]).toMatchObject([200, { id: 'zwei', plugin: 'connector-demo', state: 'running', config: {}, secrets: ['token'] }]);
    // Was die Quelle beim Start meldet und wie viele Werte sie liefert, steht bei ihr – so zeigt sich, ob sie ihr Gerät erreicht
    const told = created.json<{ datapoints: number; notes: { level: string; text: string }[] }>();
    expect(told.datapoints).toBeGreaterThan(5);
    expect(told.notes).toEqual([expect.objectContaining({ level: 'info', text: expect.stringMatching(/Beispielwerte laufen/) })]);
    expect(await ids('zwei:')).toBeGreaterThan(5);
    expect(onDisk('config.json').sources.at(-1)).toEqual({ id: 'zwei', plugin: 'connector-demo' });
    expect(onDisk('secrets.json')).toEqual({ zwei: { token: 'streng-geheimer-wert' } });
    // Zugangsdaten nimmt der Kern nur entgegen: Er sagt, welche hinterlegt sind, und gibt sie nie heraus
    expect((await app.inject('/api/v1/sources')).body).not.toContain('streng-geheimer-wert');

    // Zugangsdaten ändern: was genannt ist, wird gesetzt oder herausgenommen, der Rest bleibt
    const changed = await call('PUT', '/api/v1/sources/zwei', { secrets: { password: 'noch-ein-wert', token: null } });
    expect(changed.json()).toMatchObject({ state: 'running', secrets: ['password'] });
    expect(onDisk('secrets.json')).toEqual({ zwei: { password: 'noch-ein-wert' } });
    expect((await call('POST', '/api/v1/sources/zwei/restart')).json()).toMatchObject({ id: 'zwei', state: 'running' });
    expect(await ids('zwei:')).toBeGreaterThan(5);

    // Entfernen nimmt Datenpunkte, Eintrag und Zugangsdaten mit
    expect((await call('DELETE', '/api/v1/sources/zwei')).statusCode).toBe(200);
    expect(await ids('zwei:')).toBe(0);
    expect((await app.inject('/api/v1/status')).json<{ sources: { id: string }[] }>().sources.some((source) => source.id === 'zwei')).toBe(false);
    expect(onDisk('config.json').sources.some((source: { id: string }) => source.id === 'zwei')).toBe(false);
    expect(onDisk('secrets.json')).toEqual({});
  });

  it('lässt eine Quelle, die nicht startet, nichts halb Angemeldetes zurück und weist Unpassendes ab', async () => {
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/sources', payload });
    // Eine zweite Eieruhr will dieselben Aktionen anmelden: Sie startet nicht – die erste läuft unberührt weiter
    const second = (await post({ id: 'kurzzeit', plugin: 'timer' })).json<{ state: string; error: string }>();
    expect([second.state, second.error]).toEqual(['failed', expect.stringMatching(/schon angemeldet/)]);
    expect((second as unknown as { datapoints: number; notes: { level: string }[] }).datapoints).toBe(0);
    expect((second as unknown as { notes: { level: string; text: string }[] }).notes.slice(-2)).toMatchObject([{ level: 'error' }, { level: 'info', text: 'Neuer Versuch in 10 s.' }]);
    expect((await app.inject('/api/v1/datapoints')).json<Datapoint[]>().some((datapoint) => datapoint.id.startsWith('kurzzeit:'))).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/timer.stop', payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/sources/kurzzeit' })).statusCode).toBe(200);

    for (const [payload, status] of [
      [{ id: 'demo', plugin: 'connector-demo' }, 409],
      [{ id: 'Neu', plugin: 'connector-demo' }, 400],
      [{ id: 'api', plugin: 'connector-demo' }, 400],
      [{ id: 'neu' }, 400],
      [{ id: 'neu', plugin: 'gibt-es-nicht' }, 400],
      [{ id: 'neu', plugin: '../../../boese' }, 400],
      [{ id: 'neu', plugin: 'connector-demo', config: 'kein Objekt' }, 400],
      [{ id: 'neu', plugin: 'connector-demo', secrets: { token: 7 } }, 400],
      [{ id: 'neu', plugin: 'connector-openhab', config: {} }, 400],
    ] as const) {
      expect((await post(payload)).statusCode, JSON.stringify(payload)).toBe(status);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/v1/sources/fehlt', payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/sources/fehlt/restart' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/sources/fehlt' })).statusCode).toBe(404);
    expect((await app.inject('/api/v1/sources')).json<unknown[]>()).toHaveLength(5);
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

  it('fährt eine Markise und weist ab, was sich nicht fahren lässt', async () => {
    const move = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/actions/cover.move', payload });
    expect((await move({ datapoint: 'demo:markise', direction: 'down' })).statusCode).toBe(200);
    await new Promise((resume) => setTimeout(resume, 700));
    const position = (await app.inject('/api/v1/datapoints/demo:markise')).json<Datapoint>().value as number;
    expect(position).toBeGreaterThan(0);
    expect((await move({ datapoint: 'demo:markise', direction: 'stop' })).statusCode).toBe(200);
    for (const payload of [{ datapoint: 'demo:markise', direction: 'seitwärts' }, { datapoint: 'demo:temp_bad', direction: 'up' }, { datapoint: 'demo:gibt-es-nicht', direction: 'up' }, { datapoint: 'demo:markise' }]) {
      expect((await move(payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('führt das Verzeichnis der Aktionen', async () => {
    const names = (await app.inject('/api/v1/actions')).json<{ name: string }[]>().map((action) => action.name);
    expect(names).toEqual(expect.arrayContaining(['timer.start', 'timer.stopwatch', 'timer.add', 'timer.stop']));
  });

  it('liest Rezepte und gibt nur Bilder aus dem Rezeptordner heraus', async () => {
    const list = (await app.inject('/api/v1/resources/recipes/list')).json<{ id: string; title: string; category?: string; image?: string }[]>();
    expect(list).toEqual([{ id: 'kuchen-kaesekuchen', title: 'Käsekuchen', category: 'Kuchen', tags: [], time: '90 min', servings: '12 Stücke', image: 'bild.png' }]);
    expect((await app.inject('/api/v1/p/recipes/text/kuchen-kaesekuchen')).json()).toMatchObject({ title: 'Käsekuchen', markdown: expect.stringMatching(/^!\[Bild\]\(bild\.png\)\n\n## Zutaten/) });

    const image = await app.inject('/api/v1/p/recipes/file/kuchen-kaesekuchen/bild.png');
    expect([image.statusCode, image.headers['content-type']]).toEqual([200, 'image/png']);
    for (const path of ['..%2F..%2Fgeheim.png', '..%2FK%C3%A4sekuchen.md', 'fehlt.png']) {
      expect((await app.inject(`/api/v1/p/recipes/file/kuchen-kaesekuchen/${path}`)).statusCode, path).toBe(404);
    }
  });

  it('zeigt die Zutaten für die Einkaufsliste und sagt, wenn keine Liste eingerichtet ist', async () => {
    const shown = (await app.inject('/api/v1/p/recipes/shopping/kuchen-kaesekuchen?amount=24')).json<{ ready: boolean; base: number; amount: number; unit: string; items: { name: string; amount: string; note: string | null }[] }>();
    // Ohne ein Plugin, das Listen führt, wird das Einkaufen nicht angeboten
    expect(shown).toMatchObject({ ready: false, base: 12, amount: 24, unit: 'Stücke' });
    expect(shown.items.map((item) => [item.amount, item.name, item.note])).toEqual([
      ['1500 g', 'Quark', null],
      ['6', 'Eier', 'Größe M'],
    ]);
    const refused = await app.inject({ method: 'POST', url: '/api/v1/p/recipes/shopping/kuchen-kaesekuchen', payload: { names: ['Quark'] } });
    expect([refused.statusCode, refused.json<{ error: string }>().error]).toEqual([400, 'Es ist keine Einkaufsliste eingerichtet.']);
    const spoken = await app.inject({ method: 'POST', url: '/api/v1/actions/recipes.shop', payload: { recipe: 'Käsekuchen' } });
    expect(spoken.statusCode).toBe(400);
    expect((await app.inject('/api/v1/p/recipes/shopping/gibt-es-nicht')).statusCode).toBe(404);
  });

  it('prüft das Einbetten nur für Seiten, die in einer Kachel stehen', async () => {
    // Der Kern ruft keine Adressen ab, die ihm ein Aufrufer nennt
    for (const url of ['https://fremd.example/', 'http://169.254.169.254/latest/', '']) {
      const refused = await app.inject(`/api/v1/embed?url=${encodeURIComponent(url)}`);
      expect([refused.statusCode, refused.json<{ error: string }>().error], url).toEqual([400, 'Diese Adresse steht in keiner Kachel "web".']);
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

  it('löst Meldungen über die API aus und schickt sie den Anzeigen über den Echtzeitkanal', async () => {
    expect((await app.inject('/api/v1/events')).json()).toEqual([
      { name: 'hausglocke', text: 'Jemand klingelt!' },
      { name: 'eieruhr', text: 'Die Zeit ist um.', trigger: 'timer:state' },
    ]);
    const socket = await app.injectWS('/api/v1/stream');
    const seen: { t: string; d: { name: string; text: string; seconds: number; video?: unknown } }[] = [];
    socket.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as (typeof seen)[number];
      if (message.t.startsWith('event/')) seen.push(message);
    });
    socket.send(JSON.stringify({ op: 'sub', topics: ['event/*'] }));
    await new Promise((resume) => setTimeout(resume, 50));

    expect((await app.inject({ method: 'POST', url: '/api/v1/events/hausglocke' })).json()).toMatchObject({ ok: true });
    expect((await app.inject({ method: 'POST', url: '/api/v1/events/hausglocke', payload: { text: 'Paket an der Tür' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/events/gibt-es-nicht' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/events/hausglocke', payload: { text: 7 } })).statusCode).toBe(400);

    // Eine Meldung, die an einem Datenpunkt hängt: Die Eieruhr läuft ab
    await app.inject({ method: 'POST', url: '/api/v1/actions/timer.start', payload: { seconds: 1 } });
    await new Promise((resume) => setTimeout(resume, 1300));
    await app.inject({ method: 'POST', url: '/api/v1/actions/timer.stop', payload: {} });
    socket.terminate();

    expect(seen.map((message) => [message.t, message.d.text])).toEqual([
      ['event/hausglocke', 'Jemand klingelt!'],
      ['event/hausglocke', 'Paket an der Tür'],
      ['event/eieruhr', 'Die Zeit ist um.'],
    ]);
    expect(seen[0]!.d).toMatchObject({ seconds: 90, video: { source: 'video', stream: 'kamera3' } });
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
      { name: 'buero', role: 'admin', token: 'token-vom-buero-0123456789' },
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

  it('lässt eine als lesend angemeldete Adresse auch mit POST für den Lesezugang zu', async () => {
    const post = (path: string, token?: string) => app.inject({ method: 'POST', url: `/api/v1/p/probe/${path}`, payload: {}, ...(token ? { headers: as(token) } : {}) });
    expect((await post('lesen', 'token-vom-flur-0123456789')).statusCode).toBe(200);
    expect((await post('schalten', 'token-vom-flur-0123456789')).statusCode).toBe(403);
    expect((await post('schalten', 'token-der-kueche-0123456789')).statusCode).toBe(200);
    // Ohne Token bleibt auch Lesen verschlossen
    expect((await post('lesen')).statusCode).toBe(401);
  });

  it('lässt Layouts nur mit der Stufe zum Einrichten speichern', async () => {
    const layout = (await app.inject({ url: '/api/v1/layouts/main', headers: as('token-vom-flur-0123456789') })).json<{ rev: string }>();
    const put = (token?: string) => app.inject({ method: 'PUT', url: '/api/v1/layouts/main', payload: { layout: { grid: { columns: 2, rows: 1 }, widgets: [] }, rev: layout.rev }, ...(token ? { headers: as(token) } : {}) });
    expect((await put()).statusCode).toBe(401);
    expect((await put('token-vom-flur-0123456789')).statusCode).toBe(403);
    const refused = await put('token-der-kueche-0123456789');
    expect([refused.statusCode, refused.json<{ error: string }>().error]).toEqual([403, 'Das Token "kueche" darf nur bedienen.']);
    expect((await put('token-vom-buero-0123456789')).statusCode).toBe(200);
    // Anlegen, Umbenennen und Löschen sind ebenfalls Einrichten
    for (const call of [{ method: 'POST', url: '/api/v1/layouts', payload: { id: 'neu' } }, { method: 'POST', url: '/api/v1/layouts/main/rename', payload: { id: 'neu' } }, { method: 'DELETE', url: '/api/v1/layouts/main' }] as const) {
      expect((await app.inject({ ...call, headers: as('token-der-kueche-0123456789') })).statusCode, call.url).toBe(403);
    }
    // Quellen: schon das Lesen der Einstellungen braucht die Stufe zum Einrichten
    for (const call of [{ method: 'GET', url: '/api/v1/sources' }, { method: 'GET', url: '/api/v1/plugins' }, { method: 'POST', url: '/api/v1/sources/demo/restart' }, { method: 'DELETE', url: '/api/v1/sources/demo' }] as const) {
      expect((await app.inject({ ...call, headers: as('token-der-kueche-0123456789') })).statusCode, call.url).toBe(403);
    }
    expect((await app.inject({ url: '/api/v1/sources', headers: as('token-vom-buero-0123456789') })).statusCode).toBe(200);
    // Einstellungen: lesen und ändern nur mit der Stufe zum Einrichten
    for (const call of [{ method: 'GET', url: '/api/v1/settings' }, { method: 'PUT', url: '/api/v1/settings/site', payload: {} }, { method: 'POST', url: '/api/v1/settings/access', payload: { name: 'neu', role: 'admin' } }] as const) {
      expect((await app.inject({ ...call, headers: as('token-der-kueche-0123456789') })).statusCode, call.url).toBe(403);
    }
    // Die Oberfläche fragt vorab, was ihr Zugang darf
    expect((await app.inject({ url: '/api/v1/access', headers: as('token-der-kueche-0123456789') })).json()).toEqual({ name: 'kueche', role: 'control' });
    expect((await app.inject({ url: '/api/v1/access', headers: as('token-vom-buero-0123456789') })).json()).toEqual({ name: 'buero', role: 'admin' });
  });

  it('lässt Meldungen nur mit der Stufe zum Schalten auslösen', async () => {
    const ring = { method: 'POST', url: '/api/v1/events/hausglocke' } as const;
    expect((await app.inject(ring)).statusCode).toBe(401);
    expect((await app.inject({ ...ring, headers: as('token-vom-flur-0123456789') })).statusCode).toBe(403);
    expect((await app.inject({ ...ring, headers: as('token-der-kueche-0123456789') })).statusCode).toBe(200);
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

describe('Einstellungen im Betrieb', () => {
  let app: FastifyInstance;
  let index: number;
  const onDisk = (name: string) => JSON.parse(readFileSync(join(dataDir, `kern-${index}`, name), 'utf8'));
  beforeAll(async () => {
    index = servers.length;
    app = await core([]);
    // Der Echtzeitkanal lässt sich im Test erst öffnen, wenn der Server bereit ist
    await app.ready();
  });

  it('ändert Sprache und Farbschema und sagt es den offenen Anzeigen', async () => {
    const socket = await app.injectWS('/api/v1/stream');
    const seen: unknown[] = [];
    socket.on('message', (data: Buffer) => seen.push(JSON.parse(data.toString())));
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/v1/settings/site', payload: payload as object });

    const site = { language: 'en', region: 'en-GB', theme: 'glut', nightTheme: 'nacht', eigenes: 'bleibt' };
    expect((await put({ ...site, astro: '' })).json()).toEqual(site);
    await new Promise((resume) => setTimeout(resume, 50));
    socket.terminate();

    expect((await app.inject('/api/v1/site')).json()).toEqual(site);
    expect(onDisk('config.json').site).toEqual(site);
    expect(seen).toEqual([{ t: 'site', d: site }]);
    for (const wrong of [{ language: 'deutsch!' }, { region: 'kein land' }, { theme: 'Glut 2' }, { nightTheme: 7 }, [1]]) expect((await put(wrong)).statusCode, JSON.stringify(wrong)).toBe(400);
    expect((await app.inject('/api/v1/site')).json()).toEqual(site);
  });

  it('ändert die Meldungen: Neue lassen sich sofort auslösen, entfernte nicht mehr', async () => {
    const events = { paket: { text: 'Ein Paket ist da.', sound: 'bell' }, warm: { text: 'Es ist warm.', when: { datapoint: 'demo:temp_aussen', above: 30 } } };
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings/events', payload: events })).statusCode).toBe(200);
    expect((await app.inject('/api/v1/events')).json()).toEqual([{ name: 'paket', text: 'Ein Paket ist da.' }, { name: 'warm', text: 'Es ist warm.', trigger: 'demo:temp_aussen' }]);
    expect((await app.inject({ method: 'POST', url: '/api/v1/events/paket' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/events/hausglocke' })).statusCode).toBe(404);
    expect(onDisk('config.json').events).toEqual(events);
    expect((await app.inject('/api/v1/settings')).json<{ events: unknown }>().events).toEqual(events);

    const wrong = await app.inject({ method: 'PUT', url: '/api/v1/settings/events', payload: { paket: { sound: 'bell' } } });
    expect([wrong.statusCode, wrong.json<{ error: string }>().error]).toEqual([400, 'Meldung "paket": "text" fehlt.']);
    expect(onDisk('config.json').events).toEqual(events);
  });

  it('richtet Zugänge ein: Das Token kommt einmal, gilt sofort, und einer muss einrichten dürfen', async () => {
    const as = (token: string) => ({ authorization: `Bearer ${token}` });
    const add = (payload: object, token?: string) => app.inject({ method: 'POST', url: '/api/v1/settings/access', payload, ...(token ? { headers: as(token) } : {}) });

    // Der erste Zugang schließt die bis dahin offene API – also muss er einrichten dürfen
    const first = await add({ name: 'kueche', role: 'control' });
    expect([first.statusCode, first.json<{ error: string }>().error]).toEqual([409, expect.stringMatching(/muss ein Zugang die Stufe „admin“ haben/)]);
    for (const wrong of [{ name: 'büro', role: 'admin' }, { name: 'buero', role: 'chef' }, { role: 'admin' }]) expect((await add(wrong)).statusCode, JSON.stringify(wrong)).toBe(400);

    const admin = (await add({ name: 'buero', role: 'admin' })).json<{ name: string; role: string; token: string }>();
    expect(admin).toMatchObject({ name: 'buero', role: 'admin' });
    expect(admin.token.length).toBeGreaterThanOrEqual(40);
    // Ab jetzt ist die API geschützt – ohne Neustart
    expect((await app.inject('/api/v1/status')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/status', headers: as(admin.token) })).json()).toMatchObject({ protected: true });
    expect(onDisk('config.json').access).toEqual({ tokens: [{ name: 'buero', role: 'admin' }] });
    expect(onDisk('secrets.json').api).toEqual({ buero: admin.token });

    const kitchen = (await add({ name: 'kueche', role: 'control' }, admin.token)).json<{ token: string }>();
    expect((await add({ name: 'kueche', role: 'read' }, admin.token)).statusCode).toBe(409);
    // Die Liste nennt Namen und Stufen, nie die Tokens
    const listed = await app.inject({ url: '/api/v1/settings', headers: as(admin.token) });
    expect(listed.json<{ access: unknown }>().access).toEqual([{ name: 'buero', role: 'admin' }, { name: 'kueche', role: 'control' }]);
    expect(listed.body).not.toContain(admin.token);
    expect(listed.body).not.toContain(kitchen.token);

    // Der letzte, der einrichten darf, lässt sich weder herabstufen noch entfernen, solange es andere gibt
    const change = (method: 'PUT' | 'DELETE', name: string, payload?: object) => app.inject({ method, url: `/api/v1/settings/access/${name}`, headers: as(admin.token), ...(payload ? { payload } : {}) });
    expect((await change('PUT', 'buero', { role: 'read' })).statusCode).toBe(409);
    expect((await change('DELETE', 'buero')).statusCode).toBe(409);
    expect((await change('DELETE', 'fehlt')).statusCode).toBe(404);
    expect((await change('PUT', 'kueche', { role: 'read' })).json()).toEqual({ name: 'kueche', role: 'read' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/actions/timer.stop', payload: {}, headers: as(kitchen.token) })).statusCode).toBe(403);

    // Ohne Zugänge ist die API wieder offen
    expect((await change('DELETE', 'kueche')).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/status', headers: as(kitchen.token) })).statusCode).toBe(401);
    expect((await change('DELETE', 'buero')).statusCode).toBe(200);
    expect((await app.inject('/api/v1/status')).json()).toMatchObject({ protected: false });
    expect(onDisk('config.json').access).toBeUndefined();
    expect(onDisk('secrets.json').api).toBeUndefined();
  });
});

describe('Einrichtungskennwort, Koppeln und Zurücksetzen', () => {
  let app: FastifyInstance;
  let index: number;
  const onDisk = (name: string) => JSON.parse(readFileSync(join(dataDir, `kern-${index}`, name), 'utf8'));
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, token?: string) => app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}), ...(token ? { headers: as(token) } : {}) });
  let session = '';
  beforeAll(async () => {
    index = servers.length;
    app = await core([]);
  });

  it('schützt die offene API mit einem Kennwort und meldet damit an', async () => {
    expect((await call('GET', '/setup')).json()).toEqual({ protected: false, password: false, pairing: true });
    expect((await call('PUT', '/settings/password', { password: 'kurz' })).statusCode).toBe(400);
    const set = await call('PUT', '/settings/password', { password: 'Küchenschlüssel 7' });
    expect(set.statusCode).toBe(200);
    session = set.json<{ token: string }>().token;

    // Ab jetzt braucht alles einen Zugang – nur was vor dem Zugang liegt, bleibt offen
    expect((await call('GET', '/status')).statusCode).toBe(401);
    expect((await call('GET', '/site')).statusCode).toBe(200);
    expect((await call('GET', '/setup')).json()).toEqual({ protected: true, password: true, pairing: true });
    expect((await call('GET', '/access', undefined, session)).json()).toEqual({ name: 'kennwort', role: 'admin' });
    expect((await call('GET', '/settings', undefined, session)).json()).toMatchObject({ password: true, access: [] });
    // In der Datei steht ein Prüfwert, das Kennwort nirgends
    expect(onDisk('secrets.json').setup.password).toMatch(/^scrypt\$/);
    expect(readFileSync(join(dataDir, `kern-${index}`, 'secrets.json'), 'utf8')).not.toContain('Küchenschlüssel');

    const wrong = await call('POST', '/login', { password: 'falsch geraten' });
    expect([wrong.statusCode, wrong.json<{ error: string }>().error]).toEqual([401, 'Das Kennwort stimmt nicht.']);
    const login = await call('POST', '/login', { password: 'Küchenschlüssel 7' });
    expect(login.json<{ token: string; expires: string }>()).toMatchObject({ token: expect.stringMatching(/^cs1\./), expires: expect.any(String) });
    // Mit Kennwort braucht kein Zugang mehr die Stufe zum Einrichten
    expect((await call('POST', '/settings/access', { name: 'openhab', role: 'control' }, session)).statusCode).toBe(200);
    // … aber das Kennwort lässt sich dann nicht entfernen: Sonst könnte niemand mehr einrichten
    expect((await call('DELETE', '/settings/password', undefined, session)).statusCode).toBe(409);
  });

  it('koppelt eine Anzeige: Sie zeigt einen Code, bekommt nach der Bestätigung ihr Token und sonst niemand', async () => {
    // Die Anzeige hat keinen Zugang und bittet um einen
    const asked = (await call('POST', '/pairing', { label: 'Chromium · haus' })).json<{ id: string; code: string; secret: string }>();
    expect(asked.code).toMatch(/^\d{6}$/);
    expect((await call('POST', `/pairing/${asked.id}`, { secret: asked.secret })).json()).toMatchObject({ state: 'waiting', code: asked.code });

    // Bestätigen darf nur, wer einrichten darf
    expect((await call('GET', '/settings/pairing')).statusCode).toBe(401);
    expect((await call('POST', `/settings/pairing/${asked.id}`, { name: 'flur', role: 'read' })).statusCode).toBe(401);
    const listed = (await call('GET', '/settings/pairing', undefined, session)).json<{ id: string; code: string; label: string }[]>();
    expect(listed).toMatchObject([{ id: asked.id, code: asked.code, label: 'Chromium · haus' }]);
    expect(JSON.stringify(listed)).not.toContain(asked.secret);

    // Ein unbrauchbarer oder vergebener Name lässt die Anfrage stehen
    expect((await call('POST', `/settings/pairing/${asked.id}`, { name: 'flur!', role: 'read' }, session)).statusCode).toBe(400);
    expect((await call('POST', `/settings/pairing/${asked.id}`, { name: 'openhab', role: 'read' }, session)).statusCode).toBe(409);
    const approved = await call('POST', `/settings/pairing/${asked.id}`, { name: 'flur', role: 'read' }, session);
    // Wer bestätigt, bekommt das Token nicht zu sehen
    expect(approved.json()).toEqual({ name: 'flur', role: 'read' });
    expect((await call('GET', '/settings/pairing', undefined, session)).json()).toEqual([]);

    expect((await call('POST', `/pairing/${asked.id}`, { secret: 'geraten' })).json()).toEqual({ state: 'expired' });
    const granted = (await call('POST', `/pairing/${asked.id}`, { secret: asked.secret })).json<{ state: string; name: string; role: string; token: string }>();
    expect(granted).toMatchObject({ state: 'approved', name: 'flur', role: 'read' });
    expect((await call('GET', '/access', undefined, granted.token)).json()).toEqual({ name: 'flur', role: 'read' });
    expect((await call('POST', '/actions/timer.stop', {}, granted.token)).statusCode).toBe(403);
    // Abgeholt ist abgeholt
    expect((await call('POST', `/pairing/${asked.id}`, { secret: asked.secret })).json()).toEqual({ state: 'expired' });
    expect(onDisk('config.json').access.tokens).toEqual([{ name: 'openhab', role: 'control' }, { name: 'flur', role: 'read' }]);

    // Ablehnen geht auch
    const guest = (await call('POST', '/pairing', { label: 'Gast' })).json<{ id: string; secret: string }>();
    expect((await call('DELETE', `/settings/pairing/${guest.id}`, undefined, session)).statusCode).toBe(200);
    expect((await call('POST', `/pairing/${guest.id}`, { secret: guest.secret })).json()).toEqual({ state: 'rejected' });
    expect((await call('DELETE', `/settings/pairing/${guest.id}`, undefined, session)).statusCode).toBe(404);
  });

  it('legt mit dem Einrichtungscode aus dem Datenordner ein neues Kennwort fest', async () => {
    expect((await call('POST', '/reset/password', { code: '1234-5678', password: 'Neues Kennwort 1' })).statusCode).toBe(401);
    // Anfordern darf jeder – den Code liest nur, wer an den Datenordner kommt
    expect((await call('POST', '/reset')).json()).toEqual({ file: RESET_FILE, minutes: 15 });
    const code = /(\d{4}-\d{4})/.exec(readFileSync(join(dataDir, `kern-${index}`, RESET_FILE), 'utf8'))![1]!;
    expect((await call('POST', '/reset/password', { code: '0000-0000', password: 'Neues Kennwort 1' })).statusCode).toBe(401);
    expect((await call('POST', '/reset/password', { code, password: 'kurz' })).statusCode).toBe(400);
    const reset = await call('POST', '/reset/password', { code, password: 'Neues Kennwort 1' });
    expect(reset.statusCode).toBe(200);
    // Die alte Anmeldung endet, die neue gilt; die Zugänge der Geräte bleiben
    expect((await call('GET', '/access', undefined, session)).statusCode).toBe(401);
    session = reset.json<{ token: string }>().token;
    expect((await call('GET', '/access', undefined, session)).json()).toEqual({ name: 'kennwort', role: 'admin' });
    expect((await call('POST', '/login', { password: 'Küchenschlüssel 7' })).statusCode).toBe(401);
    expect((await call('GET', '/settings', undefined, session)).json<{ access: unknown[] }>().access).toHaveLength(2);
    expect((await call('POST', '/reset/password', { code, password: 'Noch ein Kennwort' })).statusCode).toBe(401);
  });

  it('bremst das Raten des Kennworts', async () => {
    // Ein Fehlversuch steht aus dem vorigen Fall schon zu Buche; nach dem fünften ist Schluss
    for (let attempt = 0; attempt < 4; attempt++) expect((await call('POST', '/login', { password: `geraten ${attempt}` })).statusCode).toBe(401);
    const blocked = await call('POST', '/login', { password: 'Neues Kennwort 1' });
    expect([blocked.statusCode, blocked.headers['retry-after'], blocked.json<{ retryAfter: number }>().retryAfter]).toEqual([429, '30', 30]);
  });

  it('öffnet die API wieder, wenn Kennwort und Zugänge entfernt sind', async () => {
    for (const name of ['openhab', 'flur']) expect((await call('DELETE', `/settings/access/${name}`, undefined, session)).statusCode).toBe(200);
    expect((await call('DELETE', '/settings/password', undefined, session)).json()).toEqual({ ok: true, protected: false });
    expect((await call('GET', '/status')).json()).toMatchObject({ protected: false });
    expect(onDisk('secrets.json').setup).toBeUndefined();
  });
});
