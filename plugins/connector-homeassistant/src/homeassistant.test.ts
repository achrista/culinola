import { type DatapointUpdate, type DatapointValue, InvalidInput, type PluginContext, type SeriesPoint } from '@culinola/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import plugin from './index.ts';
import { isWanted, isWritable, toDatapoint, toSeries, toService } from './mapping.ts';
import { startStandIn, type StandIn } from './standin.ts';

describe('Geräte aus Home Assistant', () => {
  it('werden übernommen, wenn Culinola mit ihrer Art etwas anfangen kann', () => {
    for (const id of ['sensor.aussen', 'light.kueche', 'switch.a', 'binary_sensor.tuer', 'cover.rollo', 'person.anna', 'device_tracker.handy', 'sun.sun', 'input_number.x']) expect(isWanted(id), id).toBe(true);
    // Was keinen Messwert hat oder zu heikel zum Schalten ist, bleibt draußen
    for (const id of ['lock.haustuer', 'media_player.tv', 'camera.garten', 'scene.abend', 'button.neustart', 'zone.home', 'alarm_control_panel.haus', 'climate.bad', 'kein punkt', 'A.b']) expect(isWanted(id), id).toBe(false);
    // Eine eigene Auswahl gilt statt der Vorgabe
    expect(isWanted('lock.haustuer', { entities: ['lock.haustuer'] })).toBe(true);
    expect(isWanted('light.kueche', { entities: ['lock.haustuer'] })).toBe(false);
    expect(isWanted('climate.bad', { domains: ['climate'] })).toBe(true);
    expect(isWanted('sensor.aussen', { domains: ['climate'] })).toBe(false);
    expect([isWritable('light.a'), isWritable('cover.a'), isWritable('input_select.a'), isWritable('sensor.a'), isWritable('binary_sensor.a'), isWritable('person.a')]).toEqual([true, true, true, false, false, false]);
  });

  it('werden zu Datenpunkten mit Namen, Einheit und passender Art des Werts', () => {
    expect(toDatapoint({ entity_id: 'sensor.aussen', state: '12.3', attributes: { friendly_name: 'Außen', unit_of_measurement: '°C' }, last_updated: '2026-10-11T10:00:00+00:00' })).toEqual({ id: 'sensor.aussen', value: 12.3, unit: '°C', label: 'Außen', writable: false, ts: '2026-10-11T10:00:00+00:00' });
    expect(toDatapoint({ entity_id: 'light.kueche', state: 'on' })).toEqual({ id: 'light.kueche', value: true, writable: true });
    expect(toDatapoint({ entity_id: 'binary_sensor.tuer', state: 'off' }).value).toBe(false);
    expect(toDatapoint({ entity_id: 'sensor.waschen', state: 'Schleudern' }).value).toBe('Schleudern');
    expect(toDatapoint({ entity_id: 'person.anna', state: 'home' }).value).toBe('home');
    // Eine Auswahl bleibt Text, auch wenn sie wie eine Zahl aussieht
    expect(toDatapoint({ entity_id: 'input_select.stufe', state: '2' }).value).toBe('2');
    expect(toDatapoint({ entity_id: 'input_number.soll', state: '21.5' }).value).toBe(21.5);
    // Rollläden zeigen ihre Stellung, wenn sie eine melden
    expect(toDatapoint({ entity_id: 'cover.rollo', state: 'open', attributes: { current_position: 60 } })).toMatchObject({ value: 60, unit: '%', writable: true });
    expect(toDatapoint({ entity_id: 'cover.tor', state: 'closed' })).toMatchObject({ value: 0, unit: '%' });
    expect(toDatapoint({ entity_id: 'cover.tor', state: 'opening' }).value).toBe('opening');
    // Nicht verfügbar: kein Wert, als veraltet gekennzeichnet
    for (const state of ['unavailable', 'unknown']) expect(toDatapoint({ entity_id: 'sensor.weg', state, attributes: { unit_of_measurement: 'W' } }), state).toMatchObject({ value: null, quality: 'stale', unit: 'W' });
  });

  it('werden über den passenden Dienst geschaltet', () => {
    expect(toService('light.kueche', true)).toEqual({ domain: 'homeassistant', service: 'turn_on', data: { entity_id: 'light.kueche' } });
    expect(toService('switch.a', false)).toMatchObject({ service: 'turn_off' });
    expect(toService('cover.rollo', 'up')).toEqual({ domain: 'cover', service: 'open_cover', data: { entity_id: 'cover.rollo' } });
    expect(toService('cover.rollo', 'down')).toMatchObject({ service: 'close_cover' });
    expect(toService('cover.rollo', 'stop')).toMatchObject({ service: 'stop_cover' });
    expect(toService('cover.rollo', 40.4)).toEqual({ domain: 'cover', service: 'set_cover_position', data: { entity_id: 'cover.rollo', position: 40 } });
    expect(toService('input_number.soll', '22')).toEqual({ domain: 'input_number', service: 'set_value', data: { entity_id: 'input_number.soll', value: 22 } });
    expect(toService('input_select.modus', 'Urlaub')).toEqual({ domain: 'input_select', service: 'select_option', data: { entity_id: 'input_select.modus', option: 'Urlaub' } });
    expect(toService('input_text.notiz', 'Hallo')).toMatchObject({ service: 'set_value', data: { value: 'Hallo' } });
    for (const [id, value] of [['light.a', 'hell'], ['cover.a', 120], ['cover.a', 'weit'], ['input_number.a', 'viel'], ['input_select.a', 3], ['sensor.a', 1], ['person.a', true]] as const) expect(() => toService(id, value), `${id} ${value}`).toThrow(InvalidInput);
  });

  it('liefern ihren Verlauf als Zeit und Zahl', () => {
    expect(toSeries([[{ state: '10.5', last_changed: '2026-10-11T10:00:00+00:00' }, { state: 'unavailable', last_changed: '2026-10-11T10:01:00+00:00' }, { state: 'on', last_updated: '2026-10-11T10:02:00+00:00' }, { state: '', last_changed: '2026-10-11T10:03:00+00:00' }, { state: '3' }]])).toEqual([
      [Date.parse('2026-10-11T10:00:00Z'), 10.5],
      [Date.parse('2026-10-11T10:02:00Z'), 1],
    ]);
    for (const empty of [[], [[]], null, 'nichts']) expect(toSeries(empty)).toEqual([]);
  });
});

