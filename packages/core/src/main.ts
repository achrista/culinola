import { resolve } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { ActionRegistry, InvalidParams } from './actions.ts';
import { loadAccess, loadConfig, loadSecrets } from './config.ts';
import { PluginHost } from './plugins.ts';
import { DatapointRegistry } from './registry.ts';
import { buildServer } from './server.ts';

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
const plugins = new PluginHost(registry, actions, secrets, log);

actions.register(
  {
    name: 'switch.set',
    description: 'Schaltet einen schaltbaren Datenpunkt ein oder aus, zum Beispiel ein Licht.',
    params: {
      datapoint: { type: 'string', description: 'Kennung des Datenpunkts, z. B. "openhab:Licht_Esstisch"', required: true },
      on: { type: 'boolean', description: 'true = ein, false = aus', required: true },
    },
  },
  async ({ datapoint, on }) => {
    const target = registry.get(String(datapoint));
    if (!target) throw new InvalidParams(`Datenpunkt "${datapoint}" ist unbekannt.`);
    if (!target.writable) throw new InvalidParams(`Datenpunkt "${datapoint}" ist nicht schaltbar.`);
    await plugins.command(target.id, on === true);
  },
);

await plugins.startAll(config.sources);

const uiDir = resolve(import.meta.dirname, '../../ui/dist');
const server = await buildServer({ config, registry, plugins, actions, log, access, uiDir });
await server.listen({ port: config.port, host: '0.0.0.0' });
log.info(`Culinola läuft auf http://localhost:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    plugins.stopAll();
    void server.close().then(() => process.exit(0));
  });
}
