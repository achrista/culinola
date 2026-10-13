import type { Logger, PluginDefinition } from '@culinola/sdk';
import type { SourceConfig } from './config.ts';
import type { JsonFile } from './jsonfile.ts';
import { type PluginHost, type SourceNote, type SourceStatus, installedPlugins, loadPlugin } from './plugins.ts';

/** Die Quelle gibt es nicht. */
export class UnknownSource extends Error {}
/** Die Angaben passen nicht – ungültiger Name, unbekanntes Plugin, Einstellungen, die das Plugin ablehnt. */
export class InvalidSource extends Error {}
/** Es geht gerade nicht: Der Name ist vergeben, oder die Datei wurde von Hand geändert. */
export class SourceConflict extends Error {}

/** Die Kennung einer Quelle wird zum Präfix ihrer Datenpunkte ("openhab:Licht") und zum Namen ihres Ordners. */
const SOURCE_ID = /^[a-z][a-z0-9-]{0,39}$/;
const ID_RULE = 'Die Kennung einer Quelle beginnt mit einem Kleinbuchstaben und besteht aus Kleinbuchstaben, Ziffern und Bindestrichen – höchstens 40 Zeichen.';

/** Eine Quelle, wie die Oberfläche sie sieht: Einstellungen und Zustand – von den Zugangsdaten nur, welche hinterlegt sind. */
export interface SourceView extends SourceStatus {
  config: unknown;
  secrets: string[];
  /** Wie viele Datenpunkte die Quelle gerade liefert, und was sie seit ihrem Start gemeldet hat. */
  datapoints: number;
  notes: SourceNote[];
}

/** Zugangsdaten zum Ändern: ein Text setzt die Angabe, `null` oder ein leerer Text nimmt sie heraus; was fehlt, bleibt. */
export type SecretChanges = Record<string, string | null>;

/** Was ein Plugin der Oberfläche über sich sagt. */
export type PluginView = Pick<PluginDefinition, 'id' | 'name' | 'text' | 'help' | 'settings' | 'secrets'>;

type Secrets = Record<string, Record<string, string>>;

export interface SourceStoreDeps {
  /** Dieselbe Liste wie `config.sources` – wer sie hält, sieht jede Änderung. */
  sources: SourceConfig[];
  /** Dasselbe Objekt, aus dem die laufenden Quellen ihre Zugangsdaten lesen. */
  secrets: Secrets;
  plugins: PluginHost;
  configFile: JsonFile;
  secretsFile: JsonFile;
  /** Die ganze Konfiguration für den Fall, dass es noch keine Datei gibt (Start mit Beispielwerten). */
  initial: object;
  log: Logger;
}

/**
 * Die Quellen im laufenden Kern: anlegen, ändern, entfernen, neu starten – ohne den Kern neu zu starten.
 * Einstellungen stehen in `config.json`, Zugangsdaten in `secrets.json`; beide schreibt der Kern mit Sicherung.
 * Zugangsdaten nimmt er nur entgegen und gibt sie nie wieder heraus.
 */
