import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DatapointValue, Logger, PluginDefinition, RouteHandler, SeriesPoint } from '@culinola/sdk';
import type { ActionRegistry } from './actions.ts';
import type { SourceConfig } from './config.ts';
import type { DatapointRegistry } from './registry.ts';

type CommandHandler = (id: string, value: DatapointValue) => Promise<void>;
type HistoryHandler = (id: string, from: Date, to: Date) => Promise<SeriesPoint[]>;

export interface PluginRoute {
  method: 'GET' | 'POST';
  instance: string;
  path: string;
  handler: RouteHandler;
}

export interface SourceStatus {
  id: string;
  plugin: string;
  state: 'running' | 'failed';
  error?: string;
}

/** Startet die konfigurierten Quellen und vermittelt Befehle und Verlaufsabfragen an sie. */
export class PluginHost {
  private readonly commands = new Map<string, CommandHandler>();
  private readonly histories = new Map<string, HistoryHandler>();
  private readonly stop = new AbortController();
  readonly status: SourceStatus[] = [];
  /** Listen und Verzeichnisse der Plugins, Schlüssel "<Instanz>/<Name>". */
  readonly resources = new Map<string, unknown>();
  /** Von Plugins bereitgestellte Adressen; der Server hängt sie unter `/api/v1/p/<Instanz>` ein. */
  readonly routes: PluginRoute[] = [];

  private readonly registry: DatapointRegistry;
  private readonly actions: ActionRegistry;
  private readonly secrets: Record<string, Record<string, string>>;
  private readonly log: Logger;

  private readonly dataDir: string;

  constructor(registry: DatapointRegistry, actions: ActionRegistry, secrets: Record<string, Record<string, string>>, log: Logger, dataDir: string) {
    this.dataDir = dataDir;
    this.registry = registry;
    this.actions = actions;
    this.secrets = secrets;
    this.log = log;
  }

  /** Eine Quelle, die nicht startet, hält die übrigen nicht auf. */
  async startAll(sources: readonly SourceConfig[]): Promise<void> {
    for (const source of sources) {
      try {
        await this.start(source);
        this.status.push({ id: source.id, plugin: source.plugin, state: 'running' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.error(`Quelle "${source.id}" (${source.plugin}) konnte nicht starten: ${message}`);
        this.status.push({ id: source.id, plugin: source.plugin, state: 'failed', error: message });
      }
    }
  }

  private async start(source: SourceConfig): Promise<void> {
    const module = (await import(`@culinola/plugin-${source.plugin}`)) as { default: PluginDefinition<unknown> };
    const definition = module.default;
    const config = definition.parseConfig ? definition.parseConfig(source.config ?? {}) : source.config;
    const prefix = `${source.id}:`;
    const tag = `[${source.id}]`;

    await definition.start?.({
      instanceId: source.id,
      config,
      log: {
        info: (message) => this.log.info(`${tag} ${message}`),
        warn: (message) => this.log.warn(`${tag} ${message}`),
        error: (message, error) => this.log.error(`${tag} ${message}`, error),
      },
      secrets: { get: (name) => this.secrets[source.id]?.[name] },
      storageDir: storageDir(this.dataDir, source.id),
      datapoints: {
        set: (update) => {
          this.registry.set({
            ...update,
            id: prefix + update.id,
            ts: update.ts ?? new Date().toISOString(),
            quality: update.quality ?? 'good',
          });
        },
      },
      actions: { register: (definition, handler) => this.actions.register(definition, handler) },
      resources: { set: (name, value) => this.resources.set(`${source.id}/${name}`, value) },
      routes: {
        get: (path, handler) => this.routes.push({ method: 'GET', instance: source.id, path, handler }),
        post: (path, handler) => this.routes.push({ method: 'POST', instance: source.id, path, handler }),
      },
      onCommand: (handler) => this.commands.set(source.id, handler),
      provideHistory: (handler) => this.histories.set(source.id, handler),
      signal: this.stop.signal,
    });
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
    this.stop.abort();
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
