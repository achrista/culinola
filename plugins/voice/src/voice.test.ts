import type Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidInput, type ActionDefinition, type Datapoint, type PluginContext, type RouteHandler } from '@culinola/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Der Platzhalter für die Claude-API gehört zum Import-Werkzeug und versteht auch Anfragen mit Werkzeugen
import { startStandIn, type StandIn } from '../../../packages/recipe-import/src/standin.ts';
import { ask, toolName, toolsFromActions } from './assistant.ts';
import { knownValues, readValues, VALUES_TOOL, valuesTool } from './values.ts';
import plugin from './index.ts';

const ACTIONS: ActionDefinition[] = [
  { name: 'timer.start', description: 'Stellt die Eieruhr.', params: { minutes: { type: 'number', description: 'Dauer in Minuten' }, seconds: { type: 'number', description: 'Sekunden dazu' } } },
  { name: 'timer.stop', description: 'Schaltet die Eieruhr aus.' },
  { name: 'lists.add', description: 'Setzt etwas auf die Liste.', params: { text: { type: 'string', description: 'Der Eintrag', required: true }, list: { type: 'string', description: 'Liste' } } },
  { name: 'door.open', description: 'Öffnet die Haustür.', sensitive: true },
];

/** Ein Modell, das der Reihe nach die vorgegebenen Antworten liefert und sich merkt, was es gefragt wurde. */
function scripted(...answers: { stop: string; content: unknown[] }[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const messages = {
    create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      // Die Anfrage wird festgehalten, wie sie in diesem Augenblick aussah
      calls.push(structuredClone(params));
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
      return { content: answer.content, stop_reason: answer.stop };
    },
  };
  return { client: { messages } as unknown as Pick<Anthropic, 'messages'>, calls };
}
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const text = (value: string) => ({ type: 'text', text: value });

describe('Aktionen als Werkzeuge', () => {
  it('bietet Aktionen mit ihren Parametern an und lässt heikle weg', () => {
    const tools = toolsFromActions(ACTIONS);
    expect(tools.map((tool) => tool.name)).toEqual(['timer__start', 'timer__stop', 'lists__add']);
    expect(tools[2]).toEqual({
      name: 'lists__add',
      description: 'Setzt etwas auf die Liste.',
      input_schema: { type: 'object', properties: { text: { type: 'string', description: 'Der Eintrag' }, list: { type: 'string', description: 'Liste' } }, required: ['text'] },
    });
    expect(tools[1]!.input_schema).toEqual({ type: 'object', properties: {}, required: [] });
    expect(toolName('radio.volume')).toBe('radio__volume');
  });
});

