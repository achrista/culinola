import { createHash, pbkdf2Sync } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/** Ein Eintrag der Anrufliste. */
export interface Call {
  id: string;
  /** eingehend angenommen, verpasst, ausgehend, abgewiesen oder gerade im Gange */
  kind: 'incoming' | 'missed' | 'outgoing' | 'rejected' | 'active';
  /** Nummer der Gegenseite; leer bei unterdrückter Nummer. */
  number: string;
  /** Name aus dem Telefonbuch der FRITZ!Box, falls bekannt. */
  name: string;
  /** Zeitpunkt, ISO 8601. */
  date: string;
  /** Dauer in Minuten, so genau wie die FRITZ!Box sie führt. */
  minutes: number;
  /** Telefon oder Anrufbeantworter, das den Anruf geführt hat. */
  device: string;
  /** Der Anrufbeantworter hat eine Nachricht aufgenommen. */
  voicemail: boolean;
  /** Woher die Nummer kommt: Ort, Land oder Art der Nummer. Trägt der Kern nach. */
  place?: string;
}

/**
 * Antwort auf die Anmeldefrage der FRITZ!Box. Neuere Geräte fragen mit einem Verfahren,
 * das Kennwörter gegen Ausprobieren schützt (PBKDF2); ältere mit einer einfachen Prüfsumme.
 * Das Kennwort selbst wird nie übertragen.
 */
export function loginResponse(challenge: string, password: string): string {
  if (challenge.startsWith('2$')) {
    const [, rounds1, salt1, rounds2, salt2] = challenge.split('$');
    if (!rounds1 || !salt1 || !rounds2 || !salt2) throw new Error('Die FRITZ!Box stellt eine Anmeldefrage in unbekannter Form.');
    const first = pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(salt1, 'hex'), Number(rounds1), 32, 'sha256');
    const second = pbkdf2Sync(first, Buffer.from(salt2, 'hex'), Number(rounds2), 32, 'sha256');
    return `${salt2}$${second.toString('hex')}`;
  }
  // Altes Verfahren: Zeichen jenseits von Latin-1 zählen dort als Punkt
  const text = `${challenge}-${[...password].map((char) => (char.codePointAt(0)! > 255 ? '.' : char)).join('')}`;
  return `${challenge}-${createHash('md5').update(Buffer.from(text, 'utf16le')).digest('hex')}`;
}

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
const text = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** Liest Sitzungskennung, Anmeldefrage und Sperrzeit aus der Antwort der Anmeldeseite. */
export function parseSession(xml: string): { sid: string; challenge: string; blockSeconds: number } {
  const info = (parser.parse(xml) as { SessionInfo?: Record<string, unknown> }).SessionInfo ?? {};
  return { sid: text(info.SID), challenge: text(info.Challenge), blockSeconds: Number(text(info.BlockTime)) || 0 };
}

/** Zeitangabe der FRITZ!Box ("07.10.26 18:30") als Zeitpunkt nach der Uhr dieses Rechners. */
function parseDate(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(0).toISOString();
  const [, day, month, year, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  return new Date(2000 + year, month - 1, day, hour, minute).toISOString();
}

const KINDS: Record<string, Call['kind']> = { '1': 'incoming', '2': 'missed', '3': 'outgoing', '9': 'active', '10': 'rejected', '11': 'active' };

/**
 * Liest die Anrufliste. Hat der Anrufbeantworter einen Anruf angenommen und eine Nachricht
 * aufgenommen, trägt der Eintrag den Pfad der Aufnahme – daran wird er erkannt.
 * Zurück kommen die Einträge und, getrennt davon, die Pfade der Aufnahmen: Sie bleiben im Kern.
 */
export function parseCalls(xml: string): { calls: Call[]; recordings: Map<string, string> } {
  const root = (parser.parse(xml) as { root?: { Call?: unknown } }).root;
  const list = root?.Call === undefined ? [] : Array.isArray(root.Call) ? root.Call : [root.Call];
  const calls: Call[] = [];
  const recordings = new Map<string, string>();
  for (const entry of list as Record<string, unknown>[]) {
    const type = text(entry.Type);
    const outgoing = type === '3' || type === '11';
    const [hours, minutes] = text(entry.Duration).split(':').map(Number);
    const path = text(entry.Path);
    // Auch Faxe tragen einen Pfad; Aufnahmen des Anrufbeantworters liegen in dessen Ordner
    const voicemail = !outgoing && /rec\b|\/tam\//i.test(path);
    const id = text(entry.Id) || `${text(entry.Date)}-${text(entry.Caller)}`;
    if (voicemail) recordings.set(id, path);
    calls.push({
      id,
      kind: KINDS[type] ?? 'incoming',
      number: outgoing ? text(entry.Called) : text(entry.Caller),
      name: text(entry.Name),
      date: parseDate(text(entry.Date)),
      minutes: (hours || 0) * 60 + (minutes || 0),
      device: text(entry.Device),
      voicemail,
    });
  }
  return { calls, recordings };
}

/** Eine Zeile des Anrufmonitors der FRITZ!Box (Port 1012). */
export interface MonitorEvent {
  kind: 'ring' | 'call' | 'connect' | 'disconnect';
  connection: string;
  /** Bei „ring“ die Nummer des Anrufers. */
  number: string;
}

/** Liest eine Zeile des Anrufmonitors, etwa "07.10.26 18:30:12;RING;0;0821123456;987654;SIP0;". */
export function parseMonitorLine(line: string): MonitorEvent | undefined {
  const [, type, connection, third, fourth] = line.trim().split(';');
  const kind = ({ RING: 'ring', CALL: 'call', CONNECT: 'connect', DISCONNECT: 'disconnect' } as const)[type ?? ''];
  if (!kind) return undefined;
  // RING nennt den Anrufer an dritter Stelle, CALL die gewählte Nummer an fünfter – hier zählt nur der Anrufer
  return { kind, connection: connection ?? '', number: kind === 'ring' ? (third ?? '') : kind === 'call' ? (fourth ?? '') : '' };
}
