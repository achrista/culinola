import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidInput, type ActionHandler, type PluginContext } from '@culinola/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import plugin from './index.ts';
import type { Entry } from './merkio.ts';
import { startStandIn, type StandIn } from './standin.ts';

interface Shown {
  id: string;
  name: string;
  group: string;
  type: string;
  items: Entry[];
}

let dir: string;
let merkio: StandIn;
const running: AbortController[] = [];

/** Startet das Plugin gegen den Platzhalter und gibt Einblick in das, was es dem Kern meldet. */
function start(name: string, config: Record<string, unknown> = {}, secrets?: Record<string, string>) {
  const stop = new AbortController();
  running.push(stop);
  const datapoints = new Map<string, unknown>();
  const resources = new Map<string, unknown>();
  const actions = new Map<string, ActionHandler>();
  const warnings: string[] = [];
  const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
    instanceId: 'merkio',
    config: plugin.parseConfig!({ url: merkio.url, ...config }),
    log: { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined },
    secrets: { get: (key) => (secrets ?? merkio.account)[key as 'email' | 'password'] },
    storageDir: join(dir, name),
    datapoints: { set: (update) => void datapoints.set(update.id, update.value) },
    actions: { register: (definition, handler) => void actions.set(definition.name, handler) },
    resources: { set: (key, value) => void resources.set(key, value) },
    routes: { get: () => undefined, post: () => undefined },
    onCommand: () => undefined,
    provideHistory: () => undefined,
    signal: stop.signal,
  };
  void plugin.start!(context);
  const lists = () => resources.get('lists') as Shown[];
  const names = (list = 'einkauf') => (lists().find((entry) => entry.id === list)?.items ?? []).map((entry) => `${entry.checked ? '✓' : ''}${entry.name}`);
  return { lists, names, datapoints, resources, warnings, stop, run: (action: string, params: Record<string, string | number | boolean>) => actions.get(action)!(params), storageDir: context.storageDir };
}