describe('Ein gesprochener Satz', () => {
  it('löst die Aktion aus und antwortet mit dem Satz des Modells', async () => {
    const ran: [string, unknown][] = [];
    const { client, calls } = scripted({ stop: 'tool_use', content: [{ type: 'thinking', thinking: '' }, use('t1', 'timer__start', { minutes: 8 })] }, { stop: 'end_turn', content: [text('Die **Eieruhr** läuft,\nacht Minuten.')] });
    const answer = await ask('Stell die Eieruhr auf 8 Minuten', { client, actions: ACTIONS, run: async (name, params) => void ran.push([name, params]), now: new Date('2026-10-09T12:00:00') });

    expect(answer).toEqual({ reply: 'Die Eieruhr läuft, acht Minuten.', actions: [{ action: 'timer.start', params: { minutes: 8 }, ok: true }], values: [] });
    expect(ran).toEqual([['timer.start', { minutes: 8 }]]);
    expect(calls[0]).toMatchObject({ model: 'claude-haiku-5-5', messages: [{ role: 'user', content: 'Stell die Eieruhr auf 8 Minuten' }] });
    expect(calls[0]!.system).toContain('9. Oktober 2026');
    // Das Ergebnis geht mit der Antwort des Modells zurück, damit es bestätigen kann
    expect(calls[1]!.messages.slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, use('t1', 'timer__start', { minutes: 8 })] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'erledigt' }] },
    ]);
  });

  it('führt mehrere Aktionen aus und meldet dem Modell, was scheiterte', async () => {
    const { client, calls } = scripted({ stop: 'tool_use', content: [use('a', 'lists__add', { text: 'Milch' }), use('b', 'lists__add', { text: '' }), use('c', 'door__open', {})] }, { stop: 'end_turn', content: [text('Milch steht auf der Liste.')] });
    const answer = await ask('Milch und noch was', {
      client,
      actions: ACTIONS.filter((action) => !action.sensitive),
      run: async (_name, params) => {
        if (!params['text']) throw new InvalidInput('Der Eintrag ist leer.');
        return { added: true };
      },
    });
    expect(answer.actions).toEqual([
      { action: 'lists.add', params: { text: 'Milch' }, ok: true },
      { action: 'lists.add', params: { text: '' }, ok: false, error: 'Der Eintrag ist leer.' },
      { action: 'door__open', params: {}, ok: false, error: 'Das Werkzeug "door__open" gibt es nicht.' },
    ]);
    expect(calls[1]!.messages.at(-1)!.content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '{"added":true}' },
      { type: 'tool_result', tool_use_id: 'b', content: 'Der Eintrag ist leer.', is_error: true },
      { type: 'tool_result', tool_use_id: 'c', content: 'Das Werkzeug "door__open" gibt es nicht.', is_error: true },
    ]);
  });

  it('antwortet ohne Aktion, wenn nichts passt, und in der gewünschten Sprache', async () => {
    const plain = scripted({ stop: 'end_turn', content: [text('Das kann ich nicht.')] });
    expect(await ask('Wie wird das Wetter?', { client: plain.client, actions: ACTIONS, run: async () => undefined })).toEqual({ reply: 'Das kann ich nicht.', actions: [], values: [] });
    const english = scripted({ stop: 'end_turn', content: [] });
    expect((await ask('…', { client: english.client, actions: [], run: async () => undefined, language: 'en' })).reply).toMatch(/^That was too involved/);
    expect(english.calls[0]!.system).toContain('auf Englisch');
  });

  it('gibt den vorigen Wortwechsel mit, damit eine Antwort auf eine Rückfrage verstanden wird', async () => {
    const { client, calls } = scripted({ stop: 'tool_use', content: [use('t', 'timer__start', { minutes: 8 })] }, { stop: 'end_turn', content: [text('Die Eieruhr läuft.')] });
    await ask('acht Minuten', { client, actions: ACTIONS, run: async () => undefined, history: [{ text: 'Stell die Eieruhr', reply: 'Wie lange soll sie laufen?' }] });
    expect(calls[0]!.messages).toEqual([
      { role: 'user', content: 'Stell die Eieruhr' },
      { role: 'assistant', content: 'Wie lange soll sie laufen?' },
      { role: 'user', content: 'acht Minuten' },
    ]);
  });

  it('hört auf, wenn das Modell kein Ende findet oder ablehnt', async () => {
    let ran = 0;
    const endless = scripted({ stop: 'tool_use', content: [use('x', 'timer__stop', {})] });
    const answer = await ask('…', { client: endless.client, actions: ACTIONS, run: async () => void ran++ });
    expect([ran, endless.calls.length, answer.reply]).toEqual([4, 4, 'Das war mir zu verwickelt. Bitte noch einmal in einem Satz.']);

    const refused = scripted({ stop: 'refusal', content: [use('x', 'timer__stop', {})] });
    expect(await ask('…', { client: refused.client, actions: ACTIONS, run: async () => void ran++ })).toEqual({ reply: 'Dabei kann ich nicht helfen.', actions: [], values: [] });
    expect(ran).toBe(4);
  });
});

const at = '2026-10-09T10:00:00.000Z';
/** Der Stand im Haus, wie ihn der Kern den Plugins zeigt. */
const HOUSE: Datapoint[] = [
  { id: 'oh:T_Aussen', value: 12.345, unit: '°C', label: 'Temperatur Garten', ts: at, quality: 'good' },
  { id: 'oh:F_Wohnen', value: 48, unit: '%', label: 'Luftfeuchte Wohnen', ts: at, quality: 'good' },
  { id: 'oh:mobUli', value: true, ts: at, quality: 'good' },
  { id: 'oh:Alt', value: 3, unit: 'W', ts: '2026-10-09T06:30:00.000Z', quality: 'stale' },
  { id: 'oh:Kaputt', value: 1, ts: at, quality: 'error' },
  { id: 'oh:Leer', value: null, ts: at, quality: 'good' },
  { id: 'oh:Modus', value: 'Urlaub', ts: at, quality: 'good' },
  { id: 'astro:sunset', value: '2026-10-09T16:32:00.000Z', ts: at, quality: 'good' },
  { id: 'astro:nextSunrise', value: '2026-10-10T05:28:00.000Z', ts: at, quality: 'good' },
];
const SHOWN = [
  { id: 'oh:T_Aussen', name: 'Außen' },
  { id: 'oh:mobUli', name: 'Uli' },
  { id: 'oh:F_Wohnen', name: '' },
  { id: 'oh:Ohne_Namen', name: '' },
];

