import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type DatapointValue, type Logger, type PluginDefinition, type RouteHandler, type SeriesPoint, explain } from '@culinola/sdk';
import type { ActionRegistry } from './actions.ts';
import type { LayoutConfig, SourceConfig } from './config.ts';
import type { DatapointRegistry } from './registry.ts';
import { type ShownDatapoint, shownDatapoints } from './shown.ts';

type CommandHandler = (id: string, value: DatapointValue) => Promise<void>;
type HistoryHandler = (id: string, from: Date, to: Date) => Promise<SeriesPoint[]>;

export interface PluginRoute {
  method: 'GET' | 'POST';
  instance: string;
  path: string;
  handler: RouteHandler;
  /** Abweichende Stufe, die der Aufruf braucht; ohne Angabe entscheidet die Methode. */
  role?: 'read';
}

export interface SourceStatus {
  id: string;
  plugin: string;
  state: 'running' | 'failed';
  error?: string;
}

/** Was eine Quelle zuletzt gemeldet hat – so zeigt die Oberfläche, warum eine Quelle keine Werte liefert, ohne dass jemand ins Protokoll sehen muss. */
export interface SourceNote {
  at: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}
const KEEP_NOTES = 30;
/**
 * Scheitert der Start einer Quelle, versucht der Kern es nach diesen Pausen wieder, dann alle fünf Minuten –
 * nach einem Stromausfall ist der Kern oft schneller wieder da als openHAB oder die FRITZ!Box.
 */
const RETRY_MS = [10_000, 30_000, 60_000, 120_000, 300_000];
/** Zugangsdaten, die in einer Adresse stehen ("rtsp://name:kennwort@kamera"), gehören nicht in eine Meldung. */
const hideLogin = (text: string) => text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1…@');

/** Der Name eines Plugins wird Teil eines Paketnamens – deshalb nur, was dort hingehört. */
const PLUGIN_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Plugins, die nicht als Paket neben dem Kern liegen, sondern mitgegeben werden – so bringt die Demo im
 * Browser ihre Plugins selbst mit. Sind welche mitgegeben, gelten nur diese.
 */
let provided: Record<string, PluginDefinition<unknown>> | undefined;

export function providePlugins(plugins: Record<string, PluginDefinition<unknown>>): void {
  provided = plugins;
}

