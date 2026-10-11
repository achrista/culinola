import { definePlugin, InvalidInput } from '@culinola/sdk';
import { type EntityState, isWanted, isWritable, toDatapoint, toSeries, toService } from './mapping.ts';

interface Config {
  /** Adresse von Home Assistant, z. B. "http://homeassistant.local:8123". */
  url: string;
  /** Nur diese Geräte übernehmen; ohne Angabe alle, die Culinola versteht. */
  entities?: string[];
  /** Nur diese Arten übernehmen, etwa ["sensor", "light"]. */
  domains?: string[];
}

const RECONNECT_MS = [2_000, 5_000, 15_000, 60_000];
const CALL_TIMEOUT_MS = 15_000;
/** Bleibt Home Assistant so lange stumm, wird die Verbindung geprüft – eine tote Leitung meldet sich nicht von selbst. */
const PING_MS = 30_000;

/**
 * Home Assistant über seinen Echtzeitkanal: Der Stand aller Geräte kommt beim Verbinden, jede Änderung danach
 * sofort. Culinola baut die Verbindung selbst auf und meldet sich mit einem Zugangstoken an; schalten heißt,
 * den passenden Dienst von Home Assistant aufzurufen. Den Verlauf liefert dessen Aufzeichnung.
 */
export default definePlugin<Config>({
  id: 'connector-homeassistant',

  parseConfig(raw) {
    const config = (raw ?? {}) as { url?: unknown; entities?: unknown; domains?: unknown };
    if (typeof config.url !== 'string' || !/^https?:\/\/[^\s/]+/.test(config.url)) throw new Error('"url" fehlt oder beginnt nicht mit http:// bzw. https:// – etwa "http://homeassistant.local:8123".');
    const list = (value: unknown, name: string, pattern: RegExp) => {
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && pattern.test(entry))) throw new Error(`"${name}" muss eine Liste sein, etwa ${name === 'entities' ? '["light.kueche", "sensor.aussen_temperatur"]' : '["sensor", "light"]'}.`);
      return value as string[];
    };
    const entities = list(config.entities, 'entities', /^[a-z0-9_]+\.[a-z0-9_]+$/);
    const domains = list(config.domains, 'domains', /^[a-z0-9_]+$/);
    return { url: config.url.replace(/\/+$/, ''), ...(entities ? { entities } : {}), ...(domains ? { domains } : {}) };
  },

  start(context) {
    const { config, log } = context;
    const token = context.secrets.get('token');
    const known = new Set<string>();
    let state = '';
    const setState = (next: string) => {
      if (next === state) return;
      state = next;
      // ok – verbunden · offline – Home Assistant nicht erreichbar · login – Token fehlt oder wird abgelehnt
      context.datapoints.set({ id: 'state', value: next, label: 'Home Assistant: Verbindung' });
    };
    setState(token ? 'offline' : 'login');
    if (!token) {
      // Ein fehlendes Token ist kein Absturz: Der Kern läuft weiter und sagt, was zu tun ist.
      log.warn(`In secrets.json fehlt das Zugangstoken: { "${context.instanceId}": { "token": "…" } } – in Home Assistant unter dem eigenen Profil als „Langlebiges Zugangstoken“ zu erzeugen.`);
      return;
    }

    const publish = (entity: EntityState) => {
      if (!isWanted(entity.entity_id, config)) return;
      known.add(entity.entity_id);
      context.datapoints.set(toDatapoint(entity));
    };

    let socket: WebSocket | undefined;
    let serial = 0;
    const pending = new Map<number, { resolve(result: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
    /** Schickt einen Aufruf über den Echtzeitkanal und wartet auf dessen Antwort. */
    const request = (message: Record<string, unknown>): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (socket?.readyState !== WebSocket.OPEN || state !== 'ok') return void reject(new Error('Home Assistant ist gerade nicht erreichbar.'));
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Home Assistant antwortet nicht.'));
        }, CALL_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, ...message }));
      });
    const dropPending = (reason: string) => {
      for (const [id, call] of pending) {
        clearTimeout(call.timer);
        call.reject(new Error(reason));
        pending.delete(id);
      }
    };

    let attempt = 0;
    let retry: NodeJS.Timeout | undefined;
    let alive: NodeJS.Timeout | undefined;
    let announced = false;
    let refused = false;

    const connect = () => {
      if (context.signal.aborted) return;
      const ws = new WebSocket(`${config.url.replace(/^http/, 'ws')}/api/websocket`);
      socket = ws;
      let ready = false;
      let lastHeard = Date.now();

      ws.addEventListener('message', (event) => {
        lastHeard = Date.now();
        let message: { type?: string; id?: number; success?: boolean; result?: unknown; error?: { message?: string }; event?: { data?: { entity_id?: string; new_state?: EntityState | null } }; message?: string };
        try {
          message = JSON.parse(String(event.data)) as typeof message;
        } catch {
          return;
        }
        if (message.type === 'auth_required') return void ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        if (message.type === 'auth_invalid') {
          refused = true;
          if (state !== 'login') log.warn(`Home Assistant lehnt das Zugangstoken ab. In secrets.json unter "${context.instanceId}" prüfen ("token").`);
          setState('login');
          return void ws.close();
        }
        if (message.type === 'auth_ok') {
          refused = false;
          ready = true;
          attempt = 0;
          setState('ok');
          // Erst die Änderungen abonnieren, dann den Stand holen – so geht dazwischen nichts verloren
          void request({ type: 'subscribe_events', event_type: 'state_changed' }).catch(() => undefined);
          void request({ type: 'get_states' }).then(
            (result) => {
              const states = Array.isArray(result) ? (result as EntityState[]) : [];
              for (const entity of states) if (typeof entity?.entity_id === 'string') publish(entity);
              if (!announced) log.info(`Mit Home Assistant ${new URL(config.url).host} verbunden: ${known.size} von ${states.length} Geräten und Werten übernommen.`);
              announced = true;
              if (config.entities) {
                const missing = config.entities.filter((id) => !known.has(id));
                if (missing.length) log.warn(`In Home Assistant nicht gefunden: ${missing.join(', ')}`);
              }
            },
            () => undefined,
          );
          return;
        }
        if (message.type === 'result' && typeof message.id === 'number') {
          const call = pending.get(message.id);
          if (!call) return;
          pending.delete(message.id);
          clearTimeout(call.timer);
          if (message.success === false) call.reject(new InvalidInput(`Home Assistant lehnt ab: ${message.error?.message ?? 'unbekannter Fehler'}`));
          else call.resolve(message.result);
          return;
        }
        if (message.type === 'pong' && typeof message.id === 'number') {
          const call = pending.get(message.id);
          if (call) {
            pending.delete(message.id);
            clearTimeout(call.timer);
            call.resolve(undefined);
          }
          return;
        }
        if (message.type === 'event') {
          const data = message.event?.data;
          if (!data?.entity_id) return;
          if (data.new_state) publish(data.new_state);
          // Ein Gerät wurde entfernt
          else if (known.has(data.entity_id)) context.datapoints.set({ id: data.entity_id, value: null, quality: 'stale' });
        }
      });

      const lost = () => {
        if (socket !== ws) return;
        socket = undefined;
        clearInterval(alive);
        dropPending('Die Verbindung zu Home Assistant ist abgebrochen.');
        if (context.signal.aborted) return;
        if (state === 'ok' || (!ready && !refused && attempt === 0)) log.warn(`${ready ? 'Verbindung zu Home Assistant getrennt' : `Home Assistant ${new URL(config.url).host} nicht erreichbar`} – neuer Versuch folgt.`);
        if (!refused) setState('offline');
        retry = setTimeout(connect, RECONNECT_MS[Math.min(attempt++, RECONNECT_MS.length - 1)]);
      };
      ws.addEventListener('close', lost);
      ws.addEventListener('error', () => undefined);

      clearInterval(alive);
      alive = setInterval(() => {
        if (!ready || Date.now() - lastHeard < PING_MS) return;
        // Antwortet Home Assistant nicht, ist die Leitung tot – dann neu verbinden
        request({ type: 'ping' }).catch(() => ws.close());
      }, PING_MS);
    };
    connect();

    context.signal.addEventListener('abort', () => {
      clearTimeout(retry);
      clearInterval(alive);
      dropPending('Culinola hält an.');
      socket?.close();
    });

    context.onCommand(async (id, value) => {
      if (!known.has(id) || !isWritable(id)) throw new InvalidInput(`Der Datenpunkt "${id}" lässt sich nicht setzen.`);
      const call = toService(id, value);
      await request({ type: 'call_service', domain: call.domain, service: call.service, service_data: call.data });
      log.info(`${call.domain}.${call.service} für ${id} aufgerufen.`);
    });

    context.provideHistory(async (id, from, to) => {
      const query = new URLSearchParams({ filter_entity_id: id, end_time: to.toISOString(), minimal_response: '', no_attributes: '' });
      const response = await fetch(`${config.url}/api/history/period/${encodeURIComponent(from.toISOString())}?${query}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) });
      if (!response.ok) throw new Error(`Home Assistant antwortet auf die Frage nach dem Verlauf mit ${response.status}.`);
      return toSeries(await response.json());
    });
  },
});
