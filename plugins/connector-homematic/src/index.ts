import { definePlugin, type DatapointValue, InvalidInput, explain } from '@culinola/sdk';
import { type Channel, channelsFrom, descriptionKey, fromText, NAMES_SCRIPT, type Param, paramsFrom, parseNames, parseValues, type Point, pointId, pointsOf, toRpc, toValue, VALUES_SCRIPT } from './model.ts';
import { decodeBytes, decodeResponse, encodeCall, type RpcDouble, RpcFault, type RpcValue } from './xmlrpc.ts';

/** Ein Zugang der Zentrale zu einer Gerätefamilie. */
interface Interface {
  name: string;
  port: number;
}

interface Config {
  /** Adresse der Zentrale. */
  host: string;
  interfaces: Interface[];
  /** Abstand, in dem die Werte abgefragt werden. */
  pollSeconds: number;
  /** Port der Logikschicht der Zentrale: Sie kennt die Namen und nennt alle Werte in einem Zug. 0 verzichtet darauf. */
  regaPort: number;
}

const KNOWN: Record<string, number> = { rf: 2001, ip: 2010, wired: 2000 };
const CALL_TIMEOUT_MS = 15_000;
/** So oft wird die Geräteliste neu gelesen – neue Geräte erscheinen dann ohne Neustart. */
const RELOAD_MS = 15 * 60_000;
/** Die Wartungswerte der Geräte werden nur bei jeder so vielten Abfrage mitgelesen. */
const MAINTENANCE_EVERY = 10;
const RETRY_MS = 30_000;
/** Nach dem Schalten wird der Kanal gleich und noch einmal etwas später gelesen: Geräte melden ihren Stand mit Verzug. */
const AFTER_COMMAND_MS = [400, 2_500];
/** Kanal für Kanal abzufragen kostet die Zentrale spürbar Zeit – öfter als so geschieht es nicht. */
const SLOW_POLL_MS = 30_000;
/** Wenige Abfragen gleichzeitig: Die Zentrale ist ein kleiner Rechner. */
const PARALLEL = 2;

/**
 * Homematic über die Zentrale (CCU2, CCU3, RaspberryMatic) – ohne Zusatzsoftware dort. Geräte und Werte liest
 * Culinola über die Geräteschnittstellen der Zentrale (XML-RPC, je eine für klassische und für IP-Geräte).
 *
 * Die Werte werden in festem Abstand abgefragt – in einem einzigen Aufruf an die Logikschicht der Zentrale, die
 * den Stand aller Geräte ohnehin mitführt. Ist sie nicht erreichbar, fragt Culinola Kanal für Kanal und seltener. Die Zentrale könnte Änderungen auch von sich aus melden; dazu
 * müsste sie Culinola erreichen, und gelingt ihr das nicht – falsche Adresse, Firewall –, bleibt ihre
 * Geräteschnittstelle hängen und im ganzen Haus lässt sich nichts mehr schalten. Dieses Risiko geht der
 * Konnektor nicht ein: Er baut alle Verbindungen selbst auf und meldet sich nirgends an.
 */
