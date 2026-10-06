// Verträge zwischen Kern und Plugins. Ein Plugin importiert ausschließlich aus diesem Paket.

/** Güte eines Werts: frisch, veraltet oder fehlerhaft. */
export type Quality = 'good' | 'stale' | 'error';

export type DatapointValue = number | string | boolean | null;

/**
 * Kleinste gemeinsame Einheit aller Quellen. Das Backend liefert immer Rohwert
 * und Einheit, nie fertig formatierten Text – Formatierung ist Sache der Anzeige.
 */
export interface Datapoint {
  /** Eindeutig über alle Quellen, mit Quellpräfix: "openhab:Mess_TWohnen". */
  id: string;
  value: DatapointValue;
  unit?: string;
  /** Bezeichnung aus dem Quellsystem, falls vorhanden. */
  label?: string;
  /** Zeitpunkt der Messung, ISO 8601. */
  ts: string;
  quality: Quality;
  writable?: boolean;
}

/** Was eine Quelle meldet: Kennung ohne Quellpräfix; Zeit und Güte ergänzt der Kern. */
export interface DatapointUpdate {
  id: string;
  value: DatapointValue;
  unit?: string;
  label?: string;
  ts?: string;
  quality?: Quality;
  writable?: boolean;
}

/** Ein Messpunkt einer Zeitreihe: Zeit in Millisekunden seit 1970, Wert. */
export type SeriesPoint = [time: number, value: number];

/** Was man mit einem Plugin tun kann – auslösbar per Fingertipp, API, Reaktion oder Sprache. */
export interface ActionDefinition {
  /** Punktgetrennt, Plugin zuerst: "radio.play". */
  name: string;
  description: string;
  /** Heikle Aktionen (Türöffner, Garagentor) sind per Sprache gesperrt oder verlangen eine Bestätigung. */
  sensitive?: boolean;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

/** Alles, was der Kern einer laufenden Plugin-Instanz bereitstellt. */
export interface PluginContext<C> {
  /** Kennung der Instanz aus der Konfiguration; sie wird zum Präfix der Datenpunkte. */
  instanceId: string;
  config: C;
  log: Logger;
  secrets: { get(name: string): string | undefined };
  datapoints: { set(update: DatapointUpdate): void };
  /** Wird aufgerufen, wenn ein schreibbarer Datenpunkt dieser Instanz gesetzt werden soll. */
  onCommand(handler: (id: string, value: DatapointValue) => Promise<void>): void;
  /** Meldet die Instanz als Quelle für Verlaufsdaten an. */
  provideHistory(handler: (id: string, from: Date, to: Date) => Promise<SeriesPoint[]>): void;
  /** Wird ausgelöst, wenn die Instanz anhalten soll. */
  signal: AbortSignal;
}

export interface PluginDefinition<C = unknown> {
  id: string;
  actions?: readonly ActionDefinition[];
  /** Prüft die rohe Konfiguration und liefert sie typisiert zurück; wirft bei Fehlern. */
  parseConfig?(raw: unknown): C;
  start?(context: PluginContext<C>): Promise<void> | void;
}

const PLUGIN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Prüft die Angaben eines Plugins beim Laden und gibt sie unverändert zurück. */
export function definePlugin<C = unknown>(definition: PluginDefinition<C>): PluginDefinition<C> {
  if (!PLUGIN_ID.test(definition.id)) {
    throw new Error(`Ungültige Plugin-Kennung "${definition.id}": erlaubt sind Kleinbuchstaben, Ziffern und einzelne Bindestriche.`);
  }
  for (const action of definition.actions ?? []) {
    if (!action.name.includes('.')) {
      throw new Error(`Aktion "${action.name}" in Plugin "${definition.id}" braucht die Form "bereich.name".`);
    }
  }
  return definition;
}
