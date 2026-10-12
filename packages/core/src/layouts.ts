import { createHash } from 'node:crypto';
import { unwatchFile, watchFile } from 'node:fs';
import { type Logger, layoutProblems } from '@culinola/sdk';
import type { LayoutConfig } from './config.ts';
import { JsonFile } from './jsonfile.ts';

/** Das Layout gibt es nicht. */
export class UnknownLayout extends Error {}
/** Das Layout hat nicht die verlangte Form – Kachel außerhalb des Rasters, Kacheln übereinander … */
export class InvalidLayout extends Error {}
/** Das Layout wurde inzwischen von anderer Seite geändert, oder die Datei lässt sich gerade nicht lesen. */
export class LayoutConflict extends Error {
  /** Der Stand, der jetzt gilt – fehlt, wenn die Datei nicht lesbar ist. */
  readonly rev: string | undefined;
  constructor(message: string, rev?: string) {
    super(message);
    this.rev = rev;
  }
}

const WATCH_MS = 2000;
/** Der Name eines Layouts steht in der Adresse der Anzeige (`?layout=…`) – deshalb schlicht. */
const LAYOUT_ID = /^[a-z][a-z0-9-]{0,39}$/;
const NAME_RULE = 'Der Name eines Layouts beginnt mit einem Kleinbuchstaben und besteht aus Kleinbuchstaben, Ziffern und Bindestrichen – höchstens 40 Zeichen, keine Umlaute.';

/**
 * Der Stand eines Layouts als kurze Kennung seines Inhalts. Wer speichert, nennt den Stand, auf dem er
 * aufgebaut hat; passt er nicht mehr, hat inzwischen jemand anderes geändert. Aus dem Inhalt gebildet,
 * gilt er auch über einen Neustart und für Änderungen von Hand, ohne dass etwas in der Datei stehen muss.
 */
export function revisionOf(layout: unknown): string {
  return createHash('sha256').update(JSON.stringify(layout) ?? '').digest('hex').slice(0, 12);
}

type RawConfig = Record<string, unknown> & { layouts: Record<string, LayoutConfig> };

/**
 * Die Layouts im laufenden Kern: lesen, speichern, Änderungen melden. Gespeichert wird in `config.json` –
 * vorher eine Sicherung daneben, dann über eine Nachbardatei, damit nie eine halbe Datei dasteht. Ändert
 * jemand die Datei von Hand, übernimmt der Kern die Layouts ebenso; beides ist gleichberechtigt.
 */
export class LayoutStore {
  /** Dasselbe Objekt wie `config.layouts`: Wer es hält, sieht jede Änderung. */
  private readonly layouts: Record<string, LayoutConfig>;
  private readonly file: JsonFile;
  /** Die ganze Konfiguration für den Fall, dass es noch keine Datei gibt (Start mit Beispielwerten). */
  private readonly initial: object;
  private readonly log: Logger;
  private readonly listeners = new Set<(id: string, rev: string | undefined) => void>();
  /** Stand von allem außer den Layouts – ändert sich das von Hand, braucht es weiter einen Neustart. */
  private rest: string | undefined;
  private complaint = '';

  constructor(layouts: Record<string, LayoutConfig>, file: string | JsonFile, initial: object, log: Logger) {
    this.layouts = layouts;
    this.file = typeof file === 'string' ? new JsonFile(file) : file;
    // Schreibt der Kern die Datei selbst – auch für anderes als Layouts –, ist das keine Änderung von Hand
    this.file.onWritten((config) => (this.rest = this.restOf(config as RawConfig)));
    this.initial = initial;
    this.log = log;
    try {
      this.rest = this.restOf(this.read());
    } catch {
      // Beim Start hat der Kern die Datei eben erst gelesen; scheitert es hier, meldet es der nächste Abgleich
    }
  }

  ids(): string[] {
    return Object.keys(this.layouts);
  }

  get(id: string): LayoutConfig | undefined {
    return Object.hasOwn(this.layouts, id) ? this.layouts[id] : undefined;
  }

  rev(id: string): string | undefined {
    const layout = this.get(id);
    return layout ? revisionOf(layout) : undefined;
  }

