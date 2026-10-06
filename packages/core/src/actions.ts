import type { ActionDefinition, ActionHandler, ActionParams } from '@culinola/sdk';

const ACTION_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export class UnknownAction extends Error {}
export class InvalidParams extends Error {}

/**
 * Verzeichnis aller Aktionen. Dieselbe Aktion wird von überall ausgelöst:
 * per Fingertipp, über die API, aus einer Reaktion und per Sprache.
 */
export class ActionRegistry {
  private readonly entries = new Map<string, { definition: ActionDefinition; handler: ActionHandler }>();

  register(definition: ActionDefinition, handler: ActionHandler): void {
    if (!ACTION_NAME.test(definition.name)) throw new Error(`Aktion "${definition.name}" braucht die Form "bereich.name".`);
    if (this.entries.has(definition.name)) throw new Error(`Aktion "${definition.name}" ist schon angemeldet.`);
    this.entries.set(definition.name, { definition, handler });
  }

  list(): ActionDefinition[] {
    return [...this.entries.values()].map((entry) => entry.definition).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Prüft die Parameter gegen die Anmeldung und führt die Aktion aus. */
  async run(name: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const entry = this.entries.get(name);
    if (!entry) throw new UnknownAction(`Aktion "${name}" ist unbekannt.`);

    const declared = entry.definition.params ?? {};
    const checked: ActionParams = {};
    for (const [key, parameter] of Object.entries(declared)) {
      const value = params[key];
      if (value === undefined || value === null) {
        if (parameter.required) throw new InvalidParams(`Aktion "${name}": Parameter "${key}" fehlt.`);
        continue;
      }
      if (typeof value !== parameter.type) {
        throw new InvalidParams(`Aktion "${name}": Parameter "${key}" muss vom Typ ${parameter.type} sein.`);
      }
      checked[key] = value as string | number | boolean;
    }
    const unknown = Object.keys(params).filter((key) => !(key in declared));
    if (unknown.length > 0) throw new InvalidParams(`Aktion "${name}" kennt den Parameter "${unknown[0]}" nicht.`);

    return entry.handler(checked);
  }
}
