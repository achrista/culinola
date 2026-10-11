import type { DatapointValue } from '@culinola/sdk';

/** Ein Datenpunkt, der an einem MQTT-Thema hängt. */
export interface Point {
  /** Kennung ohne Quellpräfix: "co2", "nachtlicht". */
  id: string;
  /** Thema, auf dem der Wert ankommt. */
  topic: string;
  /** Stelle im JSON der Nachricht, etwa "MHZ19B.CarbonDioxide"; ohne Angabe ist die ganze Nachricht der Wert. */
  json?: string[];
  /** Thema, auf das geschaltet wird; ohne Angabe ist der Datenpunkt nur lesbar. */
  command?: string;
  /** Was für „ein“ und „aus“ gesendet und als solches verstanden wird. */
  on: string;
  off: string;
  /** Thema, auf dem das Gerät meldet, ob es erreichbar ist – samt den Worten dafür. */
  availability?: { topic: string; online: string; offline: string };
  label?: string;
  unit?: string;
  /** Erzwingt die Art des Werts; ohne Angabe wird sie aus der Nachricht gelesen. */
  type?: 'number' | 'switch' | 'text';
  /** Ob geschaltete Werte auf dem Broker liegen bleiben sollen (retain). */
  retain?: boolean;
}

const POINT_ID = /^[\w.-]+$/;
const MAX_TEXT_CHARS = 500;

/** Ob ein Thema auf ein Abonnement mit den Platzhaltern + und # passt. */
export function topicMatches(filter: string, topic: string): boolean {
  const wanted = filter.split('/');
  const given = topic.split('/');
  for (let index = 0; index < wanted.length; index++) {
    if (wanted[index] === '#') return true;
    if (index >= given.length || (wanted[index] !== '+' && wanted[index] !== given[index])) return false;
  }
  return wanted.length === given.length;
}

