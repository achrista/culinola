import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Datapoint, Logger } from '@culinola/sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessToken } from './access.ts';
import { ActionRegistry } from './actions.ts';
import { registerBuiltinActions } from './builtin.ts';
import type { AppConfig } from './config.ts';
import { EventHub, parseEvents } from './events.ts';
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

async function core(access: readonly AccessToken[]): Promise<FastifyInstance> {
  const registry = new DatapointRegistry();
  const actions = new ActionRegistry();
  const plugins = new PluginHost(registry, actions, {}, quiet, dataDir, config.layouts);
  registerBuiltinActions(actions, registry, plugins);
  const events = new EventHub(config.events ?? {}, quiet);
  registry.on('change', (datapoint) => events.observe(datapoint));
  hosts.push(plugins);
  await plugins.startAll(config.sources);
  const server = await buildServer({ config, registry, plugins, actions, events, log: quiet, access });
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
