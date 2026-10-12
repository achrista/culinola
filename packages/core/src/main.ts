import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { ActionRegistry } from './actions.ts';
import { registerBuiltinActions } from './builtin.ts';
import { loadAccess, loadConfig, loadSecrets } from './config.ts';
import { EventHub } from './events.ts';
import { LayoutStore } from './layouts.ts';
import { PluginHost } from './plugins.ts';
import { DatapointRegistry } from './registry.ts';
import { buildServer } from './server.ts';
import { loadTemplates } from './templates.ts';

const stamp = () => new Date().toLocaleTimeString('de-DE');
const log: Logger = {
  info: (message) => console.log(`${stamp()} ${message}`),
  warn: (message) => console.warn(`${stamp()} WARNUNG ${message}`),
  error: (message, error) => console.error(`${stamp()} FEHLER ${message}`, error ?? ''),
};

// Eine fehlerhafte Datei im Datenordner soll mit einer klaren Meldung enden, nicht mit einem Stacktrace.
function loadOrExit() {
  try {
    const loaded = loadConfig();
    const secrets = loadSecrets(loaded.dataDir);
    return { ...loaded, secrets, access: loadAccess(loaded.config, secrets) };
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const { config, dataDir, demo, secrets, access } = loadOrExit();
if (demo) log.warn(`Keine config.json in ${dataDir} gefunden – Culinola läuft mit erfundenen Beispielwerten.`);
if (access.length === 0) log.warn('Die API ist ohne Zugriffsschutz: Jeder im Netz kann lesen und schalten. Zugänge lassen sich in config.json unter "access" einrichten.');
else log.info(`Zugriffsschutz aktiv: ${access.map((entry) => `${entry.name} (${entry.role})`).join(', ')}`);

const registry = new DatapointRegistry();
const actions = new ActionRegistry();
const plugins = new PluginHost(registry, actions, secrets, log, dataDir, config.layouts);
const events = new EventHub(config.events ?? {}, log);
// Layouts lassen sich im Betrieb ändern – über die API oder von Hand in der Datei
const layouts = new LayoutStore(config.layouts, join(dataDir, 'config.json'), config, log);
const stopWatching = layouts.watch();
// Meldungen, die an einem Datenpunkt hängen, feuern, sobald er ihre Bedingung neu erfüllt
registry.on('change', (datapoint) => events.observe(datapoint));

registerBuiltinActions(actions, registry, plugins);

await plugins.startAll(config.sources);

const uiDir = resolve(import.meta.dirname, '../../ui/dist');
const templates = loadTemplates(resolve(import.meta.dirname, '../../../templates'), log);
const servers = [await buildServer({ config, registry, plugins, actions, events, layouts, templates, log, access, uiDir })];
await servers[0]!.listen({ port: config.port, host: '0.0.0.0' });
log.info(`Culinola läuft auf http://localhost:${config.port}`);

// Dieselbe Anzeige und dieselbe API noch einmal gesichert – für Anzeigen auf anderen Rechnern, die das Mikrofon brauchen
if (config.https) {
  try {
    const tls = { cert: readFileSync(join(dataDir, config.https.cert)), key: readFileSync(join(dataDir, config.https.key)) };
    const secure = await buildServer({ config, registry, plugins, actions, events, layouts, templates, log, access, uiDir, tls });
    await secure.listen({ port: config.https.port, host: '0.0.0.0' });
    servers.push(secure);
    log.info(`Gesichert erreichbar auf https://localhost:${config.https.port}`);
  } catch (error) {
    log.warn(`HTTPS nicht gestartet: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopWatching();
    plugins.stopAll();
    void Promise.all(servers.map((server) => server.close())).then(() => process.exit(0));
  });
}