describe('Werte, nach denen man fragen kann', () => {
  it('heißen wie auf der Anzeige – oder so, wie die Konfiguration sie nennt', () => {
    const known = knownValues([{ id: 'oh:T_Aussen', name: 'Draußen' }, { id: 'astro:sunset' }], SHOWN, HOUSE);
    expect(known).toEqual([
      { id: 'oh:T_Aussen', name: 'Draußen', unit: '°C', label: 'Temperatur Garten' },
      // Ohne eigenen Namen heißt ein Wert wie im Quellsystem; gibt es auch dort keinen, bleibt er weg
      { id: 'oh:mobUli', name: 'Uli' },
      { id: 'oh:F_Wohnen', name: 'Luftfeuchte Wohnen', unit: '%' },
    ]);
    // Gleiche Namen werden unterscheidbar
    const twice = knownValues([], [{ id: 'oh:T_Aussen', name: 'Wohnen' }, { id: 'oh:F_Wohnen', name: 'Wohnen' }, { id: 'oh:mobUli', name: 'wohnen' }], HOUSE);
    expect(twice.map((value) => value.name)).toEqual(['Wohnen', 'Wohnen (%)', 'wohnen (oh:mobUli)']);
  });

  it('werden dem Sprachmodell nur mit Namen und Einheit genannt', () => {
    const tool = valuesTool(knownValues([], SHOWN, HOUSE))!;
    expect(tool.name).toBe(VALUES_TOOL);
    expect(tool.description).toContain('- Außen [°C] – Temperatur Garten\n- Uli\n- Luftfeuchte Wohnen [%]');
    expect(tool.description).not.toContain('12');
    expect(tool.input_schema).toMatchObject({ properties: { names: { type: 'array', items: { enum: ['Außen', 'Uli', 'Luftfeuchte Wohnen'] } } }, required: ['names'] });
    expect(valuesTool([])).toBeUndefined();
  });

  it('werden so gelesen, dass nichts erfunden werden muss', () => {
    const known = knownValues(
      ['oh:Alt', 'oh:Kaputt', 'oh:Leer', 'oh:Modus', 'astro:sunset', 'astro:nextSunrise', 'oh:Fehlt'].map((id) => ({ id, name: id.split(':')[1]! })),
      SHOWN,
      HOUSE,
    );
    const now = new Date('2026-10-09T12:00:00');
    const hours = (iso: string) => new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' }).format(new Date(iso));
    const read = (...names: string[]) => readValues(known, names, HOUSE, { now });
    expect(read('Außen', 'luftfeuchte wohnen')).toBe('Außen: 12.35 °C\nLuftfeuchte Wohnen: 48 %');
    expect(read('Uli')).toMatch(/^Uli: ja \(/);
    expect(read('Modus', 'Leer', 'Fehlt', 'Kaputt', 'Gibt es nicht')).toBe('Modus: Urlaub\nLeer: kein Wert vorhanden\nFehlt: kein Wert vorhanden\nKaputt: gestört, kein verlässlicher Wert\nGibt es nicht: unbekannt');
    expect(read('Alt')).toBe(`Alt: 3 W (veraltet, Stand heute ${hours('2026-10-09T06:30:00.000Z')})`);
    // Zeitpunkte kommen in Weltzeit und werden als Uhrzeit im Haus genannt
    expect(read('sunset')).toBe(`sunset: heute ${hours('2026-10-09T16:32:00.000Z')}`);
    expect(read('nextSunrise')).toMatch(/^nextSunrise: Samstag, 10\. Oktober 2026, /);
    expect(read()).toBe('Es wurde kein Wert genannt.');
  });

  it('liest das Sprachmodell über sein Werkzeug, ohne dass eine Aktion läuft', async () => {
    const known = knownValues([], SHOWN, HOUSE);
    const asked: string[][] = [];
    const { client, calls } = scripted({ stop: 'tool_use', content: [use('w1', VALUES_TOOL, { names: ['Außen', 7] })] }, { stop: 'end_turn', content: [text('Draußen sind es gut zwölf Grad.')] });
    const answer = await ask('Wie warm ist es draußen?', {
      client,
      actions: ACTIONS,
      run: async () => {
        throw new Error('Hier darf nichts ausgelöst werden.');
      },
      values: { tool: valuesTool(known)!, read: (names) => (asked.push(names), readValues(known, names, HOUSE)) },
    });
    expect(answer).toEqual({ reply: 'Draußen sind es gut zwölf Grad.', actions: [], values: ['Außen'] });
    expect(asked).toEqual([['Außen']]);
    expect(calls[0]!.tools!.map((tool) => tool.name)).toEqual(['timer__start', 'timer__stop', 'lists__add', VALUES_TOOL]);
    expect(calls[0]!.system).toContain(VALUES_TOOL);
    expect(calls[1]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'Außen: 12.35 °C' }] });
    // Ohne Werte steht davon auch nichts in der Anweisung
    const plain = scripted({ stop: 'end_turn', content: [text('Hallo.')] });
    await ask('Hallo', { client: plain.client, actions: ACTIONS, run: async () => undefined });
    expect(plain.calls[0]!.system).not.toContain(VALUES_TOOL);
  });
});

