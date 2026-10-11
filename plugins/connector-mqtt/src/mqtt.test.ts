import { type DatapointUpdate, type DatapointValue, InvalidInput, type PluginContext } from '@culinola/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import plugin from './index.ts';
import { discover, parsePoints, readValue, templatePath, topicMatches, toPayload } from './mapping.ts';
import { DISCOVERY, startStandIn, type StandIn } from './standin.ts';

describe('Themen', () => {
  it('passen auf Abonnements mit Platzhaltern', () => {
    expect(topicMatches('a/b/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a')).toBe(true);
    expect(topicMatches('#', 'a/b')).toBe(true);
    expect(topicMatches('a/b', 'a/b/c')).toBe(false);
    expect(topicMatches('a/+', 'a/b/c')).toBe(false);
    expect(topicMatches('a/b/c', 'a/b')).toBe(false);
  });
});

describe('Datenpunkte von Hand', () => {
  it('werden mit ihren Vorgaben gelesen', () => {
    const points = parsePoints([
      { id: 'co2', topic: 'ACLuft/tele/SENSOR', json: 'MHZ19B.CarbonDioxide', unit: 'ppm', label: 'CO₂', availability: 'ACLuft/tele/LWT' },
      { id: 'licht', topic: 'led/stat/POWER', command: 'led/cmnd/POWER', on: '1', off: '0', retain: true, availability: { topic: 'led/LWT', online: 'da', offline: 'weg' } },
    ]);
    expect(points[0]).toEqual({ id: 'co2', topic: 'ACLuft/tele/SENSOR', json: ['MHZ19B', 'CarbonDioxide'], on: 'ON', off: 'OFF', unit: 'ppm', label: 'CO₂', availability: { topic: 'ACLuft/tele/LWT', online: 'Online', offline: 'Offline' } });
    expect(points[1]).toMatchObject({ command: 'led/cmnd/POWER', on: '1', off: '0', retain: true, availability: { online: 'da', offline: 'weg' } });
    expect(parsePoints(undefined)).toEqual([]);
  });

  it('sagen bei Fehlern, welcher gemeint ist und was fehlt', () => {
    const bad: [unknown, RegExp][] = [
      [{}, /"datapoints" muss eine Liste/],
      [[{ topic: 'a' }], /Datenpunkt 1: "id" fehlt/],
      [[{ id: 'a b', topic: 'a' }], /"id" fehlt oder enthält/],
      [[{ id: 'a' }], /Datenpunkt "a": "topic" fehlt/],
      [[{ id: 'a', topic: 'a/+/b' }], /"topic" fehlt/],
      [[{ id: 'a', topic: 'a', command: 'a/#' }], /"command"/],
      [[{ id: 'a', topic: 'a', json: 7 }], /"json"/],
      [[{ id: 'a', topic: 'a', type: 'zahl' }], /"type"/],
      [[{ id: 'a', topic: 'a', retain: 'ja' }], /"retain"/],
      [[{ id: 'a', topic: 'a', on: 1 }], /"on"/],
      [[{ id: 'a', topic: 'a', availability: {} }], /"availability"/],
      [[{ id: 'a', topic: 'a' }, { id: 'a', topic: 'b' }], /doppelt/],
    ];
    for (const [raw, message] of bad) expect(() => parsePoints(raw), JSON.stringify(raw)).toThrow(message);
  });
});

