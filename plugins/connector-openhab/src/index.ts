import { definePlugin, type PluginContext, type SeriesPoint } from '@culinola/sdk';
import { isSwitchable, itemFromTopic, parseState, toCommand } from './parse.ts';

interface Config {
  /** Adresse von openHAB, z. B. "http://openhab:8080". */
  url: string;
  /** Nur diese Items übernehmen; ohne Angabe alle. */
  items?: string[];
}

interface Item {
  name: string;
  state: string;
  type: string;
  label?: string;
}

const RECONNECT_MS = 5000;

export default definePlugin<Config>({
  id: 'connector-openhab',

  parseConfig(raw) {
    const config = raw as Partial<Config>;
    if (typeof config.url !== 'string' || !/^https?:\/\//.test(config.url)) {
      throw new Error('"url" fehlt oder beginnt nicht mit http:// bzw. https://.');
    }
    if (config.items !== undefined && !Array.isArray(config.items)) throw new Error('"items" muss eine Liste von Itemnamen sein.');
    const url = config.url.replace(/\/+$/, '');
    return config.items ? { url, items: config.items } : { url };
  },

  async start(context) {
    const { config, log } = context;
    const token = context.secrets.get('token');
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const wanted = config.items ? new Set(config.items) : undefined;
    const types = new Map<string, string>();

    const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
      const response = await fetch(config.url + path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, signal: context.signal });
      if (!response.ok) throw new Error(`openHAB antwortet auf ${path} mit ${response.status} ${response.statusText}`);
      return response;
    };

    const publish = (name: string, state: string, label?: string) => {
      const type = types.get(name);
      if (type === undefined) return;
      const parsed = parseState(state, type);
      context.datapoints.set({ id: name, ...parsed, ...(label ? { label } : {}), writable: isSwitchable(type) });
    };

    // Ausgangsstand: alle Items einmal lesen
    const items = (await (await request('/rest/items?recursive=false&fields=name,state,type,label')).json()) as Item[];
    for (const item of items) {
      // Bild-Items tragen ganze Bilder als Zustand und sind keine Messwerte
      if (item.type === 'Group' || item.type === 'Image' || (wanted && !wanted.has(item.name))) continue;
      types.set(item.name, item.type.split(':')[0]!);
      publish(item.name, item.state, item.label);
    }
    log.info(`${types.size} Items von ${config.url} übernommen.`);
    if (wanted) {
      const missing = [...wanted].filter((name) => !types.has(name));
      if (missing.length > 0) log.warn(`In openHAB nicht gefunden: ${missing.join(', ')}`);
    }

    context.onCommand(async (id, value) => {
      const command = toCommand(value);
      const response = await request(`/rest/items/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: command });
      log.info(`Befehl ${command} an ${id} gesendet, openHAB antwortet mit ${response.status}.`);
    });

    context.provideHistory(async (id, from, to) => {
      const path = `/rest/persistence/items/${encodeURIComponent(id)}?starttime=${encodeURIComponent(from.toISOString())}&endtime=${encodeURIComponent(to.toISOString())}`;
      const body = (await (await request(path)).json()) as { data?: { time: number; state: string }[] };
      const points: SeriesPoint[] = [];
      for (const entry of body.data ?? []) {
        const value = Number(entry.state);
        if (Number.isFinite(value)) points.push([entry.time, value]);
      }
      return points;
    });

    // Änderungen laufend über den Ereignisstrom; bei Abbruch neu verbinden
    void follow(context, request, publish);
  },
});

async function follow(
  context: PluginContext<Config>,
  request: (path: string, init?: RequestInit) => Promise<Response>,
  publish: (name: string, state: string) => void,
): Promise<void> {
  while (!context.signal.aborted) {
    try {
      const response = await request('/rest/events?topics=openhab/items/*/statechanged', { headers: { Accept: 'text/event-stream' } });
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
      let pending = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const event = JSON.parse(line.slice(5)) as { topic?: string; payload?: string };
            const name = event.topic ? itemFromTopic(event.topic) : undefined;
            if (!name || !event.payload) continue;
            const payload = JSON.parse(event.payload) as { value?: string };
            if (typeof payload.value === 'string') publish(name, payload.value);
          } catch {
            // Eine unlesbare Zeile darf den Strom nicht beenden.
          }
        }
      }
      context.log.warn('Ereignisstrom von openHAB wurde beendet – verbinde neu.');
    } catch (error) {
      if (context.signal.aborted) return;
      context.log.warn(`Ereignisstrom von openHAB unterbrochen (${error instanceof Error ? error.message : String(error)}) – neuer Versuch in ${RECONNECT_MS / 1000} s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
  }
}
