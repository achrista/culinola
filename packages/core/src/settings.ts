import { randomBytes } from 'node:crypto';
import type { Logger } from '@culinola/sdk';
import { type AccessToken, type Role, isRole } from './access.ts';
import type { AppConfig } from './config.ts';
import { type EventHub, parseEvents } from './events.ts';
import type { JsonFile } from './jsonfile.ts';

/** Die Angaben passen nicht – unbekannte Sprache, Meldung ohne Text, Zugang ohne Namen. */
export class InvalidSettings extends Error {}
/** Den Zugang gibt es nicht. */
export class UnknownAccess extends Error {}
/** Es geht so nicht: Der Name ist vergeben, oder danach könnte niemand mehr einrichten. */
export class SettingsConflict extends Error {}

type Site = NonNullable<AppConfig['site']>;
type Secrets = Record<string, Record<string, string>>;

const THEME = /^[a-z][a-z0-9-]{0,39}$/;
const ACCESS_NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const NAME_RULE = 'Der Name eines Zugangs besteht aus Buchstaben, Ziffern, Punkt, Binde- und Unterstrich – höchstens 40 Zeichen, keine Umlaute.';
/** Wer die Zugänge so ändert, dass niemand mehr einrichten darf, sperrt sich selbst aus – die Datei von Hand zu ändern wäre dann der einzige Weg zurück. */
const NEEDS_ADMIN = 'Solange es Zugänge gibt, aber kein Einrichtungskennwort, muss ein Zugang die Stufe „admin“ haben – sonst könnte niemand mehr einrichten.';

/** Prüft die Einstellungen der Anzeige. Was der Kern nicht kennt, bleibt stehen. */
export function parseSite(raw: unknown): Site {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidSettings('"site" ist ein Objekt, etwa { "language": "de", "region": "de-DE" }.');
  const site: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Ein leeres Feld heißt: keine Angabe
    if (value === undefined || value === null || value === '') continue;
    if (key === 'language' && (typeof value !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value))) throw new InvalidSettings('"language" ist ein Sprachkürzel wie "de" oder "en".');
    if (key === 'region') {
      try {
        if (typeof value !== 'string') throw new Error();
        new Intl.NumberFormat(value);
      } catch {
        throw new InvalidSettings('"region" ist eine Region wie "de-DE", "de-AT" oder "en-GB".');
      }
    }
    if ((key === 'theme' || key === 'nightTheme') && (typeof value !== 'string' || !THEME.test(value))) throw new InvalidSettings(`"${key}" ist der Name eines Farbschemas, etwa "glut" oder "nacht".`);
    if (key === 'astro' && (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value))) throw new InvalidSettings('"astro" ist die Kennung der Quelle, die Tag und Nacht kennt.');
    site[key] = value;
  }
  return site as Site;
}

export interface SettingsDeps {
  /** Die Konfiguration des laufenden Kerns; `site` wird darin ersetzt. */
  config: AppConfig;
  events: EventHub;
  /** Dieselbe Liste, an der die Server jeden Aufruf prüfen – eine Änderung gilt sofort. */
  access: AccessToken[];
  secrets: Secrets;
  configFile: JsonFile;
  secretsFile: JsonFile;
  log: Logger;
  /** Ob ein Einrichtungskennwort gesetzt ist – dann braucht kein Zugang die Stufe „admin“. */
  hasPassword?: () => boolean;
}

/**
 * Was außer Layouts und Quellen einzurichten ist: Sprache und Farbschema der Anzeige, Meldungen, Zugänge.
 * Jede Änderung gilt sofort und steht danach in `config.json` – die Tokens der Zugänge in `secrets.json`.
 */
export class SettingsStore {
  private readonly deps: SettingsDeps;
  private readonly listeners = new Set<(site: Site) => void>();

  constructor(deps: SettingsDeps) {
    this.deps = deps;
  }

  /** Alles zum Einrichten. Meldungen kommen so, wie sie in der Datei stehen; von den Zugängen nur Name und Stufe. */
  read(): { site: Site; events: Record<string, unknown>; access: { name: string; role: Role }[] } {
    const raw = this.raw();
    const events = raw['events'] && typeof raw['events'] === 'object' && !Array.isArray(raw['events']) ? (raw['events'] as Record<string, unknown>) : (this.deps.config.events ?? {});
    return { site: this.deps.config.site ?? {}, events, access: this.deps.access.map(({ name, role }) => ({ name, role })) };
  }