describe('Konfiguration des Konnektors', () => {
  it('verlangt die Adresse und nimmt eine Auswahl', () => {
    expect(plugin.parseConfig!({ url: 'http://ha.local:8123/' })).toEqual({ url: 'http://ha.local:8123' });
    expect(plugin.parseConfig!({ url: 'https://ha', entities: ['light.kueche'], domains: ['sensor'] })).toEqual({ url: 'https://ha', entities: ['light.kueche'], domains: ['sensor'] });
    const bad: [unknown, RegExp][] = [[{}, /"url"/], [{ url: 'ha.local' }, /"url"/], [{ url: 'http://ha', entities: 'light.a' }, /"entities"/], [{ url: 'http://ha', entities: ['Licht'] }, /"entities"/], [{ url: 'http://ha', domains: ['sensor.x'] }, /"domains"/]];
    for (const [raw, message] of bad) expect(() => plugin.parseConfig!(raw), JSON.stringify(raw)).toThrow(message);
  });
});

describe('Konnektor an Home Assistant', () => {
  let ha: StandIn;
  const stops: AbortController[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop.abort();
    await ha?.close();
  });

  function start(config: Record<string, unknown> = {}, secrets?: Record<string, string>) {
    const datapoints = new Map<string, DatapointUpdate>();
    const warnings: string[] = [];
    let command: ((id: string, value: DatapointValue) => Promise<void>) | undefined;
    let history: ((id: string, from: Date, to: Date) => Promise<SeriesPoint[]>) | undefined;
    const stop = new AbortController();
    stops.push(stop);
    const given = secrets ?? { token: ha.token };
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'ha',
      config: plugin.parseConfig!({ url: ha.url, ...config }),
      log: { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined },
      secrets: { get: (key) => given[key] },
      storageDir: '',
      datapoints: { set: (update) => void datapoints.set(update.id, update), list: () => [], shown: () => [] },
      actions: { register: () => undefined, list: () => [], run: async () => undefined },
      resources: { set: () => undefined },
      routes: { get: () => undefined, post: () => undefined },
      onCommand: (handler) => void (command = handler),
      provideHistory: (handler) => void (history = handler),
      signal: stop.signal,
    };
    void plugin.start!(context);
    const value = (id: string) => datapoints.get(id)?.value;
    return { datapoints, warnings, value, command: (id: string, to: DatapointValue) => command!(id, to), history: (id: string, from: Date, to: Date) => history!(id, from, to) };
  }

  async function until(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Nicht eingetreten: ${what}`);
      await new Promise((resume) => setTimeout(resume, 20));
    }
  }

  it('übernimmt den Stand aller verstandenen Geräte', async () => {
    ha = await startStandIn();
    const home = start();
    await until(() => home.value('state') === 'ok' && home.datapoints.size > 5, 'eingelesen');
    expect(home.datapoints.get('sensor.aussen_temperatur')).toMatchObject({ value: 12.3, unit: '°C', label: 'Außentemperatur', writable: false });
    expect(home.datapoints.get('light.kueche')).toMatchObject({ value: false, label: 'Küchenlicht', writable: true });
    expect(home.datapoints.get('cover.wohnzimmer')).toMatchObject({ value: 60, unit: '%' });
    expect(home.datapoints.get('sensor.kaputt')).toMatchObject({ value: null, quality: 'stale' });
    expect(home.value('person.anna')).toBe('home');
    // Lautsprecher und Türschloss bleiben draußen
    expect([...home.datapoints.keys()].filter((id) => /media_player|lock/.test(id))).toEqual([]);
    expect(home.warnings).toEqual([]);
  });

  it('folgt Änderungen sofort und schaltet über Dienste', async () => {
    ha = await startStandIn();
    const home = start();
    await until(() => home.value('light.kueche') === false, 'eingelesen');

    ha.set('sensor.aussen_temperatur', '9.8');
    await until(() => home.value('sensor.aussen_temperatur') === 9.8, 'neuer Messwert');

    await home.command('light.kueche', true);
    expect(ha.called.at(-1)).toEqual({ domain: 'homeassistant', service: 'turn_on', data: { entity_id: 'light.kueche' } });
    await until(() => home.value('light.kueche') === true, 'Licht meldet ein');
    await home.command('cover.wohnzimmer', 'down');
    await until(() => home.value('cover.wohnzimmer') === 0, 'Rollladen zu');
    await home.command('cover.wohnzimmer', 35);
    await until(() => home.value('cover.wohnzimmer') === 35, 'Rollladen auf 35 %');
    await home.command('input_number.solltemperatur', 22);
    await until(() => home.value('input_number.solltemperatur') === 22, 'Solltemperatur');
    await home.command('input_select.modus', 'Urlaub');
    await until(() => home.value('input_select.modus') === 'Urlaub', 'Auswahl');

    // Was Home Assistant ablehnt oder Culinola nicht setzen kann, ist ein Fehler des Aufrufers
    await expect(home.command('input_select.modus', 'Mond')).rejects.toThrow(/Home Assistant lehnt ab/);
    await expect(home.command('sensor.strom', 1)).rejects.toBeInstanceOf(InvalidInput);
    await expect(home.command('light.gibt_es_nicht', true)).rejects.toBeInstanceOf(InvalidInput);
    await expect(home.command('lock.haustuer', true)).rejects.toBeInstanceOf(InvalidInput);

    // Ein Gerät fällt aus, eines wird entfernt, eines kommt dazu
    ha.set('sensor.strom', 'unavailable');
    await until(() => home.datapoints.get('sensor.strom')!.quality === 'stale', 'als veraltet gemeldet');
    ha.set('sensor.waschmaschine', null);
    await until(() => home.value('sensor.waschmaschine') === null, 'entfernt');
    ha.set('sensor.neu', '5', { friendly_name: 'Neu', unit_of_measurement: 'l' });
    await until(() => home.value('sensor.neu') === 5, 'neues Gerät');
  });

  it('übernimmt nur die Auswahl aus der Konfiguration und meldet, was fehlt', async () => {
    ha = await startStandIn();
    const home = start({ entities: ['light.kueche', 'lock.haustuer', 'sensor.gibt_es_nicht'] });
    await until(() => home.value('light.kueche') === false && home.warnings.length > 0, 'eingelesen');
    expect([...home.datapoints.keys()].sort()).toEqual(['light.kueche', 'lock.haustuer', 'state']);
    expect(home.warnings[0]).toMatch(/nicht gefunden: sensor\.gibt_es_nicht/);
  });

  it('liefert den Verlauf aus der Aufzeichnung', async () => {
    ha = await startStandIn();
    const home = start();
    await until(() => home.value('state') === 'ok', 'verbunden');
    const from = new Date('2026-10-11T08:00:00Z');
    expect(await home.history('sensor.aussen_temperatur', from, new Date('2026-10-11T10:00:00Z'))).toEqual([
      [from.getTime() + 60_000, 10.5],
      [from.getTime() + 180_000, 11],
    ]);
    expect(await home.history('sensor.gibt_es_nicht', from, new Date())).toEqual([]);
  });

  it('verbindet sich nach einem Abbruch neu und holt den Stand nach', async () => {
    ha = await startStandIn();
    const home = start();
    await until(() => home.value('light.kueche') === false, 'eingelesen');
    ha.dropClients();
    await until(() => home.value('state') === 'offline', 'Abbruch bemerkt');
    await expect(home.command('light.kueche', true)).rejects.toThrow(/nicht erreichbar/);
    // Diese Änderung fällt in die Lücke
    ha.set('sensor.aussen_temperatur', '7');
    await until(() => ha.logins() === 2 && home.value('sensor.aussen_temperatur') === 7, 'neu verbunden, Stand nachgeholt');
  }, 15_000);

  it('sagt, wenn das Token fehlt oder abgelehnt wird', async () => {
    ha = await startStandIn();
    const without = start({}, {});
    expect(without.value('state')).toBe('login');
    expect(without.warnings[0]).toMatch(/"ha": \{ "token"/);
    const wrong = start({}, { token: 'falsch' });
    await until(() => wrong.warnings.length > 0, 'Ablehnung bemerkt');
    expect([wrong.value('state'), wrong.warnings[0]]).toEqual(['login', expect.stringMatching(/lehnt das Zugangstoken ab/)]);
    expect(ha.logins()).toBe(0);
  });
});
