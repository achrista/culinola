import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { ActionRegistry } from './actions.ts';
import { Auth } from './auth.ts';
import { registerBuiltinActions } from './builtin.ts';
import { loadAccess, loadConfig, loadSecrets } from './config.ts';
import { EventHub } from './events.ts';
import { JsonFile } from './jsonfile.ts';
import { LayoutStore } from './layouts.ts';
import { Pairing } from './pairing.ts';
import { PluginHost } from './plugins.ts';
import { DatapointRegistry } from './registry.ts';
import { buildServer } from './server.ts';
import { SettingsStore } from './settings.ts';
import { SourceStore } from './sources.ts';
import { startTelemetry } from './telemetry.ts';
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

const registry = new DatapointRegistry();
const actions = new ActionRegistry();
const plugins = new PluginHost(registry, actions, secrets, log, dataDir, config.layouts);
config.events ??= {};
const events = new EventHub(config.events, log);
// Layouts lassen sich im Betrieb ändern – über die API oder von Hand in der Datei
const configFile = new JsonFile(join(dataDir, 'config.json'));
const layouts = new LayoutStore(config.layouts, configFile, config, log);
// Quellen ebenso: einzeln ändern und neu starten, ohne den Kern anzuhalten
const secretsFile = new JsonFile(join(dataDir, 'secrets.json'));
const sources = new SourceStore({ sources: config.sources, secrets, plugins, configFile, secretsFile, initial: config, log });
// Menschen weisen sich mit dem Einrichtungskennwort aus, Geräte mit ihrem Token; neue Geräte bitten darum (Koppeln)
const auth = new Auth({ secrets, secretsFile, access, dataDir, log });
const pairing = new Pairing();
if (!auth.protected()) log.warn(`Die API ist ohne Zugriffsschutz: Jeder im Netz kann lesen, schalten und einrichten. Ein Einrichtungskennwort lässt sich in den Einstellungen festlegen (http://localhost:${config.port}/?edit=settings).`);
else log.info(`Zugriffsschutz aktiv: ${[...(auth.hasPassword() ? ['Einrichtungskennwort'] : []), ...access.map((entry) => `${entry.name} (${entry.role})`)].join(', ')}`);
const settings = new SettingsStore({ config, events, access, secrets, configFile, secretsFile, log, hasPassword: () => auth.hasPassword() });
const stopWatching = layouts.watch();
// Meldungen, die an einem Datenpunkt hängen, feuern, sobald er ihre Bedingung neu erfüllt
registry.on('change', (datapoint) => events.observe(datapoint));

registerBuiltinActions(actions, registry, plugins);

await plugins.startAll(config.sources);

const uiDir = resolve(import.meta.dirname, '../../ui/dist');
const templates = loadTemplates(resolve(import.meta.dirname, '../../../templates'), log);
const servers = [await buildServer({ config, registry, plugins, actions, events, layouts, sources, settings, templates, log, access, auth, pairing, uiDir })];
await servers[0]!.listen({ port: config.port, host: '0.0.0.0' });
log.info(`Culinola läuft auf http://localhost:${config.port}`);
const stopTelemetry = startTelemetry({ configured: config.telemetry, dataDir, demo, log });

// Dieselbe Anzeige und dieselbe API noch einmal gesichert – für Anzeigen auf anderen Rechnern, die das Mikrofon brauchen
if (config.https) {
  try {
    const tls = { cert: readFileSync(join(dataDir, config.https.cert)), key: readFileSync(join(dataDir, config.https.key)) };
    const secure = await buildServer({ config, registry, plugins, actions, events, layouts, sources, settings, templates, log, access, auth, pairing, uiDir, tls });
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
    stopTelemetry();
    plugins.stopAll();
    void Promise.all(servers.map((server) => server.close())).then(() => process.exit(0));
  });
}