  /** Meldet geänderte Einstellungen der Anzeige – offene Anzeigen übernehmen Sprache und Farbschema ohne Neuladen. */
  onSite(listener: (site: Site) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  setSite(input: unknown): Site {
    const site = parseSite(input);
    this.write((config) => {
      if (Object.keys(site).length) config['site'] = site;
      else delete config['site'];
    });
    if (Object.keys(site).length) this.deps.config.site = site;
    else delete this.deps.config.site;
    this.deps.log.info('Einstellungen der Anzeige geändert.');
    for (const listener of this.listeners) listener(site);
    return site;
  }

  /** Ersetzt alle Meldungen. Gespeichert wird, was übergeben wurde; es gilt, was die Prüfung daraus liest. */
  setEvents(input: unknown): Record<string, unknown> {
    let parsed;
    try {
      parsed = parseEvents(input ?? {});
    } catch (error) {
      throw new InvalidSettings(error instanceof Error ? error.message : String(error));
    }
    const events = (input ?? {}) as Record<string, unknown>;
    this.write((config) => {
      if (Object.keys(events).length) config['events'] = events;
      else delete config['events'];
    });
    this.deps.events.replace(parsed);
    this.deps.log.info(`Meldungen geändert: ${Object.keys(parsed).join(', ') || 'keine'}.`);
    return events;
  }

  /**
   * Legt einen Zugang an und erzeugt sein Token. Das Token kommt genau dieses eine Mal zurück –
   * danach steht es nur noch in `secrets.json`.
   */
  addAccess(input: { name?: unknown; role?: unknown }): { name: string; role: Role; token: string } {
    const { name, role } = input;
    if (typeof name !== 'string' || !ACCESS_NAME.test(name)) throw new InvalidSettings(NAME_RULE);
    if (!isRole(role)) throw new InvalidSettings('Die Stufe eines Zugangs ist read, control oder admin.');
    if (this.deps.access.some((entry) => entry.name === name)) throw new SettingsConflict(`Einen Zugang "${name}" gibt es schon.`);
    const entry: AccessToken = { name, role, token: randomBytes(32).toString('base64url') };
    this.saveAccess([...this.deps.access, entry]);
    this.deps.log.info(`Zugang "${name}" (${role}) angelegt.`);
    return { ...entry };
  }

  setRole(name: string, role: unknown): { name: string; role: Role } {
    if (!isRole(role)) throw new InvalidSettings('Die Stufe eines Zugangs ist read, control oder admin.');
    if (!this.deps.access.some((entry) => entry.name === name)) throw new UnknownAccess(`Zugang "${name}" ist unbekannt.`);
    this.saveAccess(this.deps.access.map((entry) => (entry.name === name ? { ...entry, role } : entry)));
    this.deps.log.info(`Zugang "${name}" hat jetzt die Stufe ${role}.`);
    return { name, role };
  }

  removeAccess(name: string): void {
    if (!this.deps.access.some((entry) => entry.name === name)) throw new UnknownAccess(`Zugang "${name}" ist unbekannt.`);
    this.saveAccess(this.deps.access.filter((entry) => entry.name !== name));
    this.deps.log.info(`Zugang "${name}" entfernt.`);
  }

  private saveAccess(next: AccessToken[]): void {
    if (next.length && !next.some((entry) => entry.role === 'admin') && !this.deps.hasPassword?.()) throw new SettingsConflict(NEEDS_ADMIN);
    // Erst die Tokens, dann die Namen: Ein Zugang ohne Token wäre beim nächsten Start ein Einrichtungsfehler
    let secrets: Secrets;
    try {
      secrets = (this.deps.secretsFile.read() ?? {}) as Secrets;
      if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error(`${this.deps.secretsFile.path} ist kein Objekt.`);
    } catch (error) {
      throw new SettingsConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
    const tokens = Object.fromEntries(next.map((entry) => [entry.name, entry.token]));
    if (next.length) secrets['api'] = tokens;
    else delete secrets['api'];
    this.deps.secretsFile.write(secrets);
    if (next.length) this.deps.secrets['api'] = tokens;
    else delete this.deps.secrets['api'];

    this.write((config) => {
      if (next.length) config['access'] = { tokens: next.map(({ name, role }) => ({ name, role })) };
      else delete config['access'];
    });
    this.deps.access.splice(0, this.deps.access.length, ...next);
    if (next.length) this.deps.config.access = { tokens: next.map(({ name, role }) => ({ name, role })) };
    else delete this.deps.config.access;
  }

  private raw(): Record<string, unknown> {
    try {
      const raw = this.deps.configFile.read();
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Ändert einen Abschnitt von `config.json`; alles andere in der Datei bleibt, wie es dort steht. */
  private write(change: (config: Record<string, unknown>) => void): void {
    let config: Record<string, unknown>;
    try {
      config = (this.deps.configFile.read() ?? structuredClone(this.deps.config)) as Record<string, unknown>;
    } catch (error) {
      throw new SettingsConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
    change(config);
    this.deps.configFile.write(config);
  }
}
