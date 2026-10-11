import { type DatapointUpdate, type DatapointValue, InvalidInput, type PluginContext } from '@culinola/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import plugin from './index.ts';
import { channelsFrom, descriptionKey, fromText, paramsFrom, parseNames, parseValues, pointId, pointsOf, toRpc, toValue } from './model.ts';
import { startStandIn, type StandIn } from './standin.ts';
import { decodeBytes, decodeCall, decodeResponse, encodeCall, encodeFault, encodeResponse, RpcDouble, RpcFault } from './xmlrpc.ts';

describe('XML-RPC', () => {
  it('schreibt Aufrufe mit der Art jedes Werts', () => {
    expect(encodeCall('setValue', ['NEQ1:1', 'STATE', true])).toBe(
      '<?xml version="1.0"?><methodCall><methodName>setValue</methodName><params><param><value><string>NEQ1:1</string></value></param><param><value><string>STATE</string></value></param><param><value><boolean>1</boolean></value></param></params></methodCall>',
    );
    // Die Zentrale unterscheidet ganze Zahlen und Kommazahlen – 1 als Stellung muss als Kommazahl reisen
    expect(encodeCall('x', [1, 0.5, new RpcDouble(1), 'a<b&c'])).toContain('<i4>1</i4></value></param><param><value><double>0.5</double></value></param><param><value><double>1</double></value></param><param><value><string>a&lt;b&amp;c</string>');
    expect(encodeCall('ping')).toContain('<params></params>');
  });

  it('liest, was es selbst schreibt', () => {
    const value = { name: 'Küche <1>', liste: [1, 2.5, true, 'x', { tief: [] }], leer: {} };
    expect(decodeResponse(encodeResponse(value))).toEqual(value);
    expect(decodeCall(encodeCall('event', ['id', 'NEQ1:1', 'STATE', false]))).toEqual({ method: 'event', params: ['id', 'NEQ1:1', 'STATE', false] });
    expect(decodeCall(encodeCall('system.multicall', [[{ methodName: 'event', params: ['id', 'A:1', 'LEVEL', new RpcDouble(1) as never] }]]))).toEqual({ method: 'system.multicall', params: [[{ methodName: 'event', params: ['id', 'A:1', 'LEVEL', 1] }]] });
  });

  it('liest die Schreibweisen der Zentrale', () => {
    // Text ohne Angabe der Art, Zeilenumbrüche zwischen den Elementen, leere Elemente – so antwortet die klassische Schnittstelle
    const classic = `<?xml version="1.0" encoding="iso-8859-1"?>\n<methodResponse><params><param>\n<value><array><data><value><struct><member><name>ADDRESS</name><value>NEQ0370539:1</value></member><member><name>VERSION</name><value><i4>8</i4></value></member><member><name>PARAMSETS</name><value><array><data><value>MASTER</value><value>VALUES</value></data></array></value></member><member><name>UNIT</name><value></value></member><member><name>LEER</name><value><string/></value></member></struct></value></data></array></value>\n</param></params></methodResponse>\n`;
    expect(decodeResponse(classic)).toEqual([{ ADDRESS: 'NEQ0370539:1', VERSION: 8, PARAMSETS: ['MASTER', 'VALUES'], UNIT: '', LEER: '' }]);
    // Die IP-Schnittstelle setzt einfache Anführungszeichen und schreibt alles in eine Zeile
    expect(decodeResponse("<?xml version='1.0' encoding='ISO-8859-1'?><methodResponse><params><param><value><double>21.5</double></value></param></params></methodResponse>")).toBe(21.5);
    expect(decodeResponse('<methodResponse><params><param><value><int>-3</int></value></param></params></methodResponse>')).toBe(-3);
    expect(decodeResponse('<methodResponse><params><param><value>&#176;C &amp; &lt;mehr&gt;</value></param></params></methodResponse>')).toBe('°C & <mehr>');
    // Eine leere Antwort heißt „erledigt“
    expect(decodeResponse('<?xml version="1.0"?><methodResponse><params></params></methodResponse>')).toBe('');
    expect(decodeResponse('<methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>')).toEqual([]);
    expect(decodeResponse('<methodResponse><params><param><value><struct></struct></value></param></params></methodResponse>')).toEqual({});
  });

  it('macht aus einem gemeldeten Fehler eine Ausnahme und liest ISO-8859-1', () => {
    const fault = (() => {
      try {
        return decodeResponse(encodeFault(-2, 'Unknown instance'));
      } catch (error) {
        return error;
      }
    })();
    expect(fault).toBeInstanceOf(RpcFault);
    expect(fault).toMatchObject({ code: -2, message: 'Unknown instance' });
    expect(() => decodeResponse('<html>Fehler</html>')).toThrow(/methodResponse/);
    expect(() => decodeResponse('<methodResponse><params><param><value><i4>viel</i4></value></param></params></methodResponse>')).toThrow(/keine Zahl/);
    expect(decodeBytes(Buffer.from('<?xml version="1.0" encoding="iso-8859-1"?><a>22 °C</a>', 'latin1'))).toContain('22 °C');
    expect(decodeBytes(Buffer.from('<?xml version="1.0"?><a>Küche</a>', 'utf8'))).toContain('Küche');
  });
});

