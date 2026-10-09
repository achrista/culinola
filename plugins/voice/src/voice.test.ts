import type Anthropic from '@anthropic-ai/sdk';
import { InvalidInput, type ActionDefinition, type PluginContext, type RouteHandler } from '@culinola/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Der Platzhalter für die Claude-API gehört zum Import-Werkzeug und versteht auch Anfragen mit Werkzeugen
import { startStandIn, type StandIn } from '../../../packages/recipe-import/src/standin.ts';
import { ask, toolName, toolsFromActions } from './assistant.ts';
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

    expect(answer).toEqual({ reply: 'Die Eieruhr läuft, acht Minuten.', actions: [{ action: 'timer.start', params: { minutes: 8 }, ok: true }] });
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
    expect(await ask('Wie wird das Wetter?', { client: plain.client, actions: ACTIONS, run: async () => undefined })).toEqual({ reply: 'Das kann ich nicht.', actions: [] });
    const english = scripted({ stop: 'end_turn', content: [] });
    expect((await ask('…', { client: english.client, actions: [], run: async () => undefined, language: 'en' })).reply).toMatch(/^That was too involved/);
    expect(english.calls[0]!.system).toContain('auf Englisch');
  });

  it('hört auf, wenn das Modell kein Ende findet oder ablehnt', async () => {
    let ran = 0;
    const endless = scripted({ stop: 'tool_use', content: [use('x', 'timer__stop', {})] });
    const answer = await ask('…', { client: endless.client, actions: ACTIONS, run: async () => void ran++ });
    expect([ran, endless.calls.length, answer.reply]).toEqual([4, 4, 'Das war mir zu verwickelt. Bitte noch einmal in einem Satz.']);

    const refused = scripted({ stop: 'refusal', content: [use('x', 'timer__stop', {})] });
    expect(await ask('…', { client: refused.client, actions: ACTIONS, run: async () => void ran++ })).toEqual({ reply: 'Dabei kann ich nicht helfen.', actions: [] });
    expect(ran).toBe(4);
  });
});

describe('Sprachsteuerung als Plugin', () => {
  let standIn: StandIn;
  const before = { key: process.env['ANTHROPIC_API_KEY'], url: process.env['ANTHROPIC_BASE_URL'] };
  const stop = new AbortController();

  function start(secrets: Record<string, string>) {
    const routes = new Map<string, RouteHandler>();
    const datapoints = new Map<string, unknown>();
    const ran: [string, unknown][] = [];
    const warnings: string[] = [];
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'voice',
      config: plugin.parseConfig!({}),
      log: { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined },
      secrets: { get: (key) => secrets[key] },
      storageDir: '',
      datapoints: { set: (update) => void datapoints.set(update.id, update.value) },
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
      routes: { get: () => undefined, post: (path, handler) => void routes.set(path, handler) },
      onCommand: () => undefined,
      provideHistory: () => undefined,
      signal: stop.signal,
    };
    void plugin.start!(context);
    const handler = routes.get('/ask')!;
    const say = async (body: unknown) => {
      const response = await handler({ params: {}, query: {}, body, signal: new AbortController().signal });
      return { status: response.status, body: (await response.json()) as { reply?: string; error?: string; actions?: { action: string; ok: boolean }[] } };
    };
    return { say, ran, datapoints, warnings };
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

  it('löst über die Schnittstelle der Claude-API Aktionen aus', async () => {
    const voice = start({ anthropicApiKey: 'schluessel-fuer-den-test' });
    expect(voice.datapoints.get('ready')).toBe(true);
    expect(await voice.say({ text: ' Stell die   Eieruhr auf 8 Minuten ' })).toEqual({ status: 200, body: { reply: 'Erledigt.', actions: [{ action: 'timer.start', params: { minutes: 8 }, ok: true }] } });
    expect(await voice.say({ text: 'Setze Hafermilch auf die Einkaufsliste' })).toMatchObject({ status: 200, body: { reply: 'Erledigt.', actions: [{ action: 'lists.add', ok: true }] } });
    expect(voice.ran).toEqual([
      ['timer.start', { minutes: 8 }],
      ['lists.add', { text: 'Hafermilch' }],
    ]);
    // Angeboten werden die Aktionen der anderen – ohne heikle und ohne die eigenen
    expect(standIn.requests.at(-1)!.tools!.map((tool) => tool.name)).toEqual(['timer__start', 'timer__stop', 'lists__add']);
  });

  it('sagt, wenn eine Aktion scheitert oder nichts passt', async () => {
    const voice = start({ anthropicApiKey: 'schluessel-fuer-den-test' });
    expect(await voice.say({ text: 'Setze Nichts auf die Liste' })).toMatchObject({ status: 200, body: { reply: 'Das hat nicht geklappt.', actions: [{ action: 'lists.add', ok: false }] } });
    expect(await voice.say({ text: 'Wie geht es dir?' })).toMatchObject({ status: 200, body: { actions: [] } });
    // Ein Werkzeug, das diese Anzeige nicht anbietet, wird gar nicht erst aufgerufen
    expect((await voice.say({ text: 'Spiele Bayern 2' })).body.reply).toBe('Das kann ich hier nicht.');
  });
});
