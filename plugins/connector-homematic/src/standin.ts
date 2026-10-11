import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeCall, encodeFault, encodeResponse, type RpcValue } from './xmlrpc.ts';

/**
 * Ein Platzhalter für eine Homematic-Zentrale, nur für Tests und die Testinstanz: Er beantwortet die Aufrufe,
 * die der Konnektor benutzt – Geräteliste, Beschreibungen, Werte, Setzen. Drei erfundene Geräte: ein Schalter, ein Rollladen, ein Wandthermostat.
 * Die Namen liefert er unter derselben Adresse, unter der die echte Zentrale ihre Logikschicht anbietet.
 */
export interface StandIn {
  host: string;
  port: number;
  /** Ändert einen Wert, als hätte jemand am Gerät gedrückt. */
  set(address: string, key: string, value: RpcValue): void;
  /** Wie oft sich jemand für Meldungen angemeldet hat – der Konnektor darf das nie tun. */
  registrations(): number;
  /** Zählt die Aufrufe je Art. */
  calls: Map<string, number>;
  /** Stellt sich tot, wie eine Zentrale ohne Strom. */
  setDown(down: boolean): void;
  /** Lässt nur die Logikschicht ausfallen; die Geräteschnittstelle antwortet weiter. */
  setRegaDown(down: boolean): void;
  /** Die Aufrufe zum Setzen, in der Reihenfolge des Eintreffens. */
  written: { address: string; key: string; value: RpcValue }[];
  /** Verlangt ab jetzt Benutzer und Kennwort. */
  requireLogin(username: string, password: string): void;
  close(): Promise<void>;
}

const param = (type: string, operations: number, extra: Record<string, RpcValue> = {}): RpcValue => ({ TYPE: type, OPERATIONS: operations, UNIT: '', ...extra });
const MAINTENANCE: Record<string, RpcValue> = { UNREACH: param('BOOL', 5), LOWBAT: param('BOOL', 5), RSSI_DEVICE: param('INTEGER', 5, { UNIT: 'dBm' }) };

/** Die Geräteliste: je Gerät ein Eintrag ohne Kanalnummer und seine Kanäle. */
const DEVICES: { address: string; type: string; parent: string; version: number; name: string; description: Record<string, RpcValue>; values: Record<string, RpcValue> }[] = [
  { address: 'NEQ0000001:0', type: 'MAINTENANCE', parent: 'HM-LC-Sw1-DR', version: 8, name: 'Flurlicht:0', description: MAINTENANCE, values: { UNREACH: false, LOWBAT: false, RSSI_DEVICE: -61 } },
  {
    address: 'NEQ0000001:1',
    type: 'SWITCH',
    parent: 'HM-LC-Sw1-DR',
    version: 8,
    name: 'Flurlicht',
    description: { STATE: param('BOOL', 7), WORKING: param('BOOL', 5), INHIBIT: param('BOOL', 7), INSTALL_TEST: param('ACTION', 2), ON_TIME: param('FLOAT', 2, { UNIT: 's' }) },
    values: { STATE: false, WORKING: false, INHIBIT: false },
  },
  { address: '00111A0000BBBB:0', type: 'MAINTENANCE', parent: 'HmIP-BROLL', version: 3, name: 'Rollladen Küche:0', description: MAINTENANCE, values: { UNREACH: false, LOWBAT: false, RSSI_DEVICE: -70 } },
  {
    address: '00111A0000BBBB:4',
    type: 'SHUTTER_VIRTUAL_RECEIVER',
    parent: 'HmIP-BROLL',
    version: 3,
    name: 'Rollladen Küche',
    description: { LEVEL: param('FLOAT', 7, { UNIT: '100%' }), STOP: param('ACTION', 2), ACTIVITY_STATE: param('ENUM', 5, { VALUE_LIST: ['UNKNOWN', 'UP', 'DOWN', 'STABLE'] }) },
    values: { LEVEL: 0.5, ACTIVITY_STATE: 3 },
  },
  { address: '00222B0000CCCC:0', type: 'MAINTENANCE', parent: 'HmIP-WTH-2', version: 2, name: 'Thermostat Bad:0', description: MAINTENANCE, values: { UNREACH: false, LOWBAT: false, RSSI_DEVICE: -55 } },
  {
    address: '00222B0000CCCC:1',
    type: 'HEATING_CLIMATECONTROL_TRANSCEIVER',
    parent: 'HmIP-WTH-2',
    version: 2,
    name: 'Thermostat Bad',
    description: { ACTUAL_TEMPERATURE: param('FLOAT', 5, { UNIT: '°C' }), HUMIDITY: param('INTEGER', 5, { UNIT: '%' }), SET_POINT_TEMPERATURE: param('FLOAT', 7, { UNIT: '°C' }) },
    values: { ACTUAL_TEMPERATURE: 22.4, HUMIDITY: 58, SET_POINT_TEMPERATURE: 21 },
  },
];