describe('Geräte und Werte der Zentrale', () => {
  const devices = [
    { ADDRESS: 'NEQ1', TYPE: 'HM-LC-Sw1-DR', PARAMSETS: ['MASTER'] },
    { ADDRESS: 'NEQ1:0', TYPE: 'MAINTENANCE', PARENT_TYPE: 'HM-LC-Sw1-DR', VERSION: 8, PARAMSETS: ['MASTER', 'VALUES'] },
    { ADDRESS: 'NEQ1:1', TYPE: 'SWITCH', PARENT_TYPE: 'HM-LC-Sw1-DR', VERSION: 8, PARAMSETS: ['LINK', 'MASTER', 'VALUES'] },
    { ADDRESS: 'NEQ2:1', TYPE: 'SWITCH', PARENT_TYPE: 'HM-LC-Sw1-DR', VERSION: 8, PARAMSETS: ['VALUES'] },
    { ADDRESS: 'NEQ3:1', TYPE: 'KEY', PARENT_TYPE: 'HM-RC-4', VERSION: 1, PARAMSETS: ['MASTER'] },
    'unsinn',
  ];
  const description = {
    STATE: { TYPE: 'BOOL', OPERATIONS: 7, UNIT: '' },
    WORKING: { TYPE: 'BOOL', OPERATIONS: 5, UNIT: '' },
    INSTALL_TEST: { TYPE: 'ACTION', OPERATIONS: 2, UNIT: '' },
    ON_TIME: { TYPE: 'FLOAT', OPERATIONS: 2, UNIT: 's' },
    LEVEL: { TYPE: 'FLOAT', OPERATIONS: 7, UNIT: '100%' },
    MODE: { TYPE: 'ENUM', OPERATIONS: 7, UNIT: '', VALUE_LIST: ['AUTO', 'MANU'] },
  };

  it('übernimmt die Kanäle, die Werte führen', () => {
    const channels = channelsFrom(devices);
    expect(channels.map((channel) => channel.address)).toEqual(['NEQ1:0', 'NEQ1:1', 'NEQ2:1']);
    expect(channels[1]).toEqual({ address: 'NEQ1:1', type: 'SWITCH', parentType: 'HM-LC-Sw1-DR', version: 8 });
    // Gleiche Kanäle teilen sich ihre Beschreibung
    expect(descriptionKey(channels[1]!)).toBe(descriptionKey(channels[2]!));
    expect(descriptionKey(channels[0]!)).not.toBe(descriptionKey(channels[1]!));
    expect(channelsFrom('nichts')).toEqual([]);
  });

  it('macht daraus Datenpunkte mit Namen, Einheit und Schreibbarkeit', () => {
    const points = pointsOf({ address: 'NEQ1:1', type: 'SWITCH', parentType: 'x', version: 1 }, paramsFrom(description), 'Flurlicht');
    // Reine Auslöser und nur schreibbare Werte haben keinen Stand
    expect(points.map((point) => [point.id, point.label, point.writable, point.unit, point.factor])).toEqual([
      ['NEQ1.1.LEVEL', 'Flurlicht', true, '%', 100],
      ['NEQ1.1.MODE', 'Flurlicht MODE', true, undefined, 1],
      ['NEQ1.1.STATE', 'Flurlicht', true, undefined, 1],
      ['NEQ1.1.WORKING', 'Flurlicht WORKING', false, undefined, 1],
    ]);
    expect(pointsOf({ address: 'NEQ1:1', type: 'SWITCH', parentType: 'x', version: 1 }, paramsFrom(description))[2]!.label).toBe('NEQ1:1 STATE');
    expect(pointId('00111A0000BBBB:4', 'LEVEL')).toBe('00111A0000BBBB.4.LEVEL');
    expect(paramsFrom('nichts')).toEqual([]);
  });

  it('rechnet Werte in beide Richtungen um', () => {
    const level = { id: 'a', key: 'LEVEL', type: 'FLOAT', factor: 100 };
    const mode = { id: 'm', key: 'MODE', type: 'ENUM', factor: 1, valueList: ['AUTO', 'MANU'] };
    const state = { id: 's', key: 'STATE', type: 'BOOL', factor: 1 };
    expect(toValue(level, 0.35)).toBe(35);
    expect(toValue(mode, 1)).toBe('MANU');
    expect(toValue(mode, 7)).toBe(7);
    expect(toValue(state, true)).toBe(true);
    expect(toValue(state, 'ja')).toBeUndefined();
    expect(toValue({ type: 'STRING', factor: 1 }, 'frei')).toBe('frei');

    expect(toRpc(state, true)).toEqual({ key: 'STATE', value: true });
    expect(toRpc(level, 35)).toEqual({ key: 'LEVEL', value: new RpcDouble(0.35) });
    // Fahren und Schalten an einer Stellung
    expect(toRpc(level, 'up')).toEqual({ key: 'LEVEL', value: new RpcDouble(1) });
    expect(toRpc(level, 'down')).toEqual({ key: 'LEVEL', value: new RpcDouble(0) });
    expect(toRpc(level, 'stop')).toEqual({ key: 'STOP', value: true });
    expect(toRpc(level, true)).toEqual({ key: 'LEVEL', value: new RpcDouble(1) });
    expect(toRpc(mode, 'MANU')).toEqual({ key: 'MODE', value: 1 });
    expect(toRpc({ id: 'i', key: 'COUNT', type: 'INTEGER', factor: 1 }, '4')).toEqual({ key: 'COUNT', value: 4 });
    for (const [point, value] of [[state, 'vielleicht'], [level, 'weit'], [mode, 'URLAUB'], [state, null]] as const) expect(() => toRpc(point, value), String(value)).toThrow(InvalidInput);
  });

  it('liest den Stand aller Werte aus einer Antwort der Logikschicht', () => {
    const values = parseValues('Anwesenheit\ttrue\r\nBidCos-RF.NEQ1:1.STATE\ttrue\r\nHmIP-RF.0011A:4.LEVEL\t0.500000\r\nBidCos-RF.BidCoS-RF:4.LEVEL\t\r\nAL-NEQ1:0.DEVICE_UNREACH\tfalse\r\nohne Tabulator\r\n<xml><n>X.NEQ9:1.STATE\ttrue</n></xml>');
    expect([...values]).toEqual([['NEQ1.1.STATE', 'true'], ['0011A.4.LEVEL', '0.500000'], ['BidCoS-RF.4.LEVEL', '']]);
    expect(fromText({ type: 'BOOL', factor: 1 }, 'true')).toBe(true);
    expect(fromText({ type: 'BOOL', factor: 1 }, 'false')).toBe(false);
    expect(fromText({ type: 'FLOAT', factor: 100 }, '0.500000')).toBe(50);
    expect(fromText({ type: 'INTEGER', factor: 1 }, '58')).toBe(58);
    expect(fromText({ type: 'ENUM', factor: 1, valueList: ['A', 'B'] }, '1')).toBe('B');
    expect(fromText({ type: 'STRING', factor: 1 }, 'frei')).toBe('frei');
    // Kein Stand und Unlesbares ergeben keinen Wert
    for (const [type, text] of [['FLOAT', ''], ['BOOL', 'vielleicht'], ['INTEGER', 'viel']] as const) expect(fromText({ type, factor: 1 }, text), text).toBeUndefined();
  });

  it('liest die Namen der Kanäle aus der Antwort der Logikschicht', () => {
    const names = parseNames('NEQ1:1\tFlurlicht\r\nNEQ1:0\t Flurlicht:0 \r\nohne\tKanal\r\nNEQ9:1\t\r\n<xml><exec>/tclrega.exe</exec><n>NEQ7:1\tfalsch</n></xml>');
    expect([...names]).toEqual([['NEQ1:1', 'Flurlicht'], ['NEQ1:0', 'Flurlicht:0']]);
  });
});

