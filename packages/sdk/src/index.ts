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

export interface ActionParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

/** Was man mit einem Plugin tun kann – auslösbar per Fingertipp, API, Reaktion oder Sprache. */
export interface ActionDefinition {
  /** Punktgetrennt, Bereich zuerst: "radio.play". */
  name: string;
  /** Ein Satz, der auch einem Sprachmodell sagt, wofür die Aktion gut ist. */
  description: string;
  params?: Record<string, ActionParameter>;
  /** Heikle Aktionen (Türöffner, Garagentor) sind per Sprache gesperrt oder verlangen eine Bestätigung. */
  sensitive?: boolean;
}

/**
 * Eine Eingabe passt nicht – unbekannter Sender, fehlende Angabe. Der Kern meldet
 * das dem Aufrufer als dessen Fehler, nicht als Störung des Systems.
 */
export class InvalidInput extends Error {}

export type ActionParams = Record<string, string | number | boolean>;
export type ActionHandler = (params: ActionParams) => Promise<unknown> | unknown;

/** Ein Aufruf an eine vom Plugin bereitgestellte Adresse. */
export interface PluginRequest {
  params: Record<string, string>;
  query: Record<string, string>;
  /** Gelesenes JSON – oder die rohen Bytes (`Uint8Array`), wenn der Aufrufer `application/octet-stream` schickt. */
  body: unknown;
  /** Wird ausgelöst, wenn der Aufrufer die Verbindung beendet – wichtig bei Datenströmen. */
  signal: AbortSignal;
}

/** Antwortet mit einer gewöhnlichen Web-Antwort; ihr Rumpf darf ein fortlaufender Datenstrom sein. */
export type RouteHandler = (request: PluginRequest) => Promise<Response> | Response;

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
  /** Eigener Ordner der Instanz im Datenordner, etwa für erzeugte Einstellungsdateien. */
  storageDir: string;
  datapoints: { set(update: DatapointUpdate): void };
  actions: {
    /** Meldet an, was man mit dem Plugin tun kann. */
    register(definition: ActionDefinition, handler: ActionHandler): void;
    /** Alle angemeldeten Aktionen, auch die der anderen Plugins – etwa, um sie einem Sprachmodell anzubieten. */
    list(): ActionDefinition[];
    /** Löst eine Aktion aus, als käme der Aufruf über die API; die Parameter werden dabei geprüft. */
    run(name: string, params?: Record<string, unknown>): Promise<unknown>;
  };
  /** Listen und Verzeichnisse des Plugins, abrufbar unter `/api/v1/resources/<Instanz>/<Name>`. */
  resources: { set(name: string, value: unknown): void };
  /** Eigene Adressen des Plugins unter `/api/v1/p/<Instanz>/…`, etwa für Datenströme. */
  routes: { get(path: string, handler: RouteHandler): void; post(path: string, handler: RouteHandler): void };
  /** Wird aufgerufen, wenn ein schreibbarer Datenpunkt dieser Instanz gesetzt werden soll. */
  onCommand(handler: (id: string, value: DatapointValue) => Promise<void>): void;
  /** Meldet die Instanz als Quelle für Verlaufsdaten an. */
  provideHistory(handler: (id: string, from: Date, to: Date) => Promise<SeriesPoint[]>): void;
  /** Wird ausgelöst, wenn die Instanz anhalten soll. */
  signal: AbortSignal;
}

export interface PluginDefinition<C = unknown> {
  id: string;
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
  return definition;
}
