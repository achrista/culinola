import { type ActionRegistry, InvalidParams } from './actions.ts';
import type { PluginHost } from './plugins.ts';
import type { DatapointRegistry } from './registry.ts';

/**
 * Die Aktionen, die der Kern selbst mitbringt: schalten und fahren. Sie wirken auf jeden
 * schreibbaren Datenpunkt, gleich aus welcher Quelle er stammt.
 */
export function registerBuiltinActions(actions: ActionRegistry, registry: DatapointRegistry, plugins: PluginHost): void {
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

  actions.register(
    {
      name: 'cover.move',
      description: 'Fährt einen Rollladen, eine Jalousie oder eine Markise: hoch bzw. einfahren (up), herunter bzw. ausfahren (down) oder anhalten (stop).',
      params: {
        datapoint: { type: 'string', description: 'Kennung des Datenpunkts, z. B. "openhab:Markise"', required: true },
        direction: { type: 'string', description: 'up, down oder stop', required: true },
      },
    },
    async ({ datapoint, direction }) => {
      const target = registry.get(String(datapoint));
      if (!target) throw new InvalidParams(`Datenpunkt "${datapoint}" ist unbekannt.`);
      if (!target.writable) throw new InvalidParams(`Datenpunkt "${datapoint}" lässt sich nicht fahren.`);
      if (direction !== 'up' && direction !== 'down' && direction !== 'stop') throw new InvalidParams('"direction" muss up, down oder stop sein.');
      await plugins.command(target.id, direction);
    },
  );
}
