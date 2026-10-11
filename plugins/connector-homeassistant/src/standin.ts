import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type WebSocket as Socket, WebSocketServer } from 'ws';
import type { EntityState } from './mapping.ts';

/**
 * Ein Platzhalter für Home Assistant, nur für Tests und die Testinstanz: Echtzeitkanal mit Anmeldung, Stand
 * aller Geräte, Änderungsmeldungen und Dienstaufrufe, dazu der Verlauf – mit ein paar erfundenen Geräten.
 * Geschaltet wird im Arbeitsspeicher; das Verhalten echter Geräte bildet er nur grob nach.
 */
export interface StandIn {
  url: string;
  token: string;
  /** Ändert den Stand eines Geräts, als hätte es jemand in Home Assistant getan; `null` entfernt es. */
  set(entityId: string, state: string | null, attributes?: Record<string, unknown>): void;
  /** Die Dienstaufrufe, in der Reihenfolge des Eintreffens. */
  called: { domain: string; service: string; data: Record<string, unknown> }[];
  /** Trennt alle Verbindungen, wie es ein Neustart täte. */
  dropClients(): void;
  /** Zahl der angenommenen Anmeldungen. */
  logins(): number;
  close(): Promise<void>;
}

const SEED: EntityState[] = [
  { entity_id: 'sensor.aussen_temperatur', state: '12.3', attributes: { friendly_name: 'Außentemperatur', unit_of_measurement: '°C', device_class: 'temperature' } },
  { entity_id: 'sensor.strom', state: '842', attributes: { friendly_name: 'Stromverbrauch', unit_of_measurement: 'W' } },
  { entity_id: 'sensor.waschmaschine', state: 'Schleudern', attributes: { friendly_name: 'Waschmaschine' } },
  { entity_id: 'sensor.kaputt', state: 'unavailable', attributes: { friendly_name: 'Ohne Verbindung', unit_of_measurement: '°C' } },
  { entity_id: 'light.kueche', state: 'off', attributes: { friendly_name: 'Küchenlicht' } },
  { entity_id: 'switch.kaffeemaschine', state: 'on', attributes: { friendly_name: 'Kaffeemaschine' } },
  { entity_id: 'binary_sensor.haustuer', state: 'off', attributes: { friendly_name: 'Haustür', device_class: 'door' } },
  { entity_id: 'cover.wohnzimmer', state: 'open', attributes: { friendly_name: 'Rollladen Wohnzimmer', current_position: 60 } },
  { entity_id: 'input_number.solltemperatur', state: '21.5', attributes: { friendly_name: 'Solltemperatur', unit_of_measurement: '°C', min: 5, max: 30 } },
  { entity_id: 'input_select.modus', state: 'Zuhause', attributes: { friendly_name: 'Modus', options: ['Zuhause', 'Urlaub'] } },
  { entity_id: 'person.anna', state: 'home', attributes: { friendly_name: 'Anna' } },
  { entity_id: 'media_player.wohnzimmer', state: 'playing', attributes: { friendly_name: 'Lautsprecher' } },
  { entity_id: 'lock.haustuer', state: 'locked', attributes: { friendly_name: 'Türschloss' } },
];