describe('Sprachsteuerung als Plugin', () => {
  let standIn: StandIn;
  const before = { key: process.env['ANTHROPIC_API_KEY'], url: process.env['ANTHROPIC_BASE_URL'] };
  const stop = new AbortController();

  function start(secrets: Record<string, string>, storageDir = '', config: Record<string, unknown> = {}) {
    const routes = new Map<string, RouteHandler>();
    const datapoints = new Map<string, unknown>();
    const ran: [string, unknown][] = [];
    const warnings: string[] = [];
    const infos: string[] = [];
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'voice',
      config: plugin.parseConfig!(config),
      log: { info: (message) => void infos.push(message), warn: (message) => void warnings.push(message), error: () => undefined },
      secrets: { get: (key) => secrets[key] },
      storageDir,
      datapoints: { set: (update) => void datapoints.set(update.id, update.value), list: () => HOUSE, shown: () => SHOWN },
      actions: {
        register: () => undefined,
        list: () => [...ACTIONS, { name: 'voice.selbst', description: 'Gehört der Sprachsteuerung selbst.' }],
        run: async (name, params) => {
          ran.push([name, params]);
          if (name === 'lists.add' && (params as { text?: string }).text === 'Nichts') throw new InvalidInput('Der Eintrag ist leer.');
          return undefined;
        },
      },
      resources: { set: () => undefined },
      routes: { get: (path, handler) => void routes.set(`GET ${path}`, handler), post: (path, handler) => void routes.set(path, handler) },
      onCommand: () => undefined,
      provideHistory: () => undefined,
      signal: stop.signal,
    };
    void plugin.start!(context);
    const handler = routes.get('/ask')!;
    const say = async (body: unknown) => {
      const response = await handler({ params: {}, query: {}, body, signal: new AbortController().signal });
      return { status: response.status, body: (await response.json()) as { reply?: string; error?: string; actions?: { action: string; ok: boolean }[]; values?: string[] } };
    };
    const model = () => routes.get('GET /model')!({ params: {}, query: {}, body: undefined, signal: new AbortController().signal });
    return { say, ran, datapoints, warnings, infos, model };
  }

  beforeAll(async () => {
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
  });

  it('meldet ohne Schlüssel, dass sie nicht eingerichtet ist', async () => {
    const voice = start({});
    expect(voice.datapoints.get('ready')).toBe(false);
    expect(voice.warnings[0]).toMatch(/"voice": \{ "anthropicApiKey"/);
    expect((await voice.say({ text: 'Eieruhr auf 5 Minuten' })).status).toBe(503);
    expect((await voice.say({})).status).toBe(400);
    expect((await voice.say({ text: 'a'.repeat(501) })).status).toBe(400);
    expect(standIn.requests).toHaveLength(0);
  });

  it('liefert das Sprachmodell für das Aktivierungswort aus, wenn eines hinterlegt ist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'culinola-voice-'));
    try {
      const without = start({}, join(dir, 'leer'));
      expect(without.datapoints.get('model')).toBe(false);
      expect((await without.model()).status).toBe(404);

      mkdirSync(join(dir, 'voll'));
      writeFileSync(join(dir, 'voll', 'model.tar.gz'), Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3]));
      const withModel = start({}, join(dir, 'voll'));
      expect(withModel.datapoints.get('model')).toBe(true);
      const answer = await withModel.model();
      expect([answer.status, answer.headers.get('content-type'), answer.headers.get('content-length')]).toEqual([200, 'application/gzip', '7']);
      expect(new Uint8Array(await answer.arrayBuffer())).toHaveLength(7);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('löst über die Schnittstelle der Claude-API Aktionen aus', async () => {
    const voice = start({ anthropicApiKey: 'schluessel-fuer-den-test' });
    expect(voice.datapoints.get('ready')).toBe(true);
    expect(await voice.say({ text: ' Stell die   Eieruhr auf 8 Minuten ' })).toEqual({ status: 200, body: { reply: 'Erledigt.', actions: [{ action: 'timer.start', params: { minutes: 8 }, ok: true }], values: [] } });
    expect(await voice.say({ text: 'Setze Hafermilch auf die Einkaufsliste' })).toMatchObject({ status: 200, body: { reply: 'Erledigt.', actions: [{ action: 'lists.add', ok: true }] } });
    expect(voice.ran).toEqual([
      ['timer.start', { minutes: 8 }],
      ['lists.add', { text: 'Hafermilch' }],
    ]);
    // Angeboten werden die Aktionen der anderen – ohne heikle und ohne die eigenen
    expect(standIn.requests.at(-1)!.tools!.map((tool) => tool.name)).toEqual(['timer__start', 'timer__stop', 'lists__add', 'values__read']);
  });

  it('beantwortet Fragen nach dem, was auf den Anzeigen steht', async () => {
    const voice = start({ anthropicApiKey: 'schluessel-fuer-den-test' }, '', { values: [{ datapoint: 'astro:sunset', name: 'Sonnenuntergang' }] });
    const answer = await voice.say({ text: 'Wie warm ist es außen?' });
    expect(answer).toEqual({ status: 200, body: { reply: 'Außen: 12.35 °C', actions: [], values: ['Außen'] } });
    // Zur Wahl stehen die Namen – die Werte selbst gehen erst mit, wenn nach ihnen gefragt wird
    const first = standIn.requests.at(-2)!;
    expect(first.tools!.at(-1)!.input_schema!.properties!['names']!.items!.enum).toEqual(['Sonnenuntergang', 'Außen', 'Uli', 'Luftfeuchte Wohnen']);
    expect(JSON.stringify(first)).not.toContain('12.35');
    expect(voice.ran).toEqual([]);
    // Ins Protokoll kommt, wonach gefragt wurde – nicht der Wert
    expect(voice.infos.at(-1)).toBe('Sprache: Werte gelesen (Außen)');
    expect((await voice.say({ text: 'Ist Uli zu Hause?' })).body.reply).toMatch(/^Uli: ja/);

    // Abgeschaltet oder ohne bekannte Werte gibt es das Werkzeug nicht
    const without = start({ anthropicApiKey: 'schluessel-fuer-den-test' }, '', { layoutValues: false });
    await without.say({ text: 'Wie warm ist es außen?' });
    expect(standIn.requests.at(-1)!.tools!.map((tool) => tool.name)).toEqual(['timer__start', 'timer__stop', 'lists__add']);
  });

  it('weist eine unbrauchbare Liste von Werten in der Konfiguration zurück', () => {
    for (const values of ['astro:sunset', [7], ['ohne-quelle'], [{ name: 'x' }], [{ datapoint: 'a:b', name: ' ' }]]) expect(() => plugin.parseConfig!({ values }), JSON.stringify(values)).toThrow(/"values"/);
    expect(() => plugin.parseConfig!({ layoutValues: 'ja' })).toThrow(/"layoutValues"/);
    expect(plugin.parseConfig!({ values: ['astro:sunset', { datapoint: 'oh:T', name: ' Keller ' }] })).toMatchObject({ values: [{ id: 'astro:sunset' }, { id: 'oh:T', name: 'Keller' }], layoutValues: true });
  });

  it('sagt, wenn eine Aktion scheitert oder nichts passt', async () => {
    const voice = start({ anthropicApiKey: 'schluessel-fuer-den-test' });
    expect(await voice.say({ text: 'Setze Nichts auf die Liste' })).toMatchObject({ status: 200, body: { reply: 'Das hat nicht geklappt.', actions: [{ action: 'lists.add', ok: false }] } });
    expect(await voice.say({ text: 'Wie geht es dir?' })).toMatchObject({ status: 200, body: { actions: [] } });
    // Der vorige Wortwechsel kommt mit – höchstens drei, und nur vollständige
    await voice.say({ text: 'acht Minuten', history: [{ text: 'a', reply: 'b' }, { text: 'c' }, 'unsinn', { text: 'Stell die Eieruhr', reply: 'Wie lange?' }] });
    expect(standIn.requests.at(-1)!.messages.map((message) => message.content)).toEqual(['a', 'b', 'Stell die Eieruhr', 'Wie lange?', 'acht Minuten']);
    // Ein Werkzeug, das diese Anzeige nicht anbietet, wird gar nicht erst aufgerufen
    expect((await voice.say({ text: 'Spiele Bayern 2' })).body.reply).toBe('Das kann ich hier nicht.');
  });
});
