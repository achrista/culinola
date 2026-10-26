import type { Logger } from '@culinola/sdk';
import { ActionRegistry } from '../../core/src/actions.ts';
import { registerBuiltinActions } from '../../core/src/builtin.ts';
import type { AppConfig } from '../../core/src/config.ts';
import { EventHub, parseEvents } from '../../core/src/events.ts';
import { JsonFile } from '../../core/src/jsonfile.ts';
import { LayoutStore } from '../../core/src/layouts.ts';
import { PluginHost, providePlugins } from '../../core/src/plugins.ts';
import { DatapointRegistry } from '../../core/src/registry.ts';
import { SettingsStore } from '../../core/src/settings.ts';
import { SourceStore } from '../../core/src/sources.ts';
import { parseTemplate, type Template } from '../../core/src/templates.ts';
import { DEMO_CONFIG, DEMO_SECRETS } from './config.ts';
import { language } from './language.ts';
import { demoPlugins } from './plugins/index.ts';
import { restore, seed } from './shims/fs.ts';

const DATA = '/data';

const log: Logger = {
  info: (message) => console.info(`[Culinola] ${message}`),
  warn: (message) => console.warn(`[Culinola] ${message}`),
  error: (message, error) => console.error(`[Culinola] ${message}`, error ?? ''),
};

export type Core = Awaited<ReturnType<typeof startCore>>;

/**
 * Startet den Kern im Browser – mit denselben Bausteinen wie auf dem Server: Datenpunkte, Aktionen, Quellen,
 * Layouts, Einstellungen und Meldungen. Nur das Dateisystem liegt im Arbeitsspeicher und die Plugins bringt die
 * Demo selbst mit. `files` sind mitgelieferte Dateien (Rezepte, Logos) samt ihrem Platz im Datenordner.
 */
export async function startCore(options: { files: Record<string, string | Uint8Array>; clips: Record<string, string>; templates: Record<string, unknown> }) {
  // Die Demo-Einrichtung liegt im Datenordner wie bei einer echten Installation; was der Besucher ändert, kommt darüber
  seed(`${DATA}/config.json`, `${JSON.stringify(DEMO_CONFIG, null, 2)}\n`);
  seed(`${DATA}/secrets.json`, `${JSON.stringify(DEMO_SECRETS, null, 2)}\n`);
  for (const [path, content] of Object.entries(options.files)) seed(`${DATA}/${path}`, content);
  restore(language);

  const configFile = new JsonFile(`${DATA}/config.json`);
  const secretsFile = new JsonFile(`${DATA}/secrets.json`);
  const config = configFile.read() as AppConfig;
  config.events = parseEvents(config.events ?? {});
  const secrets = secretsFile.read() as Record<string, Record<string, string>>;

  providePlugins(demoPlugins(options.clips));
  const registry = new DatapointRegistry();
  const actions = new ActionRegistry();
  const plugins = new PluginHost(registry, actions, secrets, log, DATA, config.layouts);
  const events = new EventHub(config.events, log);
  const layouts = new LayoutStore(config.layouts, configFile, config, log);
  const sources = new SourceStore({ sources: config.sources, secrets, plugins, configFile, secretsFile, initial: config, log });
  const settings = new SettingsStore({ config, events, access: [], secrets, configFile, secretsFile, log, hasPassword: () => false });
  registry.on('change', (datapoint) => events.observe(datapoint));
  registerBuiltinActions(actions, registry, plugins);

  const templates: Template[] = [];
  for (const [id, raw] of Object.entries(options.templates)) {
    try {
      templates.push(parseTemplate(id, raw));
    } catch (error) {
      log.warn(`Vorlage ${id} übergangen: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await plugins.startAll(config.sources);
  return { config, registry, plugins, actions, events, layouts, sources, settings, templates, log };
}