export async function startStandIn(port = 0): Promise<StandIn> {
  const token = 'token-nur-fuer-den-platzhalter';
  const states = new Map(SEED.map((entity) => [entity.entity_id, structuredClone(entity)]));
  const subscribers = new Map<Socket, number>();
  const called: StandIn['called'] = [];
  let logins = 0;

  const change = (entityId: string, state: string | null, attributes?: Record<string, unknown>) => {
    const before = states.get(entityId);
    const next = state === null ? null : { entity_id: entityId, state, attributes: { ...before?.attributes, ...attributes }, last_updated: new Date().toISOString() };
    if (next) states.set(entityId, next);
    else states.delete(entityId);
    for (const [socket, id] of subscribers) socket.send(JSON.stringify({ id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: entityId, old_state: before ?? null, new_state: next } } }));
  };

  /** Was ein Dienst am Stand ändert – so weit, wie es die Anzeige braucht. */
  const perform = (domain: string, service: string, data: Record<string, unknown>) => {
    const id = String(data['entity_id']);
    const current = states.get(id);
    if (!current) throw new Error(`Entity ${id} not found`);
    if (service === 'turn_on' || service === 'turn_off') change(id, service === 'turn_on' ? 'on' : 'off');
    else if (service === 'open_cover') change(id, 'open', { current_position: 100 });
    else if (service === 'close_cover') change(id, 'closed', { current_position: 0 });
    else if (service === 'set_cover_position') change(id, Number(data['position']) > 0 ? 'open' : 'closed', { current_position: Number(data['position']) });
    else if (service === 'set_value') change(id, String(data['value']));
    else if (service === 'select_option') {
      if (!(current.attributes?.['options'] as string[] | undefined)?.includes(String(data['option']))) throw new Error(`Option ${String(data['option'])} is not valid for ${id}`);
      change(id, String(data['option']));
    } else if (service !== 'stop_cover') throw new Error(`Service ${domain}.${service} not found`);
  };

  const http = createServer((request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}`) return json(401, { message: 'Unauthorized' });
    const url = new URL(request.url ?? '/', 'http://platzhalter');
    if (url.pathname.startsWith('/api/history/period/')) {
      const id = url.searchParams.get('filter_entity_id') ?? '';
      const start = Date.parse(decodeURIComponent(url.pathname.split('/').pop()!));
      if (!states.has(id)) return json(200, []);
      // Drei Messwerte im gefragten Zeitraum und einer, der keine Zahl ist
      return json(200, [[{ entity_id: id, state: '10.5', last_changed: new Date(start + 60_000).toISOString() }, { state: 'unavailable', last_changed: new Date(start + 120_000).toISOString() }, { state: '11', last_changed: new Date(start + 180_000).toISOString() }]]);
    }
    return json(404, { message: 'Not found' });
  });
  const sockets = new WebSocketServer({ server: http, path: '/api/websocket' });
  sockets.on('connection', (socket) => {
    let authed = false;
    socket.send(JSON.stringify({ type: 'auth_required', ha_version: 'platzhalter' }));
    socket.on('close', () => void subscribers.delete(socket));
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id?: number; access_token?: string; domain?: string; service?: string; service_data?: Record<string, unknown> };
      if (!authed) {
        if (message.type === 'auth' && message.access_token === token) {
          authed = true;
          logins++;
          return void socket.send(JSON.stringify({ type: 'auth_ok', ha_version: 'platzhalter' }));
        }
        socket.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' }));
        return void socket.close();
      }
      const reply = (success: boolean, result: unknown, error?: string) => socket.send(JSON.stringify({ id: message.id, type: 'result', success, result, ...(error ? { error: { code: 'unknown_error', message: error } } : {}) }));
      if (message.type === 'subscribe_events') {
        subscribers.set(socket, message.id!);
        reply(true, null);
      } else if (message.type === 'get_states') reply(true, [...states.values()]);
      else if (message.type === 'ping') socket.send(JSON.stringify({ id: message.id, type: 'pong' }));
      else if (message.type === 'call_service') {
        called.push({ domain: message.domain!, service: message.service!, data: message.service_data ?? {} });
        try {
          perform(message.domain!, message.service!, message.service_data ?? {});
          reply(true, { context: {} });
        } catch (error) {
          reply(false, null, error instanceof Error ? error.message : String(error));
        }
      } else reply(false, null, 'Unknown command.');
    });
  });
  await new Promise<void>((ready) => http.listen(port, '127.0.0.1', ready));

  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    token,
    called,
    set: change,
    dropClients: () => {
      for (const socket of sockets.clients) socket.terminate();
    },
    logins: () => logins,
    close: () => {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      return new Promise<void>((done) => http.close(() => done()));
    },
  };
}
