// Sammelt, was jedes installierte Plugin über sich sagt – Name, Beschreibung, Einstellungen, Zugangsangaben –,
// damit die Demo beim Einrichten der Quellen alle Plugins zeigt, auch die, die im Browser nicht laufen.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installedPlugins, loadPlugin } from '../../core/src/plugins.ts';

const catalog: Record<string, unknown> = {};
for (const name of installedPlugins()) {
  const { id, name: title, text, help, settings, secrets } = await loadPlugin(name);
  catalog[name] = { id, ...(title ? { name: title } : {}), ...(text ? { text } : {}), ...(help ? { help } : {}), ...(settings ? { settings } : {}), ...(secrets ? { secrets } : {}) };
}
writeFileSync(join(import.meta.dirname, '../src/catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`${Object.keys(catalog).length} Plugins beschrieben.`);