/** Wartet, bis eine Bedingung gilt – der Abgleich mit Merkio läuft im Hintergrund. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    if (condition()) return;
    await new Promise((resume) => setTimeout(resume, 15));
  }
  throw new Error(`Nicht eingetreten: ${what}`);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'culinola-merkio-'));
});
afterEach(async () => {
  for (const stop of running.splice(0)) stop.abort();
  await merkio?.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Listen aus Merkio', () => {
  it('zeigt ohne weitere Angabe die Einkaufslisten des Kontos', async () => {
    merkio = await startStandIn();
    const shown = start('alle');
    await until(() => shown.datapoints.get('state') === 'ok', 'Anmeldung');
    expect(shown.lists().map((list) => [list.id, list.name, list.group, list.type])).toEqual([
      ['einkauf', 'Einkauf', 'Familie', 'shopping'],
      ['baumarkt', 'Baumarkt', 'Familie', 'shopping'],
    ]);
    expect(shown.names()).toEqual(['Milch', 'Butter', 'Eier', 'Tomaten', 'Brot', '✓Kaffee']);
    expect(shown.lists()[0]!.items[0]).toMatchObject({ name: 'Milch', amount: '2 l', checked: false });
    expect(shown.datapoints.get('open')).toBe(6);
    expect((shown.resources.get('available') as { name: string }[]).map((list) => list.name)).toEqual(['Einkauf', 'Aufgaben', 'Baumarkt']);
    // Das Erneuerungstoken liegt für den nächsten Start bereit – das Kennwort steht nicht darin
    const saved = readFileSync(join(shown.storageDir, 'token.json'), 'utf8');
    expect(JSON.parse(saved)).toMatchObject({ email: merkio.account.email, refreshToken: expect.stringMatching(/^erneuerung-/) });
    expect(saved).not.toContain(merkio.account.password);
  });

  it('zeigt die in der Konfiguration genannten Listen und meldet fehlende', async () => {
    merkio = await startStandIn();
    const shown = start('gewaehlt', { lists: ['Aufgaben', { name: 'Einkauf', group: 'Familie' }, 'Urlaub'] });
    await until(() => shown.datapoints.get('state') === 'ok', 'Anmeldung');
    expect(shown.lists().map((list) => list.id)).toEqual(['aufgaben', 'einkauf']);
    expect(shown.warnings.join('\n')).toMatch(/Nicht gefunden: "Urlaub"\. Vorhanden sind: Einkauf \(Familie, shopping\)/);
  });

  it('übernimmt sofort, was am Telefon geändert wird', async () => {
    merkio = await startStandIn();
    const shown = start('echtzeit');
    await until(() => shown.names().length === 6, 'erster Abruf');
    await until(() => (merkio.calls.get('GET /lists/:id/events') ?? 0) >= 2, 'Echtzeitkanäle offen');
    merkio.change('item_created', { id: 900, listId: 11, name: 'Zimt', checked: 0, position: 99 });
    await until(() => shown.names().includes('Zimt'), 'neuer Eintrag');
    merkio.change('item_updated', { ...merkio.items.find((item) => item.name === 'Butter')!, checked: 1, checkedAt: new Date().toISOString() });
    await until(() => shown.names()[5] === '✓Butter', 'abgehakt');
    merkio.change('item_deleted', merkio.items.find((item) => item.name === 'Brot')!);
    await until(() => !shown.names().includes('Brot'), 'gelöscht');
    expect(shown.datapoints.get('open')).toBe(5);
  });

  it('hakt ab, nimmt den Haken weg und trägt ein', async () => {
    merkio = await startStandIn();
    const shown = start('aktionen');
    await until(() => shown.names().length === 6, 'erster Abruf');
    const id = (name: string) => shown.lists()[0]!.items.find((entry) => entry.name === name)!.id;

    expect(await shown.run('lists.check', { item: id('Milch') })).toEqual({ list: 'einkauf', item: id('Milch'), checked: true });
    expect(shown.names()).toEqual(['Butter', 'Eier', 'Tomaten', 'Brot', '✓Milch', '✓Kaffee']);
    await shown.run('lists.check', { item: id('Milch'), checked: false });
    expect(shown.names()).toEqual(['Butter', 'Eier', 'Tomaten', 'Brot', 'Milch', '✓Kaffee']);

    expect(await shown.run('lists.add', { text: '2 kg Mehl' })).toMatchObject({ list: 'einkauf', added: true });
    expect(merkio.items.at(-1)).toMatchObject({ listId: 11, name: 'Mehl', quantity: '2', unit: 'kg' });
    await shown.run('lists.add', { text: 'Dübel 8 mm', list: 'Baumarkt' });
    expect(shown.names('baumarkt')).toEqual(['Dübel 8 mm']);
    await shown.run('lists.add', { text: 'Schrauben', list: 'baumarkt' });
    expect(shown.names('baumarkt')).toEqual(['Dübel 8 mm', 'Schrauben']);

    // Was abgehakt auf der Liste steht, kommt zurück; was offen dort steht, bleibt einmal
    const before = merkio.items.length;
    expect(await shown.run('lists.add', { text: '500 g kaffee' })).toMatchObject({ added: true });
    expect(await shown.run('lists.add', { text: 'BUTTER' })).toMatchObject({ added: false });
    expect(merkio.items).toHaveLength(before);
    expect(merkio.items.find((item) => item.name === 'Kaffee')).toMatchObject({ checked: 0, quantity: '500', unit: 'g' });
    expect(shown.names().filter((name) => /kaffee|butter/i.test(name))).toEqual(['Butter', 'Kaffee']);
  });

  it('weist unbrauchbare Eingaben als Fehler des Aufrufers zurück', async () => {
    merkio = await startStandIn();
    const shown = start('eingaben');
    await until(() => shown.names().length === 6, 'erster Abruf');
    await expect(shown.run('lists.check', { item: 12345 })).rejects.toBeInstanceOf(InvalidInput);
    // Einträge fremder Listen sind tabu, auch wenn ihre Nummer stimmt
    await expect(shown.run('lists.check', { item: merkio.items.find((item) => item.listId === 21)!.id })).rejects.toBeInstanceOf(InvalidInput);
    await expect(shown.run('lists.add', { text: '   ' })).rejects.toBeInstanceOf(InvalidInput);
    await expect(shown.run('lists.add', { text: 'Milch', list: 'Urlaub' })).rejects.toBeInstanceOf(InvalidInput);
    expect(merkio.calls.get('POST /lists/:id/items')).toBeUndefined();
  });
});

describe('Anmeldung bei Merkio', () => {
  it('erneuert ein abgelaufenes Zugangstoken, ohne sich neu anzumelden', async () => {
    merkio = await startStandIn();
    const shown = start('erneuern');
    await until(() => shown.names().length === 6, 'erster Abruf');
    merkio.expireAccess();
    await shown.run('lists.add', { text: 'Salz' });
    expect(shown.names()).toContain('Salz');
    expect([merkio.calls.get('POST /auth/login'), merkio.calls.get('POST /auth/refresh')]).toEqual([1, 1]);
  });

  it('meldet sich mit dem Kennwort neu an, wenn auch die Erneuerung abgelaufen ist', async () => {
    merkio = await startStandIn();
    const shown = start('neu-anmelden');
    await until(() => shown.names().length === 6, 'erster Abruf');
    merkio.expireAccess();
    merkio.expireRefresh();
    await shown.run('lists.add', { text: 'Pfeffer' });
    expect(merkio.calls.get('POST /auth/login')).toBe(2);
  });

  it('benutzt nach einem Neustart das gespeicherte Token', async () => {
    merkio = await startStandIn();
    const first = start('neustart');
    await until(() => first.names().length === 6, 'erster Abruf');
    first.stop.abort();
    const second = start('neustart');
    await until(() => second.names().length === 6, 'Abruf nach dem Neustart');
    expect([merkio.calls.get('POST /auth/login'), merkio.calls.get('POST /auth/refresh')]).toEqual([1, 1]);
  });

  it('holt nach einer Unterbrechung des Echtzeitkanals den Stand nach', async () => {
    merkio = await startStandIn();
    const shown = start('unterbrechung');
    await until(() => (merkio.calls.get('GET /lists/:id/events') ?? 0) >= 2, 'Echtzeitkanäle offen');
    merkio.dropStreams();
    // Diese Änderung fällt in die Lücke: Kein Kanal ist offen, der sie melden könnte
    merkio.items.push({ id: 901, listId: 11, name: 'Hefe', checked: 0, position: 99 });
    await until(() => shown.names().includes('Hefe'), 'Stand nachgeholt');
  }, 15_000);

  it('sagt, was fehlt, wenn keine oder falsche Zugangsdaten hinterlegt sind', async () => {
    merkio = await startStandIn();
    const none = start('ohne', {}, {});
    expect(none.datapoints.get('state')).toBe('login');
    expect(none.lists()).toEqual([]);
    expect(none.warnings[0]).toMatch(/"merkio": \{ "email"/);
    expect(existsSync(join(none.storageDir, 'token.json'))).toBe(false);

    const wrong = start('falsch', {}, { email: merkio.account.email, password: 'stimmt-nicht' });
    await until(() => wrong.datapoints.get('state') === 'login', 'Ablehnung');
    expect(wrong.warnings[0]).toMatch(/lehnt Konto oder Kennwort ab/);
    expect(wrong.warnings.join('\n')).not.toContain('stimmt-nicht');
  });

  it('sagt, wenn das Konto noch in keiner Gruppe Mitglied ist', async () => {
    merkio = await startStandIn();
    merkio.setMember(false);
    const shown = start('ohne-gruppe', { lists: [{ name: 'Einkauf', group: 'Familie' }] });
    await until(() => shown.datapoints.get('state') === 'nogroup', 'Meldung');
    expect(shown.lists()).toEqual([]);
    expect(shown.warnings).toEqual([expect.stringMatching(/in keiner Gruppe Mitglied/)]);
  });

  it('bleibt ruhig, wenn Merkio nicht erreichbar ist', async () => {
    merkio = await startStandIn();
    const url = merkio.url;
    await merkio.close();
    const shown = start('offline', { url });
    await until(() => shown.datapoints.get('state') === 'offline', 'Meldung');
    expect(shown.lists()).toEqual([]);
    expect(shown.warnings).toHaveLength(1);
  });
});

describe('Konfiguration', () => {
  it('nimmt Listennamen, Nummern und Angaben mit Gruppe an', () => {
    expect(plugin.parseConfig!({})).toEqual({ url: 'https://api.merkio.de', refreshMinutes: 5 });
    expect(plugin.parseConfig!({ lists: ['Einkauf', 7, { name: 'Einkauf', group: 'Verein' }], refreshMinutes: 30 })).toEqual({
      url: 'https://api.merkio.de',
      refreshMinutes: 30,
      lists: [{ name: 'Einkauf' }, { id: 7 }, { name: 'Einkauf', group: 'Verein' }],
    });
  });

  it('weist Unbrauchbares mit einer lesbaren Meldung ab', () => {
    for (const raw of [{ url: 'merkio' }, { lists: 'Einkauf' }, { lists: [''] }, { lists: [{}] }, { lists: [{ name: 'a', group: 3 }] }, { refreshMinutes: 0 }]) {
      expect(() => plugin.parseConfig!(raw), JSON.stringify(raw)).toThrow();
    }
  });
});
