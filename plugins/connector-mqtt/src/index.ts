import { definePlugin, type DatapointValue, InvalidInput } from '@culinola/sdk';
import { connect } from 'mqtt';
import { discover, parsePoints, type Point, readValue, toPayload } from './mapping.ts';

interface Config {
  /** Adresse des Brokers: "mqtt://192.168.178.10:1883", gesichert "mqtts://…". */
  url: string;
  /** Von Hand eingerichtete Datenpunkte. */
  datapoints: Point[];
  /** Anfang der Themen, auf denen sich Geräte selbst anmelden; leer schaltet das Erkennen ab. */
  discovery: string;
}

const RECONNECT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Geräte über MQTT. Ein Datenpunkt hängt an einem Thema – von Hand eingerichtet oder vom Gerät selbst
 * angemeldet, wie es Tasmota und vieles andere nach dem Muster von Home Assistant tut. Schalten heißt:
 * eine Nachricht auf das Befehlsthema senden; der neue Stand kommt vom Gerät zurück.
 */
export default definePlugin<Config>({
  id: 'connector-mqtt',

  parseConfig(raw) {
    const config = (raw ?? {}) as { url?: unknown; datapoints?: unknown; discovery?: unknown };
    if (typeof config.url !== 'string' || !/^(mqtts?|wss?):\/\/[^\s/]+/i.test(config.url)) throw new Error('"url" fehlt oder ist keine Adresse eines Brokers, etwa "mqtt://192.168.178.10:1883".');
    const wish = config.discovery ?? true;
    if (typeof wish !== 'boolean' && (typeof wish !== 'string' || !wish.trim() || /[+#]/.test(wish))) throw new Error('"discovery" ist true, false oder der Anfang der Themen, auf denen sich Geräte anmelden (Vorgabe "homeassistant").');
    const discovery = wish === true ? 'homeassistant' : wish === false ? '' : wish.trim().replace(/\/+$/, '');
    return { url: config.url, datapoints: parsePoints(config.datapoints), discovery };
  },

  start(context) {
    const { config, log } = context;
    /** Alle Datenpunkte; die von Hand eingerichteten gehen vor, wenn ein Gerät dieselbe Kennung anmeldet. */
    const points = new Map<string, Point>(config.datapoints.map((point) => [point.id, point]));
    const manual = new Set(points.keys());
    const values = new Map<string, DatapointValue>();
    /** Zuletzt gemeldete Erreichbarkeit je Thema. */
    const reachable = new Map<string, string>();
    const skipped = new Set<string>();
    let state = '';

    const setState = (next: string) => {
      if (next === state) return;
      state = next;
      // ok – verbunden · offline – Broker nicht erreichbar · login – Anmeldung fehlt oder wird abgelehnt
      context.datapoints.set({ id: 'state', value: next, label: 'MQTT: Verbindung' });
    };
    const offline = (point: Point) => {
      const said = point.availability ? reachable.get(point.availability.topic) : undefined;
      return said !== undefined && point.availability !== undefined && said === point.availability.offline;
    };
    const publish = (point: Point) => {
      context.datapoints.set({
        id: point.id,
        value: values.get(point.id) ?? null,
        // Meldet sich das Gerät ab, steht sein letzter Wert als veraltet da
        ...(offline(point) ? { quality: 'stale' as const } : {}),
        ...(point.label ? { label: point.label } : {}),
        ...(point.unit ? { unit: point.unit } : {}),
        writable: !!point.command,
      });
    };

    const username = context.secrets.get('username') ?? context.secrets.get('user');
    const password = context.secrets.get('password');
    const client = connect(config.url, {
      clientId: `culinola-${context.instanceId}-${Math.random().toString(16).slice(2, 10)}`,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      // Die verbreitete Fassung des Protokolls; damit spricht jeder Broker
      protocolVersion: 4,
      reconnectPeriod: RECONNECT_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
      clean: true,
    });
    context.signal.addEventListener('abort', () => void client.end(true));

    const subscribe = (topics: string[]) => {
      const wanted = [...new Set(topics)];
      if (wanted.length && client.connected) client.subscribe(wanted, { qos: 0 }, (error) => error && log.warn(`Abonnieren gescheitert: ${error.message}`));
    };
    const topicsOf = (point: Point) => [point.topic, ...(point.availability ? [point.availability.topic] : [])];

    for (const point of points.values()) publish(point);
    setState('offline');

    let announced = false;
    client.on('connect', () => {
      setState('ok');
      // Nach jeder neuen Verbindung von vorn: Der Broker hat die Abonnements vergessen
      subscribe([...[...points.values()].flatMap(topicsOf), ...(config.discovery ? [`${config.discovery}/#`] : [])]);
      if (!announced) log.info(`Mit dem Broker ${new URL(config.url).host} verbunden. ${manual.size} Datenpunkte eingerichtet${config.discovery ? `, Geräte melden sich unter "${config.discovery}/…" an` : ''}.`);
      announced = true;
    });
    client.on('close', () => {
      if (state === 'ok') {
        log.warn('Verbindung zum Broker getrennt – neuer Versuch folgt.');
        setState('offline');
      }
    });
    client.on('error', (error: Error & { code?: number | string }) => {
      // 4 und 5: Der Broker lehnt Benutzer oder Kennwort ab
      const refused = error.code === 4 || error.code === 5 || /not authorized|bad user ?name or password/i.test(error.message);
      const next = refused ? 'login' : 'offline';
      if (state !== next) log.warn(refused ? `Der Broker lehnt die Anmeldung ab. Zugangsdaten in secrets.json unter "${context.instanceId}" prüfen ("username", "password").` : `Broker nicht erreichbar: ${error.message}`);
      setState(next);
    });

    let discoveredCount = 0;
    let report: NodeJS.Timeout | undefined;
    context.signal.addEventListener('abort', () => clearTimeout(report));
    /** Geräte melden sich in Schüben an; berichtet wird einmal, wenn Ruhe eingekehrt ist. */
    const reportSoon = () => {
      clearTimeout(report);
      report = setTimeout(() => log.info(`${discoveredCount} Datenpunkte von Geräten angemeldet${skipped.size ? `, ${skipped.size} übergangen` : ''}.`), 3_000);
    };

    client.on('message', (topic, message) => {
      const payload = message.toString('utf8');

      if (config.discovery && topic.startsWith(`${config.discovery}/`)) {
        const found = discover(config.discovery, topic, payload);
        if (!found) return;
        if ('skipped' in found) {
          skipped.add(topic);
        } else if ('removed' in found) {
          if (points.has(found.removed) && !manual.has(found.removed)) {
            points.delete(found.removed);
            values.delete(found.removed);
            context.datapoints.set({ id: found.removed, value: null, quality: 'stale' });
          }
        } else if (!manual.has(found.point.id)) {
          if (!points.has(found.point.id)) discoveredCount++;
          points.set(found.point.id, found.point);
          publish(found.point);
          subscribe(topicsOf(found.point));
        }
        reportSoon();
        return;
      }

      for (const point of points.values()) {
        if (point.availability?.topic === topic) {
          reachable.set(topic, payload);
          publish(point);
        }
        if (point.topic !== topic) continue;
        const value = readValue(point, payload);
        if (value === undefined) continue;
        values.set(point.id, value);
        publish(point);
      }
    });

    context.onCommand(async (id, value) => {
      const point = points.get(id);
      if (!point?.command) throw new InvalidInput(`Der Datenpunkt "${id}" lässt sich nicht schalten.`);
      if (!client.connected) throw new Error('Der Broker ist gerade nicht erreichbar.');
      const payload = toPayload(point, value);
      await client.publishAsync(point.command, payload, { qos: 0, retain: point.retain === true });
      log.info(`${payload} an ${point.command} gesendet.`);
    });
  },
});
