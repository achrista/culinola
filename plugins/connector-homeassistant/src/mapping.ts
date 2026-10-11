import { type DatapointUpdate, type DatapointValue, InvalidInput } from '@culinola/sdk';

/** Der Stand eines Geräts oder Werts, wie Home Assistant ihn führt. */
export interface EntityState {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_updated?: string;
}

/** Ein Aufruf an Home Assistant, der etwas schaltet. */
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

/** Arten, deren Stand „ein“ oder „aus“ ist und die sich schalten lassen. */
const SWITCHABLE = new Set(['switch', 'light', 'input_boolean', 'fan', 'siren', 'humidifier']);
/** Arten mit „ein“ oder „aus“, die nur melden. */
const BINARY = new Set(['binary_sensor', 'automation', 'script', 'remote', 'update']);
const SETTABLE_NUMBERS = new Set(['number', 'input_number']);
const SETTABLE_TEXTS = new Set(['select', 'input_select', 'input_text', 'text']);
/** Was keinen Stand im Sinn eines Messwerts hat oder zu heikel zum Schalten ist, bleibt draußen. */
const IGNORED = new Set(['persistent_notification', 'zone', 'tts', 'stt', 'conversation', 'event', 'button', 'input_button', 'scene', 'camera', 'image', 'todo', 'calendar', 'weather', 'media_player', 'lock', 'alarm_control_panel', 'vacuum', 'lawn_mower', 'valve', 'water_heater', 'climate']);

export const domainOf = (entityId: string) => entityId.split('.')[0] ?? '';

/** Ob die Anbindung dieses Gerät übernimmt – nach seiner Art und der Auswahl in der Konfiguration. */
export function isWanted(entityId: string, only?: { entities?: string[]; domains?: string[] }): boolean {
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId)) return false;
  if (only?.entities) return only.entities.includes(entityId);
  if (only?.domains) return only.domains.includes(domainOf(entityId));
  return !IGNORED.has(domainOf(entityId));
}

export function isWritable(entityId: string): boolean {
  const domain = domainOf(entityId);
  return SWITCHABLE.has(domain) || domain === 'cover' || SETTABLE_NUMBERS.has(domain) || SETTABLE_TEXTS.has(domain);
}

/**
 * Macht aus dem Stand in Home Assistant einen Datenpunkt. „ein“ und „aus“ werden zum Schalter, Zahlen zu Zahlen;
 * ein Rollladen zeigt seine Stellung in Prozent, wenn er eine meldet. Was Home Assistant als nicht verfügbar
 * führt, steht ohne Wert und als veraltet da.
 */
export function toDatapoint(entity: EntityState): DatapointUpdate {
  const domain = domainOf(entity.entity_id);
  const attributes = entity.attributes ?? {};
  const name = typeof attributes['friendly_name'] === 'string' ? attributes['friendly_name'] : undefined;
  const unit = typeof attributes['unit_of_measurement'] === 'string' ? attributes['unit_of_measurement'] : undefined;
  const base = { id: entity.entity_id, ...(name ? { label: name } : {}), writable: isWritable(entity.entity_id), ...(entity.last_updated ? { ts: entity.last_updated } : {}) };

  const raw = entity.state;
  if (raw === 'unavailable' || raw === 'unknown' || raw === undefined || raw === null) return { ...base, value: null, quality: 'stale', ...(unit ? { unit } : {}) };

  let value: DatapointValue = raw;
  if (domain === 'cover') {
    const position = attributes['current_position'];
    if (typeof position === 'number') return { ...base, value: position, unit: '%' };
    // Ohne gemeldete Stellung: offen ist 100 %, geschlossen 0 % – dazwischen sagt der Text, was geschieht
    value = raw === 'open' ? 100 : raw === 'closed' ? 0 : raw;
    return { ...base, value, ...(typeof value === 'number' ? { unit: '%' } : {}) };
  }
  if (SWITCHABLE.has(domain) || BINARY.has(domain)) {
    if (raw === 'on') value = true;
    else if (raw === 'off') value = false;
  } else if (domain === 'sun') {
    value = raw;
  } else if (raw.trim() !== '' && Number.isFinite(Number(raw)) && !SETTABLE_TEXTS.has(domain)) {
    value = Number(raw);
  }
  return { ...base, value, ...(unit ? { unit } : {}) };
}

/** Der Aufruf, mit dem ein Datenpunkt gesetzt wird: schalten, fahren, eine Zahl oder eine Auswahl setzen. */
export function toService(entityId: string, value: DatapointValue): ServiceCall {
  const domain = domainOf(entityId);
  const data = { entity_id: entityId };
  const refuse = (): never => {
    throw new InvalidInput(`Der Wert ${JSON.stringify(value)} passt nicht zu "${entityId}".`);
  };
  if (domain === 'cover') {
    if (value === 'up' || value === true) return { domain, service: 'open_cover', data };
    if (value === 'down' || value === false) return { domain, service: 'close_cover', data };
    if (value === 'stop') return { domain, service: 'stop_cover', data };
    const position = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof position !== 'number' || !(position >= 0 && position <= 100)) return refuse();
    return { domain, service: 'set_cover_position', data: { ...data, position: Math.round(position) } };
  }
  if (SWITCHABLE.has(domain)) {
    const on = typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : value === 'on' ? true : value === 'off' ? false : refuse();
    // Der allgemeine Dienst schaltet jede dieser Arten
    return { domain: 'homeassistant', service: on ? 'turn_on' : 'turn_off', data };
  }
  if (SETTABLE_NUMBERS.has(domain)) {
    const wanted = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof wanted !== 'number' || !Number.isFinite(wanted)) return refuse();
    return { domain, service: 'set_value', data: { ...data, value: wanted } };
  }
  if (SETTABLE_TEXTS.has(domain)) {
    if (typeof value !== 'string' || !value) return refuse();
    return domain === 'select' || domain === 'input_select' ? { domain, service: 'select_option', data: { ...data, option: value } } : { domain, service: 'set_value', data: { ...data, value } };
  }
  throw new InvalidInput(`"${entityId}" lässt sich nicht setzen.`);
}

/** Liest den Verlauf aus der Antwort von Home Assistant: Zeit und Zahl, alles andere bleibt draußen. */
export function toSeries(history: unknown): [time: number, value: number][] {
  const list = Array.isArray(history) && Array.isArray(history[0]) ? (history[0] as { state?: unknown; last_changed?: unknown; last_updated?: unknown }[]) : [];
  const points: [number, number][] = [];
  for (const entry of list) {
    const time = Date.parse(String(entry.last_changed ?? entry.last_updated ?? ''));
    const text = String(entry.state ?? '');
    const value = text === 'on' ? 1 : text === 'off' ? 0 : text.trim() === '' ? Number.NaN : Number(text);
    if (Number.isFinite(time) && Number.isFinite(value)) points.push([time, value]);
  }
  return points;
}
