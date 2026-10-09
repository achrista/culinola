import type { Datapoint, DatapointValue, Logger } from '@culinola/sdk';

/** Töne, mit denen sich eine Meldung ankündigen kann. */
export const SOUNDS = ['bell', 'chime', 'beep', 'none'] as const;
export type Sound = (typeof SOUNDS)[number];

/** Löst eine Meldung aus, sobald ein Datenpunkt die Bedingung neu erfüllt. */
export interface Condition {
  datapoint: string;
  /** Der Wert ist genau dieser – etwa `true`, `3` oder `"fertig"`. */
  equals?: DatapointValue;
  /** Der Wert liegt über dieser Zahl. */
  above?: number;
  /** Der Wert liegt unter dieser Zahl. */
  below?: number;
}

/** Eine Meldung, wie sie in `config.json` unter "events" steht. */
export interface EventConfig {
  /** Was auf der Anzeige steht – und vorgelesen wird, wenn `speak` gesetzt ist. */
  text: string;
  sound?: Sound;
  speak?: boolean;
  /** Kennung eines Videostroms, der mit der Meldung groß gezeigt wird, etwa die Kamera an der Haustür. */
  video?: string;
  /** Die Video-Quelle, zu der der Strom gehört; ohne Angabe "video". */
  videoSource?: string;
  /** So lange bleibt die Meldung stehen; ohne Angabe 10 Sekunden, mit Video 90. */
  seconds?: number;
  when?: Condition;
}

/** Eine ausgelöste Meldung, wie sie an die Anzeigen geht. */
export interface Raised {
  /** Fortlaufende Nummer, damit eine Anzeige dieselbe Meldung nicht zweimal zeigt. */
  id: number;
  name: string;
  at: string;
  text: string;
  sound: Sound;
  speak: boolean;
  seconds: number;
  video?: { source: string; stream: string };
}

/** Die Meldung gibt es nicht – der Aufrufer bekommt das als seinen Fehler zurück. */
export class UnknownEvent extends Error {}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_TEXT_CHARS = 300;

/** Prüft den Abschnitt "events" der Konfiguration und meldet Fehler so, dass man sie beheben kann. */
export function parseEvents(raw: unknown): Record<string, EventConfig> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('"events" muss ein Verzeichnis von Meldungen sein: { "hausglocke": { "text": "…" } }.');
  const events: Record<string, EventConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    const fail = (problem: string): never => {
      throw new Error(`Meldung "${name}": ${problem}`);
    };
    if (!NAME.test(name)) fail('Der Name darf nur Kleinbuchstaben, Ziffern und einzelne Bindestriche enthalten.');
    const event = (value ?? {}) as Record<string, unknown>;
    if (typeof event['text'] !== 'string' || !event['text'].trim()) fail('"text" fehlt.');
    if (event['sound'] !== undefined && !SOUNDS.includes(event['sound'] as Sound)) fail(`"sound" muss einer von ${SOUNDS.join(', ')} sein.`);
    if (event['speak'] !== undefined && typeof event['speak'] !== 'boolean') fail('"speak" muss true oder false sein.');
    for (const key of ['video', 'videoSource'] as const) if (event[key] !== undefined && (typeof event[key] !== 'string' || !event[key])) fail(`"${key}" muss die Kennung eines Videostroms bzw. seiner Quelle sein.`);
    const seconds = event['seconds'];
    if (seconds !== undefined && (typeof seconds !== 'number' || !(seconds >= 1 && seconds <= 3600))) fail('"seconds" muss eine Zahl von 1 bis 3600 sein.');

    let when: Condition | undefined;
    if (event['when'] !== undefined) {
      const condition = (event['when'] ?? {}) as Record<string, unknown>;
      if (typeof condition['datapoint'] !== 'string' || !condition['datapoint'].includes(':')) fail('"when" braucht einen Datenpunkt, etwa { "datapoint": "openhab:Hausglocke", "equals": true }.');
      const tests = (['equals', 'above', 'below'] as const).filter((key) => condition[key] !== undefined);
      if (tests.length !== 1) fail('"when" braucht genau eine der Angaben "equals", "above" oder "below".');
      const test = tests[0]!;
      if (test !== 'equals' && typeof condition[test] !== 'number') fail(`"${test}" muss eine Zahl sein.`);
      if (test === 'equals' && !['string', 'number', 'boolean'].includes(typeof condition['equals'])) fail('"equals" muss ein Text, eine Zahl oder true/false sein.');
      when = { datapoint: condition['datapoint'] as string, [test]: condition[test] } as Condition;
    }

    events[name] = {
      text: (event['text'] as string).trim().slice(0, MAX_TEXT_CHARS),
      ...(event['sound'] ? { sound: event['sound'] as Sound } : {}),
      ...(typeof event['speak'] === 'boolean' ? { speak: event['speak'] } : {}),
      ...(typeof event['video'] === 'string' ? { video: event['video'] } : {}),
      ...(typeof event['videoSource'] === 'string' ? { videoSource: event['videoSource'] } : {}),
      ...(typeof seconds === 'number' ? { seconds } : {}),
      ...(when ? { when } : {}),
    };
  }
  return events;
}