/** Lädt ein Plugin nach seinem Namen, etwa "media-radio". Wirft mit einer Meldung, die sagt, woran es liegt. */
export async function loadPlugin(name: string): Promise<PluginDefinition<unknown>> {
  if (typeof name !== 'string' || !PLUGIN_NAME.test(name)) throw new Error(`"${name}" ist kein Name eines Plugins.`);
  if (provided) {
    if (!Object.hasOwn(provided, name)) throw new Error(`Das Plugin "${name}" ist nicht installiert.`);
    return provided[name]!;
  }
  try {
    return ((await import(`@culinola/plugin-${name}`)) as { default: PluginDefinition<unknown> }).default;
  } catch (error) {
    // Nur wenn das Plugin selbst fehlt – fehlt ihm etwas, soll genau das in der Meldung stehen
    if ((error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' && String((error as Error).message).includes(`plugin-${name}'`)) throw new Error(`Das Plugin "${name}" ist nicht installiert.`);
    throw error;
  }
}

/** Die Namen aller installierten Plugins: die Pakete `@culinola/plugin-…` neben dem Kern. */
export function installedPlugins(from: string = import.meta.dirname): string[] {
  if (provided) return Object.keys(provided).sort();
  for (let dir = from; ; dir = dirname(dir)) {
    const scope = join(dir, 'node_modules', '@culinola');
    if (existsSync(scope)) {
      return readdirSync(scope)
        .filter((entry) => entry.startsWith('plugin-'))
        .map((entry) => entry.slice('plugin-'.length))
        .filter((name) => PLUGIN_NAME.test(name))
        .sort();
    }
    if (dirname(dir) === dir) return [];
  }
}

/**
 * Passt eine Adresse auf das Muster eines Plugins? `/file/:id/*` nimmt `/file/kuchen/bild.png` und liefert
 * `{ id: "kuchen", "*": "bild.png" }`. Die Teile kommen entschlüsselt zurück; was sich nicht entschlüsseln lässt, passt nicht.
 */
export function matchRoute(pattern: string, path: string): Record<string, string> | undefined {
  const wanted = pattern.split('/');
  const given = path.split('/');
  const params: Record<string, string> = {};
  try {
    for (let index = 0; index < wanted.length; index++) {
      const part = wanted[index]!;
      if (part === '*') {
        params['*'] = decodeURIComponent(given.slice(index).join('/'));
        return params;
      }
      const value = given[index];
      if (value === undefined) return undefined;
      if (part.startsWith(':')) {
        if (!value) return undefined;
        params[part.slice(1)] = decodeURIComponent(value);
      } else if (part !== value) return undefined;
    }
  } catch {
    return undefined;
  }
  return wanted.length === given.length ? params : undefined;
}

/** Was eine laufende Quelle im Kern angemeldet hat – beim Anhalten wird genau das wieder herausgenommen. */
interface Running {
  stop: AbortController;
  actions: string[];
}

/** Startet die konfigurierten Quellen und vermittelt Befehle und Verlaufsabfragen an sie. */
export class PluginHost {
  private readonly commands = new Map<string, CommandHandler>();
  private readonly histories = new Map<string, HistoryHandler>();
  private readonly running = new Map<string, Running>();
  private readonly notes = new Map<string, SourceNote[]>();
  /** Quellen, deren Start gescheitert ist und bald wieder versucht wird. */
  private readonly retries = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>();
  readonly status: SourceStatus[] = [];
  /** Listen und Verzeichnisse der Plugins, Schlüssel "<Instanz>/<Name>". */
  readonly resources = new Map<string, unknown>();
  /** Von Plugins bereitgestellte Adressen; der Server reicht Aufrufe unter `/api/v1/p/<Instanz>` an sie weiter. */
  readonly routes: PluginRoute[] = [];

  private readonly registry: DatapointRegistry;
  private readonly actions: ActionRegistry;
  private readonly secrets: Record<string, Record<string, string>>;
  private readonly log: Logger;

  private readonly dataDir: string;
  /** Was auf den Anzeigen steht – so heißen die Werte im Haus. */
  private readonly layouts: Record<string, LayoutConfig>;

  constructor(registry: DatapointRegistry, actions: ActionRegistry, secrets: Record<string, Record<string, string>>, log: Logger, dataDir: string, layouts: Record<string, LayoutConfig> = {}) {
    this.dataDir = dataDir;
    this.layouts = layouts;
    this.registry = registry;
    this.actions = actions;
    this.secrets = secrets;
    this.log = log;
  }

  /** Eine Quelle, die nicht startet, hält die übrigen nicht auf. */
  async startAll(sources: readonly SourceConfig[]): Promise<void> {
    for (const source of sources) await this.launch(source);
  }

  /**
   * Startet eine einzelne Quelle – läuft sie schon, wird sie vorher angehalten. Scheitert der Start,
   * steht das mit der Ursache in ihrem Zustand; nichts von ihr bleibt halb angemeldet zurück. Lag es nicht
   * an Plugin oder Einstellungen, sondern am Start selbst, versucht der Kern es später von sich aus wieder.
   */
  async launch(source: SourceConfig, attempt = 0): Promise<SourceStatus> {
    this.halt(source.id);
    // Die Meldungen gehören zu diesem Lauf: Was vor dem Neustart stand, ist erledigt
    this.notes.delete(source.id);
    let status: SourceStatus;
    const prepared = { done: false };
    try {
      await this.start(source, prepared);
      status = { id: source.id, plugin: source.plugin, state: 'running' };
    } catch (error) {
      this.halt(source.id);
      const message = explain(error);
      this.log.error(`Quelle "${source.id}" (${source.plugin}) konnte nicht starten: ${message}`);
      this.note(source.id, 'error', message);
      status = { id: source.id, plugin: source.plugin, state: 'failed', error: message };
      if (prepared.done) this.retryLater(source, attempt);
    }
    const position = this.status.findIndex((entry) => entry.id === source.id);
    if (position < 0) this.status.push(status);
    else this.status[position] = status;
    return status;
  }

  private retryLater(source: SourceConfig, attempt: number): void {
    const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]!;
    const timer = setTimeout(() => {
      this.retries.delete(source.id);
      void this.launch(source, attempt + 1);
    }, delay);
    timer.unref?.();
    this.retries.set(source.id, { timer, attempt });
    this.note(source.id, 'info', `Neuer Versuch in ${delay / 1000} s.`);
  }

  /** Hält eine Quelle an und nimmt heraus, was sie angemeldet hat: Datenpunkte, Aktionen, Verzeichnisse, Adressen. */
  halt(id: string): void {
    const retry = this.retries.get(id);
    if (retry) {
      clearTimeout(retry.timer);
      this.retries.delete(id);
    }
    const running = this.running.get(id);
    if (!running) return;
    this.running.delete(id);
    running.stop.abort();
    for (const name of running.actions) this.actions.unregister(name);
    for (const key of [...this.resources.keys()]) if (key.startsWith(`${id}/`)) this.resources.delete(key);
    for (let index = this.routes.length - 1; index >= 0; index--) if (this.routes[index]!.instance === id) this.routes.splice(index, 1);
    this.commands.delete(id);
    this.histories.delete(id);
    this.registry.removeSource(id);
  }

  /** Hält eine Quelle an und streicht sie aus der Liste – wenn sie entfernt wird. */
  forget(id: string): void {
    this.halt(id);
    const position = this.status.findIndex((entry) => entry.id === id);
    if (position >= 0) this.status.splice(position, 1);
    this.notes.delete(id);
  }

  /** Die letzten Meldungen einer Quelle seit ihrem Start, die neueste zuletzt. */
  notesOf(id: string): SourceNote[] {
    return [...(this.notes.get(id) ?? [])];
  }

  /** Wie viele Datenpunkte eine Quelle gerade liefert. */
  datapointsOf(id: string): number {
    return this.registry.all().filter((datapoint) => datapoint.id.startsWith(`${id}:`)).length;
  }

  private note(id: string, level: SourceNote['level'], text: string): void {
    const notes = this.notes.get(id) ?? [];
    notes.push({ at: new Date().toISOString(), level, text: hideLogin(text) });
    this.notes.set(id, notes.slice(-KEEP_NOTES));
  }

  /** `prepared.done` sagt danach, ob Plugin und Einstellungen in Ordnung waren – erst ab da lohnt ein neuer Versuch. */
  private async start(source: SourceConfig, prepared: { done: boolean }): Promise<void> {
    const definition = await loadPlugin(source.plugin);
    const config = definition.parseConfig ? definition.parseConfig(source.config ?? {}) : source.config;
    prepared.done = true;
    const prefix = `${source.id}:`;
    const tag = `[${source.id}]`;
    const running: Running = { stop: new AbortController(), actions: [] };
    this.running.set(source.id, running);
    // Was nach dem Anhalten noch eintrifft – eine späte Antwort, ein letzter Zeitgeber –, geht ins Leere
    const live = () => !running.stop.signal.aborted;

    await definition.start?.({
      instanceId: source.id,
      config,
      log: {
        info: (message) => {
          this.log.info(`${tag} ${message}`);
          if (live()) this.note(source.id, 'info', message);
        },
        warn: (message) => {
          this.log.warn(`${tag} ${message}`);
          if (live()) this.note(source.id, 'warn', message);
        },
        error: (message, error) => {
          this.log.error(`${tag} ${message}`, error);
          if (live()) this.note(source.id, 'error', error === undefined ? message : `${message} ${explain(error)}`);
        },
      },
      secrets: { get: (name) => this.secrets[source.id]?.[name] },
      storageDir: storageDir(this.dataDir, source.id),
      datapoints: {
        set: (update) => {
          if (!live()) return;
          this.registry.set({
            ...update,
            id: prefix + update.id,
            ts: update.ts ?? new Date().toISOString(),
            quality: update.quality ?? 'good',
          });
        },
        list: () => this.registry.all(),
        // Jedes Mal neu gelesen: Layouts lassen sich im Betrieb ändern
        shown: (): ShownDatapoint[] => shownDatapoints(this.layouts),
      },
      actions: {
        register: (definition, handler) => {
          this.actions.register(definition, handler);
          running.actions.push(definition.name);
        },
        list: () => this.actions.list(),
        run: (name, params) => this.actions.run(name, params),
      },
      resources: {
        set: (name, value) => {
          if (live()) this.resources.set(`${source.id}/${name}`, value);
        },
      },
      routes: {
        get: (path, handler) => this.routes.push({ method: 'GET', instance: source.id, path, handler }),
        post: (path, handler, options) => this.routes.push({ method: 'POST', instance: source.id, path, handler, ...(options?.role ? { role: options.role } : {}) }),
      },
      onCommand: (handler) => this.commands.set(source.id, handler),
      provideHistory: (handler) => this.histories.set(source.id, handler),
      signal: running.stop.signal,
    });
  }

  /** Die Adresse eines Plugins, die zu einem Aufruf passt, mit den Teilen, die ihr Muster benennt. */
  route(method: string, instance: string, path: string): { route: PluginRoute; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.instance !== instance || route.method !== method) continue;
      const params = matchRoute(route.path, path);
      if (params) return { route, params };
    }
    return undefined;
  }

  /** Setzt einen schreibbaren Datenpunkt über die Quelle, der er gehört. */
  async command(datapointId: string, value: DatapointValue): Promise<void> {
    const { source, local } = split(datapointId);
    const handler = this.commands.get(source);
    if (!handler) throw new Error(`Quelle "${source}" nimmt keine Befehle an.`);
    await handler(local, value);
  }

  /** Verlauf aus der Quelle; ohne eigene Historie der Quelle aus dem Kurzzeitpuffer. */
  async history(datapointId: string, from: number, to: number): Promise<SeriesPoint[]> {
    const { source, local } = split(datapointId);
    const handler = this.histories.get(source);
    if (!handler) return this.registry.recent(datapointId, from, to);
    return handler(local, new Date(from), new Date(to));
  }

  stopAll(): void {
    for (const { timer } of this.retries.values()) clearTimeout(timer);
    this.retries.clear();
    for (const id of [...this.running.keys()]) this.running.get(id)?.stop.abort();
  }
}

/** Legt den Ordner der Instanz bei Bedarf an. */
function storageDir(dataDir: string, instance: string): string {
  const dir = join(dataDir, instance);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function split(datapointId: string): { source: string; local: string } {
  const index = datapointId.indexOf(':');
  if (index < 1) throw new Error(`Ungültige Datenpunkt-Kennung "${datapointId}": erwartet wird "quelle:name".`);
  return { source: datapointId.slice(0, index), local: datapointId.slice(index + 1) };
}