function isTopic(value: unknown, wildcards = false): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 500 && !value.includes('\0') && (wildcards || !/[+#]/.test(value));
}

/** Liest die von Hand eingerichteten Datenpunkte und sagt bei Fehlern, welcher gemeint ist und was fehlt. */
export function parsePoints(raw: unknown): Point[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('"datapoints" muss eine Liste sein: [{ "id": "co2", "topic": "ACLuft/tele/SENSOR", "json": "MHZ19B.CarbonDioxide" }].');
  const seen = new Set<string>();
  return raw.map((entry: unknown, index) => {
    const wish = (entry ?? {}) as Record<string, unknown>;
    const fail = (problem: string): never => {
      throw new Error(`Datenpunkt ${typeof wish['id'] === 'string' ? `"${wish['id']}"` : index + 1}: ${problem}`);
    };
    if (typeof wish['id'] !== 'string' || !POINT_ID.test(wish['id'])) fail('"id" fehlt oder enthält anderes als Buchstaben, Ziffern, Punkt, Strich und Unterstrich.');
    const id = wish['id'] as string;
    if (seen.has(id)) fail('Die Kennung kommt doppelt vor.');
    seen.add(id);
    if (!isTopic(wish['topic'])) fail('"topic" fehlt – das Thema, auf dem der Wert ankommt (ohne die Platzhalter + und #).');
    if (wish['command'] !== undefined && !isTopic(wish['command'])) fail('"command" muss ein Thema sein.');
    if (wish['json'] !== undefined && (typeof wish['json'] !== 'string' || !wish['json'].trim())) fail('"json" nennt die Stelle in der Nachricht, etwa "MHZ19B.CarbonDioxide".');
    for (const key of ['on', 'off', 'label', 'unit'] as const) if (wish[key] !== undefined && typeof wish[key] !== 'string') fail(`"${key}" muss ein Text sein.`);
    if (wish['type'] !== undefined && !['number', 'switch', 'text'].includes(wish['type'] as string)) fail('"type" muss number, switch oder text sein.');
    if (wish['retain'] !== undefined && typeof wish['retain'] !== 'boolean') fail('"retain" muss true oder false sein.');

    let availability: Point['availability'];
    if (wish['availability'] !== undefined) {
      const given = (typeof wish['availability'] === 'string' ? { topic: wish['availability'] } : (wish['availability'] ?? {})) as Record<string, unknown>;
      if (!isTopic(given['topic'])) fail('"availability" ist ein Thema oder { "topic": …, "online": "Online", "offline": "Offline" }.');
      availability = { topic: given['topic'] as string, online: typeof given['online'] === 'string' ? given['online'] : 'Online', offline: typeof given['offline'] === 'string' ? given['offline'] : 'Offline' };
    }
    return {
      id,
      topic: wish['topic'] as string,
      on: (wish['on'] as string | undefined) ?? 'ON',
      off: (wish['off'] as string | undefined) ?? 'OFF',
      ...(typeof wish['json'] === 'string' ? { json: wish['json'].split('.').map((part) => part.trim()) } : {}),
      ...(typeof wish['command'] === 'string' ? { command: wish['command'] } : {}),
      ...(availability ? { availability } : {}),
      ...(typeof wish['label'] === 'string' ? { label: wish['label'] } : {}),
      ...(typeof wish['unit'] === 'string' ? { unit: wish['unit'] } : {}),
      ...(wish['type'] ? { type: wish['type'] as NonNullable<Point['type']> } : {}),
      ...(typeof wish['retain'] === 'boolean' ? { retain: wish['retain'] } : {}),
    };
  });
}

/** Holt eine Stelle aus einem gelesenen JSON; fehlt sie, gibt es keinen Wert. */
function pick(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Liest aus einer Nachricht den Wert eines Datenpunkts. Die Worte für „ein“ und „aus“ werden zum Schalter,
 * Zahlen zu Zahlen, alles andere bleibt Text. Gibt `undefined` zurück, wenn die Nachricht für diesen Datenpunkt
 * nichts enthält – etwa weil das JSON die Stelle diesmal nicht mitbringt.
 */
export function readValue(point: Pick<Point, 'json' | 'on' | 'off' | 'type'>, payload: string): DatapointValue | undefined {
  let raw: unknown = payload;
  if (point.json) {
    try {
      raw = pick(JSON.parse(payload), point.json);
    } catch {
      return undefined;
    }
    if (raw === undefined || raw === null) return undefined;
  }
  if (typeof raw === 'boolean') return point.type === 'text' ? String(raw) : raw;
  if (typeof raw === 'object') return JSON.stringify(raw).slice(0, MAX_TEXT_CHARS);
  const text = String(raw).trim();
  if (point.type !== 'number' && point.type !== 'text') {
    if (text.toLowerCase() === point.on.toLowerCase()) return true;
    if (text.toLowerCase() === point.off.toLowerCase()) return false;
  }
  if (point.type === 'switch') return /^(1|true|on|ein)$/i.test(text) ? true : /^(0|false|off|aus)$/i.test(text) ? false : undefined;
  if (point.type !== 'text' && text !== '' && Number.isFinite(Number(text))) return Number(text);
  if (point.type === 'number') return undefined;
  return text.slice(0, MAX_TEXT_CHARS);
}

/** Was gesendet wird, wenn ein Datenpunkt gesetzt werden soll. */
export function toPayload(point: Pick<Point, 'on' | 'off'>, value: DatapointValue): string {
  if (typeof value === 'boolean') return value ? point.on : point.off;
  if (value === null) return '';
  return String(value);
}

// --- Geräte, die sich selbst anmelden (Muster von Home Assistant, etwa Tasmota) ---

/** Die Kurzformen, die Geräte in ihrer Anmeldung benutzen, und was sie heißen. */
const SHORT: Record<string, string> = {
  stat_t: 'state_topic',
  cmd_t: 'command_topic',
  avty_t: 'availability_topic',
  val_tpl: 'value_template',
  unit_of_meas: 'unit_of_measurement',
  uniq_id: 'unique_id',
  pl_on: 'payload_on',
  pl_off: 'payload_off',
  pl_avail: 'payload_available',
  pl_not_avail: 'payload_not_available',
  stat_on: 'state_on',
  stat_off: 'state_off',
  dev: 'device',
  ret: 'retain',
};
const COMPONENTS = ['sensor', 'binary_sensor', 'switch', 'light'];

/**
 * Liest aus einer Vorlage die Stelle im JSON: `{{value_json.A.B}}` oder `{{value_json['A']['B']}}`. Zusätze, die
 * den Wert nur absichern oder seine Art nennen, ändern daran nichts und werden überlesen: `… if … is defined else …`,
 * `| int`, `| float`, `| default(…)`. Vorlagen, die rechnen oder umformen, versteht Culinola nicht – dann gibt es
 * `undefined`. Eine leere Vorlage oder `{{value}}` meint die ganze Nachricht.
 */
export function templatePath(template: string | undefined): string[] | undefined | 'plain' {
  const text = (template ?? '').trim();
  if (!text || /^\{\{\s*value\s*\}\}$/.test(text)) return 'plain';
  const whole = /^\{\{\s*value_json((?:\.[A-Za-z_][\w-]*|\[\s*(?:'[^']*'|"[^"]*")\s*\])+)\s*(.*?)\s*\}\}$/.exec(text);
  if (!whole) return undefined;
  const [, inner = '', rest = ''] = whole;
  // Erlaubt ist danach nur, was den Wert nicht verändert – und die Absicherung muss dieselbe Stelle meinen
  const literal = String.raw`(?:'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|none|None|true|false|True|False)`;
  const filters = String.raw`(?:\s*\|\s*(?:int|float|default\(\s*${literal}\s*\)))*`;
  const guard = new RegExp(String.raw`^(${filters})\s*(?:if\s+value_json(\S+)\s+is\s+defined\s+else\s+${literal})?$`).exec(rest);
  if (!guard || (guard[2] !== undefined && guard[2] !== inner)) return undefined;
  return [...inner.matchAll(/\.([A-Za-z_][\w-]*)|\[\s*(?:'([^']*)'|"([^"]*)")\s*\]/g)].map((part) => part[1] ?? part[2] ?? part[3] ?? '');
}

export type Discovered = { point: Point } | { skipped: string } | { removed: string } | undefined;

/**
 * Deutet die Anmeldung eines Geräts: Thema `<Präfix>/<Art>/…/config`, Nachricht ein JSON mit Themen und
 * Bezeichnung. Liefert den Datenpunkt, den Grund, warum er übergangen wird, oder – bei leerer Nachricht – die
 * Kennung des Datenpunkts, den das Gerät abmeldet. Was keine Anmeldung ist, ergibt nichts.
 */
export function discover(prefix: string, topic: string, payload: string): Discovered {
  const parts = topic.split('/');
  const base = prefix.split('/').length;
  if (!topic.startsWith(`${prefix}/`) || parts.at(-1) !== 'config' || parts.length < base + 3) return undefined;
  const component = parts[base]!;
  // Ohne eigene Kennung gilt der Platz im Thema – der bleibt auch bei einer Abmeldung derselbe
  const fromTopic = parts.slice(base + 1, -1).join('_');
  const idOf = (unique: unknown) => (typeof unique === 'string' && unique ? unique : fromTopic).replace(/[^\w.-]+/g, '_').slice(0, 120);
  if (!payload.trim()) return { removed: idOf(undefined) };
  if (!COMPONENTS.includes(component)) return { skipped: `Art "${component}" wird nicht unterstützt` };

  let given: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { skipped: 'Anmeldung ist kein JSON-Objekt' };
    given = parsed as Record<string, unknown>;
  } catch {
    return { skipped: 'Anmeldung ist kein lesbares JSON' };
  }
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(given)) config[SHORT[key] ?? key] = value;
  // "~" kürzt den gemeinsamen Anfang der Themen ab
  const root = typeof config['~'] === 'string' ? config['~'] : undefined;
  const topicOf = (value: unknown) => (typeof value !== 'string' || !value ? undefined : root ? value.replace(/^~/, root).replace(/~$/, root) : value);
  const text = (key: string) => (typeof config[key] === 'string' && config[key] ? (config[key] as string) : undefined);

  const state = topicOf(config['state_topic']);
  const command = topicOf(config['command_topic']);
  const name = text('name') ?? fromTopic;
  if (!state || !isTopic(state)) return { skipped: `"${name}" nennt kein Thema für seinen Wert` };
  const path = templatePath(text('value_template'));
  if (!path) return { skipped: `"${name}" rechnet seinen Wert mit einer Vorlage aus, die Culinola nicht versteht` };

  const switchable = component === 'switch' || component === 'light';
  const on = text(switchable ? 'state_on' : 'payload_on') ?? text('payload_on') ?? 'ON';
  const off = text(switchable ? 'state_off' : 'payload_off') ?? text('payload_off') ?? 'OFF';
  const availability = topicOf(config['availability_topic']);
  const unit = text('unit_of_measurement')?.trim();
  return {
    point: {
      id: idOf(config['unique_id']),
      topic: state,
      on,
      off,
      label: name,
      ...(path === 'plain' ? {} : { json: path }),
      ...(switchable && command && isTopic(command) ? { command } : {}),
      ...(availability && isTopic(availability) ? { availability: { topic: availability, online: text('payload_available') ?? 'online', offline: text('payload_not_available') ?? 'offline' } } : {}),
      ...(unit ? { unit } : {}),
      ...(component === 'sensor' ? {} : { type: 'switch' as const }),
      ...(config['retain'] === true ? { retain: true } : {}),
    },
  };
}