describe('Konfiguration des Konnektors', () => {
  it('nimmt die Adresse der Zentrale und ihre Gerätefamilien', () => {
    expect(plugin.parseConfig!({ host: '192.168.178.9' })).toEqual({ host: '192.168.178.9', interfaces: [{ name: 'rf', port: 2001 }, { name: 'ip', port: 2010 }], pollSeconds: 5, regaPort: 8181 });
    expect(plugin.parseConfig!({ host: 'ccu', interfaces: ['wired', { name: 'cuxd', port: 8701 }], pollSeconds: 20, regaPort: 0 })).toMatchObject({ interfaces: [{ name: 'wired', port: 2000 }, { name: 'cuxd', port: 8701 }], pollSeconds: 20, regaPort: 0 });
    const bad: [unknown, RegExp][] = [
      [{}, /"host"/],
      [{ host: 'http://ccu' }, /"host"/],
      [{ host: 'ccu', interfaces: [] }, /"interfaces"/],
      [{ host: 'ccu', interfaces: ['funk'] }, /"interfaces"/],
      [{ host: 'ccu', interfaces: [{ name: 'x', port: 0 }] }, /"interfaces"/],
      [{ host: 'ccu', regaPort: 70000 }, /"regaPort"/],
      [{ host: 'ccu', pollSeconds: 0 }, /"pollSeconds"/],
    ];
    for (const [raw, message] of bad) expect(() => plugin.parseConfig!(raw), JSON.stringify(raw)).toThrow(message);
  });
});