describe('Werte aus Nachrichten', () => {
  const plain = { on: 'ON', off: 'OFF' };

  it('werden Zahl, Schalter oder Text', () => {
    expect(readValue(plain, '21.5')).toBe(21.5);
    expect(readValue(plain, ' on ')).toBe(true);
    expect(readValue(plain, 'OFF')).toBe(false);
    expect(readValue(plain, 'Heizen')).toBe('Heizen');
    expect(readValue(plain, '')).toBe('');
    expect(readValue({ on: '1', off: '0' }, '1')).toBe(true);
    expect(readValue({ ...plain, type: 'number' }, 'ON')).toBeUndefined();
    expect(readValue({ ...plain, type: 'text' }, '42')).toBe('42');
    expect(readValue({ ...plain, type: 'switch' }, 'true')).toBe(true);
    expect(readValue({ ...plain, type: 'switch' }, 'vielleicht')).toBeUndefined();
  });

  it('kommen aus der genannten Stelle im JSON', () => {
    const message = '{"Time":"2026-10-11T10:00:00","MHZ19B":{"CarbonDioxide":812,"Temperature":21.5},"POWER":"ON","an":true,"liste":[1,2]}';
    expect(readValue({ ...plain, json: ['MHZ19B', 'CarbonDioxide'] }, message)).toBe(812);
    expect(readValue({ ...plain, json: ['POWER'] }, message)).toBe(true);
    expect(readValue({ ...plain, json: ['an'] }, message)).toBe(true);
    expect(readValue({ ...plain, json: ['liste'] }, message)).toBe('[1,2]');
    // Fehlt die Stelle diesmal oder ist die Nachricht kein JSON, bleibt der alte Wert stehen
    expect(readValue({ ...plain, json: ['MHZ19B', 'Humidity'] }, message)).toBeUndefined();
    expect(readValue({ ...plain, json: ['POWER', 'tiefer'] }, message)).toBeUndefined();
    expect(readValue({ ...plain, json: ['x'] }, 'kein JSON')).toBeUndefined();
  });

  it('werden zum Schalten wieder zu den Worten des Geräts', () => {
    expect(toPayload({ on: '1', off: '0' }, true)).toBe('1');
    expect(toPayload(plain, false)).toBe('OFF');
    expect(toPayload(plain, 42)).toBe('42');
    expect(toPayload(plain, 'TOGGLE')).toBe('TOGGLE');
    expect(toPayload(plain, null)).toBe('');
  });
});

