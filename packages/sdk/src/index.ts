// Verträge zwischen Kern und Plugins. Ein Plugin importiert ausschließlich aus diesem Paket.

/** Güte eines Werts: frisch, veraltet oder fehlerhaft. */
export type Quality = 'good' | 'stale' | 'error';

/**
 * Kleinste gemeinsame Einheit aller Quellen. Das Backend liefert immer Rohwert
 * und Einheit, nie fertig formatierten Text – Formatierung ist Sache der Anzeige.
 */
export interface Datapoint {
  /** Eindeutig über alle Quellen, mit Quellpräfix: "openhab:Mess_TWohnen". */
  id: string;
  value: number | string | boolean | null;
  unit?: string;
  /** Zeitpunkt der Messung, ISO 8601. */
  ts: string;
  quality: Quality;
  writable?: boolean;
}

/** Was man mit einem Plugin tun kann – auslösbar per Fingertipp, API, Reaktion oder Sprache. */
export interface ActionDefinition {
  /** Punktgetrennt, Plugin zuerst: "radio.play". */
  name: string;
  description: string;
  /** Heikle Aktionen (Türöffner, Garagentor) sind per Sprache gesperrt oder verlangen eine Bestätigung. */
  sensitive?: boolean;
}

export interface PluginDefinition {
  id: string;
  actions?: readonly ActionDefinition[];
}

const PLUGIN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Prüft die Angaben eines Plugins beim Laden und gibt sie unverändert zurück. */
export function definePlugin<const T extends PluginDefinition>(definition: T): T {
  if (!PLUGIN_ID.test(definition.id)) {
    throw new Error(`Ungültige Plugin-Kennung "${definition.id}": erlaubt sind Kleinbuchstaben, Ziffern und einzelne Bindestriche.`);
  }
  for (const action of definition.actions ?? []) {
    if (!action.name.includes('.')) {
      throw new Error(`Aktion "${action.name}" in Plugin "${definition.id}" braucht die Form "bereich.name".`);
    }
  }
  return definition;
}