export default definePlugin<Config>({
  id: 'connector-homematic',
  name: { de: 'Homematic', en: 'Homematic' },
  text: { de: 'Geräte einer Zentrale CCU2, CCU3 oder RaspberryMatic.', en: 'Devices of a CCU2, CCU3 or RaspberryMatic.' },
  help: { de: 'Adresse der Zentrale: nur Name oder IP-Adresse, ohne http:// – etwa 192.168.178.9.\nGerätefamilien und Ports: leer lassen. Dann liest Culinola klassische Geräte (rf) und Homematic IP (ip) über die üblichen Ports.\nIn der Zentrale müssen die Zugriffe erlaubt sein: Einstellungen → Systemsteuerung → Firewall, dort „XML-RPC API“ und „Remote HomeMatic-Script API“ auf Vollzugriff oder eingeschränkt mit der Adresse dieses Rechners.\nBenutzername und Kennwort: nur eintragen, wenn in der Zentrale unter Sicherheit die Authentifizierung eingeschaltet ist.\nNach dem Speichern dauert das Einlesen einige Sekunden. Unter „Meldungen der Quelle“ steht dann, wie viele Kanäle und Datenpunkte gefunden wurden – oder warum die Zentrale nicht erreichbar ist.', en: 'Address of the CCU: just name or IP address, without http:// – such as 192.168.178.9.\nDevice families and ports: leave empty. Culinola then reads classic devices (rf) and Homematic IP (ip) via the usual ports.\nThe CCU must allow the access: Settings → Control panel → Firewall, set “XML-RPC API” and “Remote HomeMatic-Script API” to full access or restricted with the address of this computer.\nUser name and password: only enter them if authentication is switched on in the security settings of the CCU.\nAfter saving, reading takes a few seconds. “Messages of the source” then tells how many channels and datapoints were found – or why the CCU cannot be reached.' },
  settings: [
    { key: 'host', type: 'text', label: { de: 'Adresse der Zentrale', en: 'Address of the CCU' }, placeholder: '192.168.178.9' },
    { key: 'interfaces', type: 'tags', label: { de: 'Gerätefamilien', en: 'Device families' }, hint: { de: 'rf (klassisch), ip (Homematic IP), wired; leer gilt rf und ip.', en: 'rf (classic), ip (Homematic IP), wired; empty means rf and ip.' } },
    { key: 'pollSeconds', type: 'number', label: { de: 'Abfrage alle … Sekunden', en: 'Poll every … seconds' }, min: 1, max: 3600, placeholder: 5 },
    { key: 'regaPort', type: 'number', label: { de: 'Port der Logikschicht', en: 'Port of the logic layer' }, hint: { de: 'Sie kennt die Namen und nennt alle Werte in einem Zug; 0 verzichtet darauf.', en: 'It knows the names and delivers all values at once; 0 does without it.' }, min: 0, max: 65535, placeholder: 8181 },
  ],
  secrets: [
    { key: 'username', label: { de: 'Benutzername', en: 'User name' }, hint: { de: 'Nur wenn die Zentrale eine Anmeldung verlangt.', en: 'Only if the CCU requires a login.' } },
    { key: 'password', label: { de: 'Kennwort', en: 'Password' } },
  ],

  parseConfig(raw) {
    const config = (raw ?? {}) as { host?: unknown; interfaces?: unknown; pollSeconds?: unknown; regaPort?: unknown };
    if (typeof config.host !== 'string' || !/^[\w.-]+$/.test(config.host)) throw new Error('"host" fehlt – die Adresse der Zentrale, etwa "192.168.178.9".');
    const wanted = config.interfaces ?? ['rf', 'ip'];
    if (!Array.isArray(wanted) || !wanted.length) throw new Error('"interfaces" nennt die Gerätefamilien: "rf" (klassisch), "ip" (Homematic IP), "wired" – oder { "name": …, "port": … }.');
    const interfaces = wanted.map((entry: unknown): Interface => {
      if (typeof entry === 'string' && KNOWN[entry]) return { name: entry, port: KNOWN[entry]! };
      const wish = (entry ?? {}) as { name?: unknown; port?: unknown };
      if (typeof wish.name !== 'string' || !/^[a-z][a-z0-9]*$/.test(wish.name) || typeof wish.port !== 'number' || !Number.isInteger(wish.port) || wish.port < 1 || wish.port > 65535) {
        throw new Error('Ein Eintrag in "interfaces" ist "rf", "ip", "wired" oder { "name": "…", "port": 2001 }.');
      }
      return { name: wish.name, port: wish.port };
    });
    const pollSeconds = config.pollSeconds ?? 5;
    if (typeof pollSeconds !== 'number' || !(pollSeconds > 0 && pollSeconds <= 3600)) throw new Error('"pollSeconds" muss eine Zahl bis 3600 sein.');
    const regaPort = config.regaPort ?? 8181;
    if (typeof regaPort !== 'number' || !Number.isInteger(regaPort) || regaPort < 0 || regaPort > 65535) throw new Error('"regaPort" muss ein Port sein; 0 verzichtet auf die Logikschicht der Zentrale.');
    return { host: config.host, interfaces, pollSeconds, regaPort };
  },

  start(context) {
    const { config, log } = context;
    const username = context.secrets.get('username');
    const password = context.secrets.get('password');
    const auth: Record<string, string> = username ? { Authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` } : {};

    const points = new Map<string, Point & { port: number }>();
    /** Die Kanäle je Gerätefamilie, die abgefragt werden. */
    const channels = new Map<number, Channel[]>();
    const values = new Map<string, DatapointValue>();
    /** Geräte, die die Zentrale gerade nicht erreicht – ihre Werte stehen als veraltet da. */
    const unreachable = new Set<string>();
    let state = '';
    const setState = (next: string) => {
      if (next === state) return;
      state = next;
      // ok – verbunden · offline – Zentrale nicht erreichbar · login – Anmeldung wird abgelehnt
      context.datapoints.set({ id: 'state', value: next, label: 'Homematic: Verbindung' });
    };
    setState('offline');

    const call = async (port: number, method: string, params: (RpcValue | RpcDouble)[] = []): Promise<RpcValue> => {
      const response = await fetch(`http://${config.host}:${port}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml', ...auth },
        body: encodeCall(method, params),
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
      });
      if (response.status === 401 || response.status === 403) throw new LoginRefused();
      if (!response.ok) throw new Error(`Die Zentrale antwortet auf ${method} mit ${response.status}.`);
      return decodeResponse(decodeBytes(new Uint8Array(await response.arrayBuffer())));
    };

    const device = (address: string) => address.split(':')[0]!;
    const publish = (point: Point) => {
      context.datapoints.set({
        id: point.id,
        value: values.get(point.id) ?? null,
        label: point.label,
        ...(point.unit ? { unit: point.unit } : {}),
        ...(unreachable.has(device(point.address)) ? { quality: 'stale' as const } : {}),
        writable: point.writable,
      });
    };
    /** Nimmt die Werte eines Kanals entgegen; gemeldet wird nur, was sich geändert hat. */
    const accept = (channel: Channel, current: RpcValue) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return;
      for (const [key, raw] of Object.entries(current)) {
        const point = points.get(pointId(channel.address, key));
        const value = point ? toValue(point, raw) : undefined;
        if (point && value !== undefined) take(point, value);
      }
    };
    /** Übernimmt einen Wert; gemeldet wird nur, was sich geändert hat. */
    function take(point: Point, value: DatapointValue): void {
      const changed = values.get(point.id) !== value;
      values.set(point.id, value);
      // Kanal 0 meldet, ob das Gerät erreichbar ist; das färbt alle seine Werte
      if (point.key === 'UNREACH' && point.address.endsWith(':0') && typeof value === 'boolean' && value !== unreachable.has(device(point.address))) {
        if (value) unreachable.add(device(point.address));
        else unreachable.delete(device(point.address));
        for (const other of points.values()) if (device(other.address) === device(point.address)) publish(other);
      } else if (changed) publish(point);
    }

    const inTurn = async <T>(items: T[], work: (item: T) => Promise<void>) => {
      const queue = [...items];
      await Promise.all(
        Array.from({ length: PARALLEL }, async () => {
          for (let item = queue.shift(); item !== undefined && !context.signal.aborted; item = queue.shift()) await work(item);
        }),
      );
    };

    /** Lässt die Logikschicht der Zentrale ein Skript ausführen und gibt dessen Ausgabe zurück. */
    const script = async (source: string): Promise<string> => {
      const response = await fetch(`http://${config.host}:${config.regaPort}/tclrega.exe`, { method: 'POST', headers: auth, body: source, signal: AbortSignal.any([context.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) });
      if (response.status === 401 || response.status === 403) throw new LoginRefused();
      if (!response.ok) throw new Error(`Antwort ${response.status}`);
      return Buffer.from(await response.arrayBuffer()).toString('latin1');
    };

    let namesWarned = false;
    const names = async (): Promise<Map<string, string>> => {
      if (!config.regaPort) return new Map();
      try {
        return parseNames(await script(NAMES_SCRIPT));
      } catch (error) {
        if (error instanceof LoginRefused) throw error;
        if (!namesWarned) log.warn(`Die Namen der Kanäle ließen sich nicht lesen (${explain(error)}) – die Datenpunkte heißen nach ihrer Adresse.`);
        namesWarned = true;
        return new Map();
      }
    };

    /** Liest, welche Geräte es gibt und was sie an Werten führen. */
    const discover = async () => {
      const known = await names();
      const descriptions = new Map<string, Param[]>();
      for (const entry of config.interfaces) {
        const found = channelsFrom(await call(entry.port, 'listDevices'));
        await inTurn(
          [...new Map(found.filter((channel) => !descriptions.has(descriptionKey(channel))).map((channel) => [descriptionKey(channel), channel])).values()],
          async (channel) => void descriptions.set(descriptionKey(channel), paramsFrom(await call(entry.port, 'getParamsetDescription', [channel.address, 'VALUES']))),
        );
        // Abgefragt werden nur Kanäle, die einen Stand haben – Tasten etwa lösen nur aus
        const withValues: Channel[] = [];
        for (const channel of found) {
          const own = pointsOf(channel, descriptions.get(descriptionKey(channel)) ?? [], known.get(channel.address));
          if (own.length) withValues.push(channel);
          for (const point of own) {
            const fresh = !points.has(point.id);
            points.set(point.id, { ...point, port: entry.port });
            if (fresh) publish(point);
          }
        }
        channels.set(entry.port, withValues);
      }
    };

    /** Der Stand aller Werte in einem Aufruf an die Logikschicht. */
    const pollAtOnce = async () => {
      for (const [id, text] of parseValues(await script(VALUES_SCRIPT))) {
        const point = points.get(id);
        const value = point ? fromText(point, text) : undefined;
        if (point && value !== undefined) take(point, value);
      }
    };

    /** Fragt den Stand Kanal für Kanal ab. Ein Gerät, das gerade nicht antwortet, hält die übrigen nicht auf. */
    const poll = async (all: boolean) => {
      let silent = 0;
      for (const [port, list] of channels) {
        // Kanal 0 führt Wartungswerte – Batterie, Empfang, Erreichbarkeit –, die sich selten ändern
        await inTurn(all ? list : list.filter((channel) => !channel.address.endsWith(':0')), async (channel) => {
          try {
            accept(channel, await call(port, 'getParamset', [channel.address, 'VALUES']));
          } catch (error) {
            if (!(error instanceof RpcFault)) throw error;
            silent++;
          }
        });
      }
      return silent;
    };

    let timer: NodeJS.Timeout | undefined;
    let discovered = 0;
    let maintained = 0;
    /** Ob alle Werte in einem Aufruf kommen – bis sich zeigt, dass die Logikschicht nicht antwortet. */
    let atOnce = config.regaPort > 0;
    let regaTrouble = '';
    let announced = '';
    const round = async () => {
      let wait = config.pollSeconds * 1000;
      try {
        if (Date.now() - discovered > RELOAD_MS) {
          await discover();
          discovered = Date.now();
          // Nach jedem neuen Einlesen bekommt die Logikschicht eine neue Gelegenheit
          atOnce = config.regaPort > 0;
        }
        const started = Date.now();
        let silent = 0;
        if (atOnce) {
          try {
            await pollAtOnce();
          } catch (error) {
            if (error instanceof LoginRefused || context.signal.aborted) throw error;
            // Die Geräteschnittstellen selbst antworten vielleicht noch – dann geht es langsamer weiter
            regaTrouble = explain(error);
            atOnce = false;
          }
        }
        if (!atOnce) {
          const all = Date.now() - maintained >= MAINTENANCE_EVERY * SLOW_POLL_MS;
          silent = await poll(all);
          if (all) maintained = Date.now();
          // Erst jetzt steht fest: Die Zentrale ist da, nur ihre Logikschicht antwortet nicht
          if (regaTrouble) log.warn(`Die Logikschicht der Zentrale (Port ${config.regaPort}) liefert die Werte nicht (${regaTrouble}) – Culinola fragt Kanal für Kanal ab, höchstens alle ${SLOW_POLL_MS / 1000} s.`);
          regaTrouble = '';
          wait = Math.max(wait, SLOW_POLL_MS);
        }
        setState('ok');
        const line = `Zentrale ${config.host} eingelesen – ${config.interfaces.map((entry) => `${entry.name}: ${channels.get(entry.port)?.length ?? 0} Kanäle`).join(', ')}; ${points.size} Datenpunkte.`;
        if (line !== announced) log.info(`${line}${silent ? ` ${silent} Kanäle antworten nicht.` : ''} ${atOnce ? 'Alle Werte kommen in einem Aufruf' : `Abgefragt werden ${[...channels.values()].reduce((sum, list) => sum + list.length, 0)} Kanäle einzeln`}; das dauert ${((Date.now() - started) / 1000).toFixed(1)} s und wird alle ${wait / 1000} s wiederholt.`);
        announced = line;
      } catch (error) {
        if (context.signal.aborted) return;
        const refused = error instanceof LoginRefused;
        const next = refused ? 'login' : 'offline';
        if (state !== next || !announced) log.warn(refused ? `Die Zentrale verlangt eine Anmeldung. In secrets.json unter "${context.instanceId}" "username" und "password" eintragen.` : `Zentrale ${config.host} nicht erreichbar: ${explain(error)}`);
        announced ||= ' ';
        setState(next);
        wait = Math.min(RETRY_MS, 10 * wait);
        // Antwortet gar nichts, lag es nicht an der Logikschicht – beim nächsten Versuch kommt sie wieder zuerst
        if (regaTrouble) atOnce = true;
        regaTrouble = '';
      }
      if (!context.signal.aborted) timer = setTimeout(() => void round(), wait);
    };
    void round();

    const followUps = new Set<NodeJS.Timeout>();
    context.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      for (const pending of followUps) clearTimeout(pending);
    });

    context.onCommand(async (id, value) => {
      const point = points.get(id);
      if (!point) throw new InvalidInput(`Der Datenpunkt "${id}" ist unbekannt.`);
      const target = toRpc(point, value);
      // Fahren hält über einen eigenen Wert des Kanals an; sonst muss der Datenpunkt selbst schreibbar sein
      if (target.key === point.key && !point.writable) throw new InvalidInput(`Der Datenpunkt "${id}" lässt sich nicht setzen.`);
      try {
        await call(point.port, 'setValue', [point.address, target.key, target.value]);
      } catch (error) {
        if (error instanceof RpcFault) throw new InvalidInput(`Die Zentrale lehnt ab: ${error.message}`);
        throw error;
      }
      log.info(`${target.key} von ${point.address} gesetzt.`);
      // Der neue Stand soll nicht bis zur nächsten Abfrage aller Werte auf sich warten lassen
      const channel = channels.get(point.port)?.find((entry) => entry.address === point.address);
      for (const delay of AFTER_COMMAND_MS) {
        const pending = setTimeout(() => {
          followUps.delete(pending);
          if (channel) void call(point.port, 'getParamset', [channel.address, 'VALUES']).then((current) => accept(channel, current), () => undefined);
        }, delay);
        followUps.add(pending);
      }
    });
  },
});

/** Die Zentrale verlangt Benutzer und Kennwort oder lehnt die hinterlegten ab. */
class LoginRefused extends Error {}