describe('Konnektor an der Zentrale', () => {
  let ccu: StandIn;
  const stops: AbortController[] = [];
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop.abort();
    await ccu?.close();
  });

  function start(config: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
    const datapoints = new Map<string, DatapointUpdate>();
    const warnings: string[] = [];
    let command: ((id: string, value: DatapointValue) => Promise<void>) | undefined;
    const stop = new AbortController();
    stops.push(stop);
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'hm',
      // Eine Gerätefamilie am Port des Platzhalters, abgefragt in kurzem Abstand
      config: plugin.parseConfig!({ host: ccu.host, interfaces: [{ name: 'alle', port: ccu.port }], regaPort: ccu.port, pollSeconds: 0.15, ...config }),
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
    const ready = Promise.resolve(plugin.start!(context));
    const value = (id: string) => datapoints.get(id)?.value;
    return { ready, datapoints, warnings, value, stop, command: (id: string, to: DatapointValue) => command!(id, to) };
  }

  async function until(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Nicht eingetreten: ${what}`);
      await new Promise((resume) => setTimeout(resume, 20));
    }
  }

  it('liest Geräte mit Namen, Einheiten und Stand ein', async () => {
    ccu = await startStandIn();
    const hm = start();
    await until(() => hm.value('state') === 'ok', 'eingelesen');
    expect(hm.datapoints.get('NEQ0000001.1.STATE')).toMatchObject({ value: false, label: 'Flurlicht', writable: true });
    expect(hm.datapoints.get('NEQ0000001.1.WORKING')).toMatchObject({ value: false, label: 'Flurlicht WORKING', writable: false });
    expect(hm.datapoints.get('00111A0000BBBB.4.LEVEL')).toMatchObject({ value: 50, unit: '%', label: 'Rollladen Küche', writable: true });
    expect(hm.datapoints.get('00111A0000BBBB.4.ACTIVITY_STATE')).toMatchObject({ value: 'STABLE' });
    expect(hm.datapoints.get('00222B0000CCCC.1.ACTUAL_TEMPERATURE')).toMatchObject({ value: 22.4, unit: '°C', label: 'Thermostat Bad ACTUAL_TEMPERATURE' });
    expect(hm.datapoints.get('00222B0000CCCC.1.HUMIDITY')).toMatchObject({ value: 58, unit: '%' });
    // Auslöser und nur Schreibbares sind keine Datenpunkte
    for (const id of ['NEQ0000001.1.INSTALL_TEST', 'NEQ0000001.1.ON_TIME', '00111A0000BBBB.4.STOP']) expect(hm.datapoints.has(id), id).toBe(false);
    expect(hm.warnings).toEqual([]);
  });

  it('schaltet, fährt und bemerkt Änderungen am Gerät bei der nächsten Abfrage', async () => {
    ccu = await startStandIn();
    const hm = start();
    await until(() => hm.value('state') === 'ok', 'eingelesen');

    await hm.command('NEQ0000001.1.STATE', true);
    expect(ccu.written.at(-1)).toEqual({ address: 'NEQ0000001:1', key: 'STATE', value: true });
    await until(() => hm.value('NEQ0000001.1.STATE') === true, 'neuer Stand des Schalters');

    // Jemand drückt am Gerät
    ccu.set('NEQ0000001:1', 'STATE', false);
    await until(() => hm.value('NEQ0000001.1.STATE') === false, 'Änderung am Gerät');
    ccu.set('00222B0000CCCC:1', 'ACTUAL_TEMPERATURE', 19.5);
    await until(() => hm.value('00222B0000CCCC.1.ACTUAL_TEMPERATURE') === 19.5, 'neue Temperatur');

    await hm.command('00111A0000BBBB.4.LEVEL', 25);
    expect(ccu.written.at(-1)).toEqual({ address: '00111A0000BBBB:4', key: 'LEVEL', value: 0.25 });
    await until(() => hm.value('00111A0000BBBB.4.LEVEL') === 25, 'Rollladen auf 25 %');
    await hm.command('00111A0000BBBB.4.LEVEL', 'up');
    await until(() => hm.value('00111A0000BBBB.4.LEVEL') === 100, 'Rollladen ganz auf');
    await hm.command('00111A0000BBBB.4.LEVEL', 'stop');
    expect(ccu.written.at(-1)).toEqual({ address: '00111A0000BBBB:4', key: 'STOP', value: true });

    await expect(hm.command('NEQ0000001.1.WORKING', true)).rejects.toBeInstanceOf(InvalidInput);
    await expect(hm.command('gibt.es.nicht', true)).rejects.toBeInstanceOf(InvalidInput);
    await expect(hm.command('NEQ0000001.1.STATE', 'vielleicht')).rejects.toBeInstanceOf(InvalidInput);
  });

  it('liest nach dem Schalten sofort nach, statt auf die nächste Abfrage zu warten', async () => {
    ccu = await startStandIn();
    const hm = start({ pollSeconds: 600 });
    await until(() => hm.value('state') === 'ok', 'eingelesen');
    const before = ccu.calls.get('getParamset') ?? 0;
    await hm.command('NEQ0000001.1.STATE', true);
    await until(() => hm.value('NEQ0000001.1.STATE') === true, 'neuer Stand ohne Warten');
    // Nachgelesen wird nur der eine Kanal
    expect((ccu.calls.get('getParamset') ?? 0) - before).toBeLessThanOrEqual(2);
  });

  it('meldet sich nie bei der Zentrale für Meldungen an', async () => {
    ccu = await startStandIn();
    const hm = start();
    await until(() => hm.value('state') === 'ok' && (ccu.calls.get('rega') ?? 0) > 10, 'mehrere Abfragen');
    await hm.command('NEQ0000001.1.STATE', true);
    await until(() => (ccu.calls.get('getParamset') ?? 0) >= 1, 'Nachlesen nach dem Schalten');
    // Nur diese Aufrufe benutzt der Konnektor – keiner davon lässt die Zentrale eine Verbindung zurück aufbauen
    expect([...ccu.calls.keys()].sort()).toEqual(['getParamset', 'getParamsetDescription', 'listDevices', 'rega', 'setValue']);
    expect(ccu.registrations()).toBe(0);
  });

  it('fragt Kanal für Kanal ab, wenn die Logikschicht nicht antwortet', async () => {
    ccu = await startStandIn();
    ccu.setRegaDown(true);
    const hm = start();
    await until(() => hm.value('state') === 'ok', 'eingelesen');
    expect(hm.warnings.join(' ')).toMatch(/Namen der Kanäle ließen sich nicht lesen/);
    expect(hm.warnings.join(' ')).toMatch(/fragt Kanal für Kanal ab/);
    // Ohne Namen heißen die Datenpunkte nach ihrer Adresse; die Werte stimmen trotzdem
    expect(hm.datapoints.get('NEQ0000001.1.STATE')).toMatchObject({ value: false, label: 'NEQ0000001:1 STATE' });
    expect(hm.datapoints.get('00111A0000BBBB.4.LEVEL')).toMatchObject({ value: 50, unit: '%' });
    await hm.command('NEQ0000001.1.STATE', true);
    await until(() => hm.value('NEQ0000001.1.STATE') === true, 'neuer Stand über die Geräteschnittstelle');
    expect(ccu.registrations()).toBe(0);
  });

  it('zeigt die Werte eines unerreichbaren Geräts als veraltet', async () => {
    ccu = await startStandIn();
    const hm = start();
    await until(() => hm.value('state') === 'ok', 'eingelesen');
    ccu.set('NEQ0000001:0', 'UNREACH', true);
    await until(() => hm.datapoints.get('NEQ0000001.1.STATE')!.quality === 'stale', 'als veraltet gemeldet');
    expect(hm.datapoints.get('00111A0000BBBB.4.LEVEL')!.quality).toBeUndefined();
    ccu.set('NEQ0000001:0', 'UNREACH', false);
    await until(() => hm.datapoints.get('NEQ0000001.1.STATE')!.quality === undefined, 'wieder erreichbar');
  });

  it('übersteht einen Ausfall der Zentrale und liest danach weiter', async () => {
    ccu = await startStandIn();
    const hm = start();
    await until(() => hm.value('state') === 'ok', 'eingelesen');
    ccu.setDown(true);
    await until(() => hm.value('state') === 'offline', 'Ausfall bemerkt');
    expect(hm.warnings.join(' ')).toMatch(/nicht erreichbar/);
    // Die letzten Werte bleiben stehen
    expect(hm.value('00222B0000CCCC.1.HUMIDITY')).toBe(58);
    ccu.set('00222B0000CCCC:1', 'HUMIDITY', 61);
    ccu.setDown(false);
    await until(() => hm.value('state') === 'ok' && hm.value('00222B0000CCCC.1.HUMIDITY') === 61, 'wieder verbunden');
  }, 15_000);

  it('sagt, wenn die Zentrale nicht erreichbar ist oder eine Anmeldung verlangt, und versucht es weiter', async () => {
    ccu = await startStandIn();
    ccu.requireLogin('kueche', 'geheim-nur-im-test');
    const refused = start({ regaPort: 0 });
    await until(() => refused.value('state') === 'login', 'Anmeldung verlangt');
    expect(refused.warnings.join(' ')).toMatch(/verlangt eine Anmeldung.*"hm"/);
    const allowed = start({ regaPort: 0 }, { username: 'kueche', password: 'geheim-nur-im-test' });
    await until(() => allowed.value('state') === 'ok', 'mit Anmeldung eingelesen');

    const away = start({ host: '127.0.0.1', interfaces: [{ name: 'alle', port: 9 }], regaPort: 0 });
    await until(() => away.value('state') === 'offline' && away.warnings.length > 0, 'nicht erreichbar gemeldet');
    expect(away.warnings[0]).toMatch(/nicht erreichbar/);
  });
});