/** Ob ein Wert die Bedingung erfüllt. */
export function holds(condition: Condition, value: DatapointValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (condition.equals !== undefined) return value === condition.equals;
  if (typeof value !== 'number') return false;
  if (condition.above !== undefined) return value > condition.above;
  if (condition.below !== undefined) return value < condition.below;
  return false;
}

/**
 * Die Meldungen der Anzeige: „Jemand klingelt“, „Die Waschmaschine ist fertig“. Was sie tun, steht
 * in der Konfiguration; ausgelöst werden sie über die API oder dadurch, dass ein Datenpunkt eine
 * Bedingung neu erfüllt. Jede Anzeige bekommt sie über den Echtzeitkanal.
 */
export class EventHub {
  private readonly events: Record<string, EventConfig>;
  private readonly log: Logger;
  private readonly listeners = new Set<(raised: Raised) => void>();
  /** Je Meldung: ob ihre Bedingung beim letzten Wert erfüllt war. Unbekannt, solange noch kein Wert da war. */
  private readonly met = new Map<string, boolean>();
  private serial = 0;

  constructor(events: Record<string, EventConfig>, log: Logger) {
    this.events = events;
    this.log = log;
  }

  /** Die eingerichteten Meldungen – ohne das, was nur den Kern angeht. */
  list(): { name: string; text: string; trigger?: string }[] {
    return Object.entries(this.events).map(([name, event]) => ({ name, text: event.text, ...(event.when ? { trigger: event.when.datapoint } : {}) }));
  }

  /** Löst eine Meldung aus. Ein mitgegebener Text ersetzt den eingerichteten, etwa für wechselnde Angaben. */
  raise(name: string, text?: string): Raised {
    const event = this.events[name];
    if (!event) throw new UnknownEvent(`Die Meldung "${name}" ist nicht eingerichtet.`);
    const raised: Raised = {
      id: ++this.serial,
      name,
      at: new Date().toISOString(),
      text: text?.trim().slice(0, MAX_TEXT_CHARS) || event.text,
      sound: event.sound ?? 'chime',
      speak: event.speak ?? false,
      seconds: event.seconds ?? (event.video ? 90 : 10),
      ...(event.video ? { video: { source: event.videoSource ?? 'video', stream: event.video } } : {}),
    };
    this.log.info(`Meldung: ${name}`);
    for (const listener of this.listeners) listener(raised);
    return raised;
  }

  /** Meldet jede ausgelöste Meldung; der Rückgabewert beendet das. */
  onRaised(listener: (raised: Raised) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Nimmt eine Wertänderung entgegen. Eine Meldung feuert, wenn ihre Bedingung neu erfüllt ist –
   * nicht beim ersten Wert nach dem Start und nicht, solange sie erfüllt bleibt.
   */
  observe(datapoint: Pick<Datapoint, 'id' | 'value'>): void {
    for (const [name, event] of Object.entries(this.events)) {
      if (event.when?.datapoint !== datapoint.id) continue;
      const now = holds(event.when, datapoint.value);
      const before = this.met.get(name);
      this.met.set(name, now);
      if (now && before === false) this.raise(name);
    }
  }
}