describe('Geräte, die sich selbst anmelden', () => {
  it('nennen die Stelle im JSON in einer Vorlage', () => {
    expect(templatePath("{{value_json['MHZ19B']['CarbonDioxide']}}")).toEqual(['MHZ19B', 'CarbonDioxide']);
    expect(templatePath('{{ value_json.POWER }}')).toEqual(['POWER']);
    expect(templatePath('{{value_json.a["b c"]}}')).toEqual(['a', 'b c']);
    expect(templatePath(undefined)).toBe('plain');
    expect(templatePath('{{ value }}')).toBe('plain');
    // Zusätze, die nur absichern oder die Art des Werts nennen, ändern die Stelle nicht
    expect(templatePath("{{value_json['Wifi']['RSSI'] | int}}")).toEqual(['Wifi', 'RSSI']);
    expect(templatePath('{{ value_json.temp | float | default(0) }}')).toEqual(['temp']);
    expect(templatePath("{{value_json.burngas if value_json.burngas is defined else 'off'}}")).toEqual(['burngas']);
    expect(templatePath('{{value_json.a.b if value_json.a.b is defined else 0}}')).toEqual(['a', 'b']);
    // Vorlagen, die rechnen oder umformen, werden nicht geraten
    for (const template of ['{{ value_json.t * 1.8 + 32 }}', '{{ value_json.t | round(1) }}', '{{ value_json.t | int + 1 }}', "{{value_json.a if value_json.b is defined else 0}}", "{{value_json.a if value_json.a == 'x' else 0}}", '{% if value %}an{% endif %}', '{{value_json}}']) expect(templatePath(template), template).toBeUndefined();
  });

  it('werden zu Datenpunkten mit Thema, Namen und Einheit', () => {
    const sensor = discover('homeassistant', 'homeassistant/sensor/4E3812_CO2/config', JSON.stringify({ name: 'ACLuft CO₂', stat_t: 'ACLuft/tele/SENSOR', avty_t: 'ACLuft/tele/LWT', pl_avail: 'Online', pl_not_avail: 'Offline', uniq_id: '4E3812_MHZ19B_CarbonDioxide', unit_of_meas: 'ppm', val_tpl: "{{value_json['MHZ19B']['CarbonDioxide']}}" }));
    expect(sensor).toEqual({
      point: { id: '4E3812_MHZ19B_CarbonDioxide', topic: 'ACLuft/tele/SENSOR', json: ['MHZ19B', 'CarbonDioxide'], on: 'ON', off: 'OFF', label: 'ACLuft CO₂', unit: 'ppm', availability: { topic: 'ACLuft/tele/LWT', online: 'Online', offline: 'Offline' } },
    });

    // Ausgeschriebene Namen, gekürzte Themen ("~") und ein Schalter mit eigenen Worten
    const light = discover('ha/geraete', 'ha/geraete/light/flur/decke/config', JSON.stringify({ name: 'Decke', '~': 'flur/decke', state_topic: '~/stat', command_topic: '~/set', payload_on: 'an', payload_off: 'aus', retain: true }));
    expect(light).toEqual({ point: { id: 'flur_decke', topic: 'flur/decke/stat', command: 'flur/decke/set', on: 'an', off: 'aus', label: 'Decke', type: 'switch', retain: true } });
    expect(discover('homeassistant', 'homeassistant/binary_sensor/tuer/config', '{"stat_t":"tuer/state","pl_on":"offen","pl_off":"zu"}')).toMatchObject({ point: { id: 'tuer', label: 'tuer', on: 'offen', off: 'zu', type: 'switch' } });
    // Ein Sensor lässt sich nicht schalten, auch wenn er ein Befehlsthema nennt
    expect(discover('homeassistant', 'homeassistant/sensor/x/config', '{"stat_t":"x","cmd_t":"x/set"}')).toEqual({ point: { id: 'x', topic: 'x', on: 'ON', off: 'OFF', label: 'x' } });
  });

  it('werden übergangen, wenn Culinola sie nicht versteht – mit Grund', () => {
    const skipped = (topic: string, payload: string) => (discover('homeassistant', topic, payload) as { skipped?: string }).skipped;
    expect(skipped('homeassistant/climate/heizung/config', '{"name":"Heizung"}')).toMatch(/Art "climate"/);
    expect(skipped('homeassistant/sensor/a/config', '{"name":"Ohne"}')).toMatch(/kein Thema/);
    expect(skipped('homeassistant/sensor/a/config', '{"name":"Rechnet","stat_t":"a","val_tpl":"{{ value | float * 2 }}"}')).toMatch(/Vorlage/);
    expect(skipped('homeassistant/sensor/a/config', 'kein JSON')).toMatch(/kein lesbares JSON/);
    expect(skipped('homeassistant/sensor/a/config', '[1]')).toMatch(/kein JSON-Objekt/);
    // Was keine Anmeldung ist, ist gar nichts
    for (const topic of ['homeassistant/sensor/a/state', 'homeassistant/status', 'anderes/sensor/a/config', 'homeassistant/config']) expect(discover('homeassistant', topic, '{}'), topic).toBeUndefined();
    // Eine leere Nachricht meldet ab
    expect(discover('homeassistant', 'homeassistant/sensor/4E3812_CO2/config', '')).toEqual({ removed: '4E3812_CO2' });
  });
});

describe('Konfiguration des Konnektors', () => {
  it('verlangt die Adresse eines Brokers', () => {
    for (const url of [undefined, '', 'http://broker', '192.168.178.10', 'mqtt://']) expect(() => plugin.parseConfig!({ url }), String(url)).toThrow(/"url"/);
    expect(plugin.parseConfig!({ url: 'mqtt://broker:1883' })).toEqual({ url: 'mqtt://broker:1883', datapoints: [], discovery: 'homeassistant' });
    expect(plugin.parseConfig!({ url: 'mqtts://broker', discovery: false }).discovery).toBe('');
    expect(plugin.parseConfig!({ url: 'ws://broker/mqtt', discovery: 'tasmota/discovery/' }).discovery).toBe('tasmota/discovery');
    for (const discovery of [7, '', 'a/#']) expect(() => plugin.parseConfig!({ url: 'mqtt://b', discovery }), String(discovery)).toThrow(/"discovery"/);
  });
});

