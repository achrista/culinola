import { resolve } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { loadConfig, loadSecrets } from './config.ts';
import { PluginHost } from './plugins.ts';
import { DatapointRegistry } from './registry.ts';
import { buildServer } from './server.ts';

const stamp = () => new Date().toLocaleTimeString('de-DE');
const log: Logger = {
  info: (message) => console.log(`${stamp()} ${message}`),
  warn: (message) => console.warn(`${stamp()} WARNUNG ${message}`),
  error: (message, error) => console.error(`${stamp()} FEHLER ${message}`, error ?? ''),
};

const { config, dataDir, demo } = loadConfig();
if (demo) log.warn(`Keine config.json in ${dataDir} gefunden – Culinola läuft mit erfundenen Beispielwerten.`);

const registry = new DatapointRegistry();
const plugins = new PluginHost(registry, loadSecrets(dataDir), log);
await plugins.startAll(config.sources);

const uiDir = resolve(import.meta.dirname, '../../ui/dist');
const server = await buildServer({ config, registry, plugins, uiDir });
await server.listen({ port: config.port, host: '0.0.0.0' });
log.info(`Culinola läuft auf http://localhost:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    plugins.stopAll();
    void server.close().then(() => process.exit(0));
  });
}
