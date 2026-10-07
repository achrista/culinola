import { connect } from 'node:net';
import { definePlugin } from '@culinola/sdk';
import { type Call, loginResponse, parseCalls, parseMonitorLine, parseSession } from './fritz.ts';
import { placeOf } from './place.ts';

interface Config {
  /** Adresse der FRITZ!Box im Heimnetz. */
  host: string;
  /** So viele Einträge der Anrufliste werden geholt. */
  max: number;
  refreshSeconds: number;
  /** Den Anrufmonitor der FRITZ!Box mithören: zeigt sofort, wenn es klingelt. */
  monitor: boolean;
  /** Eigenes Land als Kürzel – danach werden Nummern ohne Ländervorwahl gelesen. */
  country: string;
  /** Sprache der Orts- und Ländernamen. */
  language: string;
}

const NO_SESSION = '0000000000000000';
const MONITOR_PORT = 1012;
const RETRY_MS = 30_000;

/**
 * Anrufliste der FRITZ!Box. Das Plugin meldet sich mit einem Benutzer der FRITZ!Box an,
 * liest die Liste und hört auf Wunsch den Anrufmonitor mit. Es ändert an der FRITZ!Box nichts.
 */
export default definePlugin<Config>({
  id: 'source-fritzbox',

  parseConfig(raw) {
    const config = raw as Partial<Config>;
    const host = typeof config.host === 'string' && config.host ? config.host : 'fritz.box';
    if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('"host" muss der Name oder die Adresse der FRITZ!Box sein, ohne http:// davor.');
    const number = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' ? Math.min(max, Math.max(min, value)) : fallback);
    return { host, max: number(config.max, 60, 1, 400), refreshSeconds: number(config.refreshSeconds, 120, 15, 3600), monitor: config.monitor !== false, country: /^[a-z]{2}$/i.test(config.country ?? '') ? config.country!.toUpperCase() : 'DE', language: /^[a-z]{2}$/i.test(config.language ?? '') ? config.language!.toLowerCase() : 'de' };
  },

  start(context) {
    const { config, log } = context;
    const base = `http://${config.host}`;
    let sid = '';
    let calls: Call[] = [];
    let recordings = new Map<string, string>();
    let trouble = '';

    const get = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]) });

    /** Meldet sich an der FRITZ!Box an. Das Kennwort selbst geht dabei nicht über die Leitung. */
    async function login(): Promise<string> {
      const user = context.secrets.get('user');
      const password = context.secrets.get('password');
      if (!user || !password) throw new Error(`Die Anmeldung fehlt. In secrets.json gehört unter "${context.instanceId}": { "user": "…", "password": "…" } – ein Benutzer der FRITZ!Box.`);
      const first = parseSession(await (await get(`${base}/login_sid.lua?version=2`)).text());
      if (!first.challenge) throw new Error(`Unter ${config.host} antwortet keine FRITZ!Box.`);
      // Nach Fehlversuchen lässt die FRITZ!Box eine Weile keine Anmeldung zu
      if (first.blockSeconds > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(first.blockSeconds, 20) * 1000));
      const answer = await get(`${base}/login_sid.lua?version=2`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: user, response: loginResponse(first.challenge, password) }) });
      const session = parseSession(await answer.text());
      if (!session.sid || session.sid === NO_SESSION) throw new Error('Die FRITZ!Box lehnt die Anmeldung ab – Benutzer oder Kennwort stimmen nicht, oder dem Benutzer fehlt das Recht, die Anrufliste zu sehen.');
      return session.sid;
    }

    /** Holt etwas von der FRITZ!Box und meldet sich neu an, wenn die Sitzung abgelaufen ist. */
    async function withSession<T>(task: (session: string) => Promise<T | undefined>): Promise<T> {
      for (const fresh of [false, true]) {
        if (!sid || fresh) sid = await login();
        const result = await task(sid);
        if (result !== undefined) return result;
      }
      throw new Error('Die FRITZ!Box beantwortet die Anfrage auch nach neuer Anmeldung nicht.');
    }

    const publish = () => {
      context.resources.set('calls', calls);
      // Die Anzeige erfährt über diesen Datenpunkt, dass es Neues zu holen gibt
      context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Letzter Abruf der Anrufliste' });
    };

    const refresh = async () => {
      try {
        const xml = await withSession(async (session) => {
          const response = await get(`${base}:49000/calllist.lua?sid=${session}&max=${config.max}`);
          const body = response.ok ? await response.text() : '';
          // Ohne gültige Sitzung kommt keine Liste, sondern eine Fehlerseite
          return body.includes('<root') ? body : undefined;
        });
        const parsed = parseCalls(xml);
        recordings = parsed.recordings;
        calls = await Promise.all(parsed.calls.map(async (call) => ({ ...call, place: await placeOf(call.number, config.country, config.language) })));
        if (trouble) log.info('Die FRITZ!Box ist wieder erreichbar.');
        trouble = '';
      } catch (error) {
        if (context.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        // Die zuletzt geholte Liste bleibt stehen; gemeldet wird eine Störung einmal.
        if (message !== trouble) log.warn(message);
        trouble = message;
      }
      context.datapoints.set({ id: 'state', value: trouble ? 'gestört' : 'verbunden', label: 'FRITZ!Box' });
      publish();
    };

    context.resources.set('calls', []);
    context.datapoints.set({ id: 'ringing', value: '', label: 'Anrufer, solange es klingelt' });
    void refresh().then(() => !trouble && log.info(`Anrufliste gelesen: ${calls.length} Einträge, ${recordings.size} mit Nachricht auf dem Anrufbeantworter.`));
    const timer = setInterval(() => void refresh(), config.refreshSeconds * 1000);
    context.signal.addEventListener('abort', () => clearInterval(timer));

    // Die Aufnahme einer Nachricht, von der FRITZ!Box durchgereicht. Der Pfad stammt aus der Anrufliste, nie vom Aufrufer.
    context.routes.get('/voicemail/:id', async (request) => {
      const path = recordings.get(request.params.id ?? '');
      if (!path) return Response.json({ error: 'Zu diesem Anruf gibt es keine Aufnahme.' }, { status: 404 });
      try {
        const upstream = await withSession(async (session) => {
          const response = await fetch(`${base}:49000${path}${path.includes('?') ? '&' : '?'}sid=${session}`, { signal: request.signal });
          return response.ok && response.body ? response : undefined;
        });
        return new Response(upstream.body, { headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'audio/wav', 'Cache-Control': 'private, max-age=3600' } });
      } catch (error) {
        log.warn(`Aufnahme nicht abrufbar: ${error instanceof Error ? error.message : String(error)}`);
        return Response.json({ error: 'Die Aufnahme ließ sich nicht von der FRITZ!Box holen.' }, { status: 502 });
      }
    });

    if (config.monitor) listen();

    /** Hört den Anrufmonitor mit: Er meldet Klingeln, Abheben und Auflegen in dem Augenblick, in dem sie geschehen. */
    function listen() {
      const ringing = new Map<string, string>();
      let hinted = false;
      const show = () => {
        const number = [...ringing.values()].at(-1) ?? '';
        context.datapoints.set({ id: 'ringing', value: number, label: 'Anrufer, solange es klingelt' });
        void placeOf(number, config.country, config.language).then((place) => context.datapoints.set({ id: 'ringingPlace', value: place, label: 'Herkunft des Anrufers, solange es klingelt' }));
      };
      const open = () => {
        if (context.signal.aborted) return;
        const socket = connect(MONITOR_PORT, config.host);
        let rest = '';
        socket.setKeepAlive(true, 60_000);
        socket.on('connect', () => (hinted = false));
        socket.on('data', (chunk) => {
          const lines = (rest + chunk.toString('utf8')).split('\n');
          rest = lines.pop() ?? '';
          for (const line of lines) {
            const event = parseMonitorLine(line);
            if (!event) continue;
            if (event.kind === 'ring') ringing.set(event.connection, event.number || '?');
            else ringing.delete(event.connection);
            show();
            // Nach dem Auflegen steht der Anruf kurz darauf in der Liste
            if (event.kind === 'disconnect') setTimeout(() => void refresh(), 4000);
          }
        });
        socket.on('error', (error: NodeJS.ErrnoException) => {
          if (!hinted && error.code === 'ECONNREFUSED') log.warn('Der Anrufmonitor der FRITZ!Box ist ausgeschaltet. Er wird an einem angeschlossenen Telefon mit #96*5* eingeschaltet; ohne ihn erscheinen Anrufe erst beim nächsten Abruf der Liste.');
          hinted = true;
        });
        socket.on('close', () => {
          ringing.clear();
          show();
          if (!context.signal.aborted) setTimeout(open, RETRY_MS);
        });
        context.signal.addEventListener('abort', () => socket.destroy(), { once: true });
      };
      open();
    }
  },
});