  /** Meldet jedes geänderte, neue oder entfernte Layout (dann ohne Stand); der Rückgabewert beendet das. */
  onChange(listener: (id: string, rev: string | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * Speichert ein Layout. `expected` ist der Stand, auf dem die Änderung aufbaut; mit `force` wird
   * überschrieben, was inzwischen ein anderer gespeichert hat. Liefert den neuen Stand.
   */
  save(id: string, layout: unknown, expected: string | undefined, force = false): string {
    // Erst nachsehen, was in der Datei steht: Eine Änderung von Hand soll nicht untergehen
    let raw: RawConfig | undefined;
    try {
      raw = this.sync();
    } catch (error) {
      throw new LayoutConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
    const current = this.rev(id);
    if (!current) throw new UnknownLayout(`Layout "${id}" ist unbekannt.`);
    const problems = layoutProblems(layout);
    if (problems.length) throw new InvalidLayout(problems.slice(0, 5).join(' '));
    if (!force && expected !== current) {
      throw new LayoutConflict(`Layout "${id}" wurde inzwischen von anderer Seite geändert.`, current);
    }
    const next = revisionOf(layout);
    if (next === current) return current;

    const config = raw ?? (structuredClone(this.initial) as RawConfig);
    config.layouts = { ...config.layouts, [id]: layout as LayoutConfig };
    this.write(config);
    this.layouts[id] = layout as LayoutConfig;
    this.log.info(`Layout "${id}" gespeichert.`);
    for (const listener of this.listeners) listener(id, next);
    return next;
  }

  /** Legt ein neues Layout an – leer, als Kopie oder aus einer Vorlage; der Aufrufer bringt es mit. Liefert seinen Stand. */
  create(id: string, layout: unknown): string {
    const raw = this.fresh();
    if (!LAYOUT_ID.test(id)) throw new InvalidLayout(NAME_RULE);
    if (this.get(id)) throw new LayoutConflict(`Ein Layout "${id}" gibt es schon.`);
    const problems = layoutProblems(layout);
    if (problems.length) throw new InvalidLayout(problems.slice(0, 5).join(' '));
    this.replace({ ...this.layouts, [id]: layout as LayoutConfig }, raw);
    this.log.info(`Layout "${id}" angelegt.`);
    return revisionOf(layout);
  }

  /** Entfernt ein Layout. Das letzte bleibt: Ohne Layout zeigt keine Anzeige etwas. */
  remove(id: string): void {
    const raw = this.fresh();
    if (!this.get(id)) throw new UnknownLayout(`Layout "${id}" ist unbekannt.`);
    if (this.ids().length === 1) throw new LayoutConflict('Das letzte Layout lässt sich nicht löschen.');
    const { [id]: gone, ...rest } = this.layouts;
    this.replace(rest, raw);
    this.log.info(`Layout "${id}" gelöscht.`);
  }

  /** Gibt einem Layout einen anderen Namen; es behält seinen Platz in der Datei. */
  rename(id: string, to: string): void {
    const raw = this.fresh();
    if (!this.get(id)) throw new UnknownLayout(`Layout "${id}" ist unbekannt.`);
    if (!LAYOUT_ID.test(to)) throw new InvalidLayout(NAME_RULE);
    if (to === id) return;
    if (this.get(to)) throw new LayoutConflict(`Ein Layout "${to}" gibt es schon.`);
    this.replace(Object.fromEntries(Object.entries(this.layouts).map(([name, layout]) => [name === id ? to : name, layout])), raw);
    this.log.info(`Layout "${id}" heißt jetzt "${to}".`);
  }

  /** Der Stand der Datei vor einer Änderung – eine Änderung von Hand soll nicht untergehen. */
  private fresh(): RawConfig | undefined {
    try {
      return this.sync();
    } catch (error) {
      throw new LayoutConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
  }

  /** Schreibt eine neue Sammlung von Layouts und meldet jedes, das dazukam, wegfiel oder sich änderte. */
  private replace(next: Record<string, LayoutConfig>, raw: RawConfig | undefined): void {
    const config = raw ?? (structuredClone(this.initial) as RawConfig);
    config.layouts = next;
    this.write(config);
    const before = new Map(this.ids().map((id) => [id, this.rev(id)]));
    for (const id of this.ids()) delete this.layouts[id];
    Object.assign(this.layouts, next);
    for (const id of new Set([...before.keys(), ...this.ids()])) {
      if (before.get(id) !== this.rev(id)) for (const listener of this.listeners) listener(id, this.rev(id));
    }
  }

  /**
   * Gleicht die Layouts mit der Datei ab und meldet, was sich geändert hat. Wirft, wenn sie sich nicht
   * lesen lässt – der bisherige Stand gilt dann weiter. Ohne Datei (Beispielwerte) gibt es nichts abzugleichen.
   */
  sync(): RawConfig | undefined {
    const raw = this.read();
    if (!raw) return undefined;
    const changed: string[] = [];
    for (const id of Object.keys(this.layouts)) {
      if (!Object.hasOwn(raw.layouts, id)) {
        delete this.layouts[id];
        changed.push(id);
      }
    }
    for (const [id, layout] of Object.entries(raw.layouts)) {
      if (this.rev(id) === revisionOf(layout)) continue;
      this.layouts[id] = layout;
      changed.push(id);
    }
    if (changed.length) this.log.info(`config.json wurde geändert – übernommen: Layout ${changed.map((id) => `"${id}"`).join(', ')}.`);
    const rest = this.restOf(raw);
    if (this.rest !== undefined && rest !== this.rest) this.log.warn('config.json wurde außerhalb der Layouts geändert – das wirkt erst nach einem Neustart.');
    this.rest = rest;
    for (const id of changed) for (const listener of this.listeners) listener(id, this.rev(id));
    return raw;
  }

  /** Beobachtet die Datei, damit Änderungen von Hand ohne Neustart ankommen; der Rückgabewert beendet das. */
  watch(): () => void {
    const onChange = () => {
      try {
        this.sync();
        this.complaint = '';
      } catch (error) {
        // Während jemand tippt, ist die Datei oft kurz ungültig – einmal sagen genügt
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.complaint) this.log.warn(`${message} Es gelten weiter die bisherigen Layouts.`);
        this.complaint = message;
      }
    };
    watchFile(this.file.path, { interval: WATCH_MS, persistent: false }, onChange);
    return () => unwatchFile(this.file.path, onChange);
  }

  private read(): RawConfig | undefined {
    const raw = this.file.read();
    if (raw === undefined) return undefined;
    const layouts = (raw as { layouts?: unknown } | null)?.layouts;
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) throw new Error(`${this.file.path}: "layouts" fehlt.`);
    return raw as RawConfig;
  }

  private restOf(raw: RawConfig | undefined): string | undefined {
    return raw && revisionOf({ ...raw, layouts: undefined });
  }

  private write(config: RawConfig): void {
    this.file.write(config);
  }
}