export async function startStandIn(port = 0): Promise<StandIn> {
  const values = new Map(DEVICES.map((entry) => [entry.address, { ...entry.values }]));
  const calls = new Map<string, number>();
  let down = false;
  let regaDown = false;
  const written: StandIn['written'] = [];
  let registrations = 0;
  let login: string | undefined;

  const answer = (method: string, params: RpcValue[]): RpcValue => {
    const channel = DEVICES.find((entry) => entry.address === params[0]);
    switch (method) {
      case 'listDevices': {
        const parents = [...new Set(DEVICES.map((entry) => entry.address.split(':')[0]!))];
        return [
          ...parents.map((address) => ({ ADDRESS: address, TYPE: DEVICES.find((entry) => entry.address.startsWith(address))!.parent, PARAMSETS: ['MASTER'], CHILDREN: DEVICES.filter((entry) => entry.address.startsWith(address)).map((entry) => entry.address) })),
          ...DEVICES.map((entry) => ({ ADDRESS: entry.address, TYPE: entry.type, PARENT: entry.address.split(':')[0]!, PARENT_TYPE: entry.parent, VERSION: entry.version, PARAMSETS: ['MASTER', 'VALUES'] })),
        ];
      }
      case 'getParamsetDescription':
        if (!channel) throw new Fault(-2, 'Unknown instance');
        return channel.description;
      case 'getParamset':
        if (!channel) throw new Fault(-2, 'Unknown instance');
        return values.get(channel.address)!;
      case 'getValue':
        if (!channel) throw new Fault(-2, 'Unknown instance');
        return values.get(channel.address)![String(params[1])] ?? '';
      case 'setValue': {
        const key = String(params[1]);
        const described = channel?.description[key] as { TYPE?: string; OPERATIONS?: number } | undefined;
        if (!channel || !described) throw new Fault(-5, 'Unknown parameter');
        if (!((described.OPERATIONS ?? 0) & 2)) throw new Fault(-6, 'Operation not supported');
        written.push({ address: channel.address, key, value: params[2]! });
        if (described.TYPE !== 'ACTION' && key !== 'ON_TIME') values.get(channel.address)![key] = params[2]!;
        return '';
      }
      case 'init':
        if (params[1]) registrations++;
        return '';
      default:
        throw new Fault(-1, `Unknown method ${method}`);
    }
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      // Die Zentrale schreibt in ISO-8859-1 und sagt das in der ersten Zeile
      const send = (body: string, type = 'text/xml') => {
        const bytes = Buffer.from(body.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="iso-8859-1"?>'), 'latin1');
        response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length });
        response.end(bytes);
      };
      if (down) return void request.socket.destroy();
      if (login && request.headers.authorization !== login) return void response.writeHead(401).end();
      if (request.url?.startsWith('/tclrega.exe')) {
        calls.set('rega', (calls.get('rega') ?? 0) + 1);
        if (regaDown) return void response.writeHead(503).end();
        // Der Stand aller Werte, wie ihn die Logikschicht als Text nennt: Wahrheitswerte ausgeschrieben, Kommazahlen sechsstellig
        if (Buffer.concat(chunks).toString('utf8').includes('ID_DATAPOINTS')) {
          const lines = ['Anwesenheit\ttrue', 'AL-NEQ0000001:0.DEVICE_UNREACH\tfalse'];
          for (const entry of DEVICES) {
            for (const [key, value] of Object.entries(values.get(entry.address)!)) {
              const type = (entry.description[key] as { TYPE?: string }).TYPE;
              lines.push(`Platzhalter.${entry.address}.${key}\t${typeof value === 'boolean' ? String(value) : type === 'FLOAT' ? Number(value).toFixed(6) : String(value)}`);
            }
            for (const key of Object.keys(entry.description)) if (!(key in values.get(entry.address)!)) lines.push(`Platzhalter.${entry.address}.${key}\t`);
          }
          return send(`${lines.join('\r\n')}\r\n<xml><exec>/tclrega.exe</exec></xml>`, 'text/plain');
        }
        // Die Namen der Kanäle, wie sie das Namensskript ausgibt, samt dem Anhang der echten Zentrale
        return send(`${DEVICES.map((entry) => `${entry.address}\t${entry.name}`).join('\r\n')}\r\n<xml><exec>/tclrega.exe</exec><sessionId></sessionId></xml>`, 'text/plain');
      }
      try {
        const { method, params } = decodeCall(Buffer.concat(chunks).toString('utf8'));
        calls.set(method, (calls.get(method) ?? 0) + 1);
        send(encodeResponse(answer(method, params)));
      } catch (error) {
        send(encodeFault(error instanceof Fault ? error.code : -1, error instanceof Error ? error.message : String(error)));
      }
    });
  });
  await new Promise<void>((ready) => server.listen(port, '127.0.0.1', ready));

  return {
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    written,
    set: (address, key, value) => void (values.get(address)![key] = value),
    registrations: () => registrations,
    calls,
    setDown: (next) => void (down = next),
    setRegaDown: (next) => void (regaDown = next),
    requireLogin: (username, password) => void (login = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`),
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

class Fault extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
