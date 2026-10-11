import { type DatapointValue, InvalidInput } from '@culinola/sdk';
import { RpcDouble, type RpcValue } from './xmlrpc.ts';

/** Ein Kanal eines Geräts, wie ihn die Zentrale in ihrer Geräteliste führt. */
export interface Channel {
  /** Adresse des Kanals: Seriennummer des Geräts und Kanalnummer, "NEQ0370539:1". */
  address: string;
  /** Art des Kanals ("SWITCH") und des Geräts, zu dem er gehört ("HM-LC-Sw1-DR"). */
  type: string;
  parentType: string;
  version: number;
}

/** Ein Wert eines Kanals laut Beschreibung der Zentrale. */
export interface Param {
  key: string;
  type: string;
  /** Bitfeld: 1 lesbar, 2 schreibbar, 4 meldet Änderungen. */
  operations: number;
  unit?: string;
  /** Bei Auswahlwerten die Texte zu den Zahlen. */
  valueList?: string[];
}

/** Ein Datenpunkt von Culinola, der an einem Wert der Zentrale hängt. */
export interface Point {
  id: string;
  address: string;
  key: string;
  type: string;
  label: string;
  unit?: string;
  /** Faktor zwischen dem Wert der Zentrale und dem gezeigten: Stellungen reisen als 0 bis 1 und heißen hier 0 bis 100 %. */
  factor: number;
  writable: boolean;
  valueList?: string[];
}

/** Die Werte, nach denen ein Kanal heißt: Sie tragen seinen Namen ohne Zusatz. */
const PRIMARY = new Set(['STATE', 'LEVEL']);
const READABLE = 1;
const WRITABLE = 2;
const EVENTS = 4;

const text = (value: RpcValue | undefined) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** Liest aus der Geräteliste die Kanäle, die Werte führen. Geräte selbst und Kanäle ohne Werte bleiben draußen. */
export function channelsFrom(devices: RpcValue): Channel[] {
  if (!Array.isArray(devices)) return [];
  const channels: Channel[] = [];
  for (const entry of devices) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const address = text(entry['ADDRESS']);
    const paramsets = Array.isArray(entry['PARAMSETS']) ? entry['PARAMSETS'].map(text) : [];
    if (!address.includes(':') || !paramsets.includes('VALUES')) continue;
    channels.push({ address, type: text(entry['TYPE']), parentType: text(entry['PARENT_TYPE']), version: Number(entry['VERSION'] ?? 0) || 0 });
  }
  return channels;
}

/** Kanäle gleicher Art haben dieselben Werte – ihre Beschreibung muss nur einmal geholt werden. */
export const descriptionKey = (channel: Channel) => `${channel.parentType}|${channel.type}|${channel.version}`;

/** Liest die Beschreibung der Werte eines Kanals. */
export function paramsFrom(description: RpcValue): Param[] {
  if (!description || typeof description !== 'object' || Array.isArray(description)) return [];
  const params: Param[] = [];
  for (const [key, raw] of Object.entries(description)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const unit = text(raw['UNIT']).trim();
    const list = Array.isArray(raw['VALUE_LIST']) ? raw['VALUE_LIST'].map(text) : undefined;
    params.push({ key, type: text(raw['TYPE']).toUpperCase(), operations: Number(raw['OPERATIONS'] ?? 0) || 0, ...(unit ? { unit } : {}), ...(list?.length ? { valueList: list } : {}) });
  }
  return params.sort((a, b) => a.key.localeCompare(b.key));
}

/** Kennung eines Datenpunkts: Adresse und Name des Werts, "NEQ0370539.1.STATE". */
export const pointId = (address: string, key: string) => `${address}.${key}`.replace(/:/g, '.').replace(/[^\w.-]+/g, '_');

/**
 * Die Datenpunkte eines Kanals. Übernommen wird, was sich lesen lässt oder Änderungen meldet; reine Auslöser
 * (Tastendruck, Testlauf) haben keinen Stand und bleiben draußen. `name` ist der Name des Kanals in der Zentrale.
 */
export function pointsOf(channel: Channel, params: Param[], name?: string): Point[] {
  return params
    .filter((param) => param.type !== 'ACTION' && (param.operations & (READABLE | EVENTS)) !== 0)
    .map((param) => {
      // "100%" ist die Schreibweise der Zentrale für Werte von 0 bis 1, die als Prozent gemeint sind
      const percent = param.unit === '100%';
      const unit = percent ? '%' : param.unit;
      const base = name?.trim() || channel.address;
      return {
        id: pointId(channel.address, param.key),
        address: channel.address,
        key: param.key,
        type: param.type,
        label: PRIMARY.has(param.key) && name?.trim() ? base : `${base} ${param.key}`,
        factor: percent ? 100 : 1,
        writable: (param.operations & WRITABLE) !== 0,
        ...(unit ? { unit } : {}),
        ...(param.valueList ? { valueList: param.valueList } : {}),
      };
    });
}