describe('Konnektor am Broker', () => {
  let broker: StandIn;
  const stops: AbortController[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop.abort();
    await broker?.close();
  });

  function start(config: Record<string, unknown>, secrets: Record<string, string> = broker.account) {
    const datapoints = new Map<string, DatapointUpdate>();
    const warnings: string[] = [];
    let command: ((id: string, value: DatapointValue) => Promise<void>) | undefined;
    const stop = new AbortController();
    stops.push(stop);
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'mqtt',
      config: plugin.parseConfig!({ url: broker.url, ...config }),
      log: { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined },
      secrets: { get: (key) => secrets[key] },
      storageDir: '',
      datapoints: { set: (update) => void datapoints.set(update.id, update), list: () => [], shown: () => [] },
      actions: { register: () => undefined, list: () => [], run: async () => undefined },
      resources: { set: () => undefined },
      routes: { get: () => undefined, post: () => undefined },
      onCommand: (handler) => void (command = handler),
      provideHistory: () => undefined,
      signal: stop.signal,
    };
    void plugin.start!(context);
    const value = (id: string) => datapoints.get(id)?.value;
    return { datapoints, warnings, value, command: (id: string, to: DatapointValue) => command!(id, to) };
  }

  async function until(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Nicht eingetreten: ${what}`);
      await new Promise((resume) => setTimeout(resume, 20));
    }
  }

  it('liest von Hand eingerichtete Themen, schaltet und zeigt ein abgemeldetes Gerät als veraltet', async () => {
    broker = await startStandIn();
    const mqtt = start({
      discovery: false,
      datapoints: [
        { id: 'co2', topic: 'luft/tele/SENSOR', json: 'MHZ19B.CarbonDioxide', unit: 'ppm', label: 'CO₂', availability: 'luft/tele/LWT' },
        { id: 'licht', topic: 'nachtlicht/stat/POWER', command: 'nachtlicht/cmnd/POWER' },
        { id: 'frei', topic: 'frei/wert' },
      ],
    });
    // Bis zur ersten Nachricht gibt es den Datenpunkt schon – ohne Wert, aber schaltbar
    expect(mqtt.datapoints.get('licht')).toMatchObject({ value: null, writable: true });
    await until(() => typeof mqtt.value('co2') === 'number', 'erster Messwert');
    expect(mqtt.datapoints.get('co2')).toMatchObject({ unit: 'ppm', label: 'CO₂', writable: false });
    expect(mqtt.datapoints.get('co2')!.quality).toBeUndefined();
    expect(mqtt.value('state')).toBe('ok');

    await mqtt.command('licht', true);
    await until(() => mqtt.value('licht') === true, 'Licht meldet ein');
    expect(broker.received.at(-1)).toEqual({ topic: 'nachtlicht/cmnd/POWER', payload: 'ON', retain: false });
    await mqtt.command('licht', false);
    await until(() => mqtt.value('licht') === false, 'Licht meldet aus');
    await expect(mqtt.command('co2', 1)).rejects.toBeInstanceOf(InvalidInput);
    await expect(mqtt.command('gibt-es-nicht', 1)).rejects.toBeInstanceOf(InvalidInput);

    broker.publish('frei/wert', 'Urlaub');
    await until(() => mqtt.value('frei') === 'Urlaub', 'Text kommt an');
    // Das Gerät meldet sich ab: Der letzte Wert bleibt stehen, gilt aber als veraltet
    const before = mqtt.value('co2');
    broker.publish('luft/tele/LWT', 'Offline', true);
    await until(() => mqtt.datapoints.get('co2')!.quality === 'stale', 'als veraltet gemeldet');
    expect(mqtt.value('co2')).toBe(before);
    broker.publish('luft/tele/LWT', 'Online', true);
    await until(() => mqtt.datapoints.get('co2')!.quality === undefined, 'wieder frisch');
  });

  it('übernimmt Geräte, die sich selbst anmelden, und lässt sie schalten', async () => {
    broker = await startStandIn();
    const mqtt = start({});
    await until(() => typeof mqtt.value('4E3812_CO2') === 'number' && mqtt.value('A1B2C3_RL_1') === false, 'Geräte angemeldet');
    expect(mqtt.datapoints.get('4E3812_CO2')).toMatchObject({ label: 'Luft CO₂', unit: 'ppm', writable: false });
    expect(mqtt.datapoints.get('4E3812_T')).toMatchObject({ value: 21.5, unit: '°C' });
    expect(mqtt.datapoints.get('A1B2C3_RL_1')).toMatchObject({ label: 'Nachtlicht', writable: true });
    // Was Culinola nicht versteht, taucht nicht auf: die rechnende Vorlage und die Heizung
    expect([...mqtt.datapoints.keys()].sort()).toEqual(['4E3812_CO2', '4E3812_T', 'A1B2C3_RL_1', 'state']);

    await mqtt.command('A1B2C3_RL_1', true);
    await until(() => mqtt.value('A1B2C3_RL_1') === true, 'Nachtlicht meldet ein');

    // Ein neues Gerät erscheint im Betrieb, ein altes meldet sich ab
    broker.publish(`${DISCOVERY}/binary_sensor/tuer/config`, '{"name":"Tür","stat_t":"tuer/state","pl_on":"offen","pl_off":"zu"}', true);
    // Der Wert kommt, sobald der Konnektor das Thema des neuen Geräts abonniert hat
    await until(() => (broker.publish('tuer/state', 'offen'), mqtt.value('tuer') === true), 'neues Gerät');
    broker.publish(`${DISCOVERY}/sensor/4E3812_T/config`, '', true);
    await until(() => mqtt.value('4E3812_T') === null, 'Gerät abgemeldet');
  });

  it('lässt von Hand eingerichtete Datenpunkte vor angemeldeten gelten', async () => {
    broker = await startStandIn();
    const mqtt = start({ datapoints: [{ id: '4E3812_CO2', topic: 'luft/tele/SENSOR', json: 'MHZ19B.Model', label: 'Bauart' }] });
    await until(() => mqtt.value('4E3812_CO2') === 'B', 'eigener Datenpunkt');
    await until(() => mqtt.value('4E3812_T') === 21.5, 'angemeldeter daneben');
    expect(mqtt.datapoints.get('4E3812_CO2')).toMatchObject({ label: 'Bauart', value: 'B' });
  });

  it('verbindet sich nach einem Abbruch neu und abonniert wieder', async () => {
    broker = await startStandIn();
    const mqtt = start({ discovery: false, datapoints: [{ id: 'frei', topic: 'frei/wert' }] });
    await until(() => mqtt.value('state') === 'ok', 'verbunden');
    broker.dropClients();
    await until(() => mqtt.value('state') === 'offline', 'Abbruch bemerkt');
    await expect(mqtt.command('frei', 1)).rejects.toThrow(/lässt sich nicht schalten/);
    await until(() => broker.logins() === 2 && mqtt.value('state') === 'ok', 'neu verbunden');
    await until(() => (broker.publish('frei/wert', '7'), mqtt.value('frei') === 7), 'wieder abonniert');
  }, 15_000);

  it('sagt, wenn der Broker die Anmeldung ablehnt', async () => {
    broker = await startStandIn();
    const mqtt = start({ discovery: false }, { username: 'kueche', password: 'falsch' });
    await until(() => mqtt.value('state') === 'login', 'Anmeldung abgelehnt');
    expect(mqtt.warnings.join(' ')).toMatch(/lehnt die Anmeldung ab.*"mqtt"/);
  });
});