export class SourceStore {
  private readonly deps: SourceStoreDeps;
  /** Änderungen laufen nacheinander: Zwei gleichzeitige würden einander die Datei überschreiben. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: SourceStoreDeps) {
    this.deps = deps;
  }

  list(): SourceView[] {
    return this.deps.sources.map((source) => this.view(source));
  }

  /** Die installierten Plugins mit dem, was sie über ihre Einstellungen sagen. Eines, das sich nicht laden lässt, fehlt in der Liste. */
  async plugins(): Promise<PluginView[]> {
    const views: PluginView[] = [];
    for (const name of installedPlugins()) {
      try {
        const { name: title, text, help, settings, secrets } = await loadPlugin(name);
        views.push({ id: name, ...(title ? { name: title } : {}), ...(text ? { text } : {}), ...(help ? { help } : {}), ...(settings ? { settings } : {}), ...(secrets ? { secrets } : {}) });
      } catch (error) {
        this.deps.log.warn(`Plugin "${name}" lässt sich nicht laden: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return views;
  }

  create(input: { id?: unknown; plugin?: unknown; config?: unknown; secrets?: unknown }): Promise<SourceView> {
    return this.serial(async () => {
      const { id, plugin } = input;
      if (typeof id !== 'string' || !SOURCE_ID.test(id)) throw new InvalidSource(ID_RULE);
      // "api" ist in secrets.json der Platz für die Zugangstokens
      if (id === 'api' || id === 'setup') throw new InvalidSource(`Eine Quelle darf nicht "${id}" heißen – der Name ist vergeben.`);
      if (this.find(id)) throw new SourceConflict(`Eine Quelle "${id}" gibt es schon.`);
      if (typeof plugin !== 'string') throw new InvalidSource('Es fehlt "plugin" – der Name des Plugins, etwa "media-radio".');
      const source = await this.checked({ id, plugin, ...(input.config === undefined ? {} : { config: input.config }) });
      const secrets = secretChanges(input.secrets);
      this.writeSources([...this.deps.sources, source]);
      this.writeSecrets(id, secrets);
      this.deps.log.info(`Quelle "${id}" (${plugin}) angelegt.`);
      await this.deps.plugins.launch(source);
      return this.view(source);
    });
  }

  /** Ändert Einstellungen und Zugangsdaten einer Quelle und startet sie damit neu. */
  update(id: string, input: { config?: unknown; secrets?: unknown }): Promise<SourceView> {
    return this.serial(async () => {
      const current = this.find(id);
      if (!current) throw new UnknownSource(`Quelle "${id}" ist unbekannt.`);
      const source = await this.checked({ id, plugin: current.plugin, ...(input.config === undefined ? (current.config === undefined ? {} : { config: current.config }) : { config: input.config }) });
      const secrets = secretChanges(input.secrets);
      if (JSON.stringify(source) !== JSON.stringify(current)) this.writeSources(this.deps.sources.map((entry) => (entry.id === id ? source : entry)));
      this.writeSecrets(id, secrets);
      this.deps.log.info(`Quelle "${id}" geändert, sie startet neu.`);
      await this.deps.plugins.launch(source);
      return this.view(source);
    });
  }

  restart(id: string): Promise<SourceView> {
    return this.serial(async () => {
      const source = this.find(id);
      if (!source) throw new UnknownSource(`Quelle "${id}" ist unbekannt.`);
      this.deps.log.info(`Quelle "${id}" startet neu.`);
      await this.deps.plugins.launch(source);
      return this.view(source);
    });
  }

  /** Hält die Quelle an und nimmt sie samt ihren Zugangsdaten heraus. Ihr Ordner im Datenordner bleibt liegen. */
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      if (!this.find(id)) throw new UnknownSource(`Quelle "${id}" ist unbekannt.`);
      this.writeSources(this.deps.sources.filter((entry) => entry.id !== id));
      this.deps.plugins.forget(id);
      if (this.deps.secrets[id]) this.writeSecrets(id, Object.fromEntries(Object.keys(this.deps.secrets[id]).map((name) => [name, null])));
      this.deps.log.info(`Quelle "${id}" entfernt.`);
    });
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private find(id: string): SourceConfig | undefined {
    return this.deps.sources.find((source) => source.id === id);
  }

  private view(source: SourceConfig): SourceView {
    const status = this.deps.plugins.status.find((entry) => entry.id === source.id) ?? { id: source.id, plugin: source.plugin, state: 'failed' as const, error: 'Die Quelle wurde noch nicht gestartet.' };
    return {
      ...status,
      config: source.config ?? {},
      secrets: Object.keys(this.deps.secrets[source.id] ?? {}).sort(),
      datapoints: this.deps.plugins.datapointsOf(source.id),
      notes: this.deps.plugins.notesOf(source.id).slice(-10),
    };
  }

  /** Lässt das Plugin die Einstellungen prüfen, bevor etwas geschrieben wird. */
  private async checked(source: SourceConfig): Promise<SourceConfig> {
    if (source.config !== undefined && (source.config === null || typeof source.config !== 'object' || Array.isArray(source.config))) {
      throw new InvalidSource('"config" ist ein Objekt mit den Einstellungen der Quelle.');
    }
    let definition: PluginDefinition<unknown>;
    try {
      definition = await loadPlugin(source.plugin);
    } catch (error) {
      throw new InvalidSource(error instanceof Error ? error.message : String(error));
    }
    try {
      definition.parseConfig?.(structuredClone(source.config ?? {}));
    } catch (error) {
      throw new InvalidSource(error instanceof Error ? error.message : String(error));
    }
    return source;
  }

  private writeSources(next: SourceConfig[]): void {
    let raw: { sources?: unknown } & Record<string, unknown>;
    try {
      raw = (this.deps.configFile.read() ?? structuredClone(this.deps.initial)) as typeof raw;
    } catch (error) {
      throw new SourceConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
    // Stehen in der Datei andere Quellen als im laufenden Kern, hat sie jemand von Hand geändert – das soll nicht untergehen
    if (this.deps.configFile.exists() && JSON.stringify(raw.sources) !== JSON.stringify(this.deps.sources)) {
      throw new SourceConflict('Die Quellen in config.json wurden von Hand geändert. Erst den Kern neu starten, dann lassen sie sich hier wieder ändern.');
    }
    raw.sources = next;
    this.deps.configFile.write(raw);
    this.deps.sources.splice(0, this.deps.sources.length, ...next);
  }

  private writeSecrets(id: string, changes: SecretChanges): void {
    const names = Object.keys(changes);
    if (!names.length) return;
    let raw: Secrets;
    try {
      raw = (this.deps.secretsFile.read() ?? {}) as Secrets;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${this.deps.secretsFile.path} ist kein Objekt.`);
    } catch (error) {
      throw new SourceConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
    const own = { ...(raw[id] ?? {}) };
    for (const name of names) {
      const value = changes[name];
      if (value) own[name] = value;
      else delete own[name];
    }
    if (JSON.stringify(own) === JSON.stringify(raw[id] ?? {})) return;
    if (Object.keys(own).length) raw[id] = own;
    else delete raw[id];
    this.deps.secretsFile.write(raw);
    if (Object.keys(own).length) this.deps.secrets[id] = own;
    else delete this.deps.secrets[id];
  }
}

function secretChanges(input: unknown): SecretChanges {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new InvalidSource('"secrets" ist ein Objekt aus Name und Wert.');
  const changes: SecretChanges = {};
  for (const [name, value] of Object.entries(input)) {
    if (!/^[\w.-]{1,80}$/.test(name) || name === '__proto__') throw new InvalidSource(`"${name}" ist kein Name für eine Zugangsangabe.`);
    if (value !== null && typeof value !== 'string') throw new InvalidSource(`Die Zugangsangabe "${name}" muss ein Text sein.`);
    changes[name] = value;
  }
  return changes;
}