/** Ein Wert der Zentrale, wie Culinola ihn zeigt. Was sich nicht deuten lässt, ergibt `undefined`. */
export function toValue(point: Pick<Point, 'type' | 'factor' | 'valueList'>, raw: RpcValue): DatapointValue | undefined {
  if (point.type === 'BOOL') return typeof raw === 'boolean' ? raw : typeof raw === 'number' ? raw !== 0 : undefined;
  if (point.type === 'ENUM') return typeof raw === 'number' ? (point.valueList?.[raw] ?? raw) : typeof raw === 'string' ? raw : undefined;
  if (point.type === 'FLOAT' || point.type === 'INTEGER') return typeof raw === 'number' ? Math.round(raw * point.factor * 1e6) / 1e6 : undefined;
  return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : undefined;
}

/**
 * Was an die Zentrale geht, wenn ein Datenpunkt gesetzt werden soll: der Name des Werts und der Wert in der
 * Art, die die Zentrale erwartet. Fahren (`up`, `down`, `stop`) gilt für Stellungen: ganz auf, ganz zu, anhalten.
 */
export function toRpc(point: Pick<Point, 'id' | 'key' | 'type' | 'factor' | 'valueList'>, value: DatapointValue): { key: string; value: RpcValue | RpcDouble } {
  const refuse = (): never => {
    throw new InvalidInput(`Der Wert ${JSON.stringify(value)} passt nicht zum Datenpunkt "${point.id}".`);
  };
  if (point.key === 'LEVEL' && typeof value === 'string' && ['up', 'down', 'stop'].includes(value)) {
    return value === 'stop' ? { key: 'STOP', value: true } : { key: 'LEVEL', value: new RpcDouble(value === 'up' ? 1 : 0) };
  }
  if (point.type === 'BOOL') {
    if (typeof value === 'boolean') return { key: point.key, value };
    if (typeof value === 'number') return { key: point.key, value: value !== 0 };
    return refuse();
  }
  if (point.type === 'FLOAT' || point.type === 'INTEGER') {
    // Ein Schalter an einer Stellung: ein ist ganz auf, aus ist ganz zu
    const wanted = typeof value === 'boolean' ? (value ? point.factor : 0) : typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof wanted !== 'number' || !Number.isFinite(wanted)) return refuse();
    const scaled = (wanted as number) / point.factor;
    return { key: point.key, value: point.type === 'FLOAT' ? new RpcDouble(scaled) : Math.round(scaled) };
  }
  if (point.type === 'ENUM') {
    const index = typeof value === 'number' ? value : typeof value === 'string' ? (point.valueList?.indexOf(value) ?? -1) : -1;
    if (!Number.isInteger(index) || index < 0) return refuse();
    return { key: point.key, value: index };
  }
  if (value === null) return refuse();
  return { key: point.key, value: String(value) };
}

/**
 * Das Skript, mit dem die Zentrale die Namen ihrer Kanäle nennt – je Zeile Adresse, Tabulator, Name. Die Namen
 * kennt nur ihre Logikschicht, nicht die Geräteschnittstelle.
 */
export const NAMES_SCRIPT = 'string id; foreach(id, dom.GetObject(ID_CHANNELS).EnumUsedIDs()) { var channel = dom.GetObject(id); if (channel) { WriteLine(channel.Address() # "\\t" # channel.Name()); } }';

/** Liest die Antwort auf das Skript; hinter den Zeilen hängt die Zentrale einen XML-Anhang an, der nicht dazugehört. */
export function parseNames(output: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const line of output.split('<xml>')[0]!.split(/\r?\n/)) {
    const [address, name] = line.split('\t');
    if (address?.includes(':') && name?.trim()) names.set(address.trim(), name.trim());
  }
  return names;
}

/**
 * Das Skript, mit dem die Zentrale den Stand aller Werte in einem Zug nennt – je Zeile "Schnittstelle.Adresse.Wert",
 * Tabulator, Stand. Ihre Logikschicht führt den Stand ohnehin mit; das kostet sie einen Bruchteil dessen, was
 * eine Abfrage Kanal für Kanal kostet.
 */
export const VALUES_SCRIPT = 'string id; foreach(id, dom.GetObject(ID_DATAPOINTS).EnumUsedIDs()) { var d = dom.GetObject(id); if (d) { WriteLine(d.Name() # "\\t" # d.Value()); } }';

/** Liest die Antwort: Kennung des Datenpunkts und sein Stand als Text. Systemwerte ohne Geräteadresse bleiben draußen. */
export function parseValues(output: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of output.split('<xml>')[0]!.split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    const name = tab < 0 ? '' : line.slice(0, tab);
    const first = name.indexOf('.');
    const last = name.lastIndexOf('.');
    // "BidCos-RF.NEQ0370539:1.STATE": vorn die Schnittstelle, hinten der Name des Werts, dazwischen die Adresse
    if (first < 0 || last <= first || !name.slice(first + 1, last).includes(':')) continue;
    values.set(pointId(name.slice(first + 1, last), name.slice(last + 1)), line.slice(tab + 1).trim());
  }
  return values;
}

/** Ein Stand, wie ihn die Logikschicht als Text nennt, in der Art des Datenpunkts. Leer heißt: kein Stand. */
export function fromText(point: Pick<Point, 'type' | 'factor' | 'valueList'>, text: string): DatapointValue | undefined {
  if (text === '') return undefined;
  if (point.type === 'BOOL') return text === 'true' ? true : text === 'false' ? false : undefined;
  if (point.type === 'FLOAT' || point.type === 'INTEGER' || point.type === 'ENUM') return Number.isFinite(Number(text)) ? toValue(point, Number(text)) : undefined;
  return text;
}
