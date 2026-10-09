import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type AccessToken, isRole } from './access.ts';

export interface SourceConfig {
  /** Frei gewählte Kennung der Instanz; wird zum Präfix ihrer Datenpunkte. */
  id: string;
  /** Name des Plugins, z. B. "connector-openhab". */
  plugin: string;
  config?: unknown;
}

export interface WidgetConfig {
  type: string;
  /** Platz im Raster: Spalte, Zeile, Breite, Höhe – in Rastereinheiten, ab 0 gezählt. */
  at: [x: number, y: number, w: number, h: number];
  config?: unknown;
}

export interface LayoutConfig {
  grid: { columns: number; rows: number };
  widgets: WidgetConfig[];
}

export interface AppConfig {
  port: number;
  sources: SourceConfig[];
  layouts: Record<string, LayoutConfig>;
  /** Sprache der Oberfläche ("de", "en") und Region für Zahlen und Datum ("de-DE"); ohne Angabe entscheidet der Browser. */
  site?: { language?: string; region?: string; theme?: string };
  /** Wer die API benutzen darf. Die Tokens selbst stehen in `secrets.json` unter "api". */
  access?: { tokens: { name: string; role: string }[] };
}

/** Ohne eigene Konfiguration startet Culinola mit erfundenen Beispielwerten. */
const DEMO_CONFIG: AppConfig = {
  port: 8090,
  sources: [{ id: 'demo', plugin: 'connector-demo' }],
  layouts: {
    main: {
      grid: { columns: 24, rows: 12 },
      widgets: [
        { type: 'clock', at: [0, 0, 8, 2] },
        { type: 'value-tile', at: [0, 2, 4, 1], config: { datapoint: 'demo:temp_wohnen', label: 'Wohnen', secondary: 'demo:feuchte_wohnen', decimals: 1, warn: { lowAlarm: 16, lowWarn: 18, highWarn: 24, highAlarm: 26 } } },
        { type: 'value-tile', at: [4, 2, 4, 1], config: { datapoint: 'demo:temp_bad', label: 'Bad', decimals: 1, warn: { highWarn: 24, highAlarm: 26 } } },
        { type: 'value-tile', at: [8, 2, 4, 1], config: { datapoint: 'demo:temp_aussen', label: 'Außen', decimals: 1 } },
        { type: 'value-tile', at: [12, 2, 4, 1], config: { datapoint: 'demo:co2', label: 'CO₂', warn: { highWarn: 1000, highAlarm: 1500 } } },
        { type: 'value-tile', at: [0, 3, 4, 1], config: { datapoint: 'demo:verbrauch', label: 'Verbrauch' } },
        { type: 'value-tile', at: [4, 3, 4, 1], config: { datapoint: 'demo:solar', label: 'Solar' } },
        { type: 'value-tile', at: [8, 3, 4, 1], config: { datapoint: 'demo:batterie', label: 'Batterie' } },
        { type: 'value-tile', at: [12, 3, 4, 1], config: { datapoint: 'demo:waschen', label: 'Waschen' } },
        {
          type: 'chart',
          at: [0, 4, 16, 6],
          config: {
            title: 'Strom',
            series: [
              { datapoint: 'demo:solar', label: 'Solar', area: true },
              { datapoint: 'demo:verbrauch', label: 'Verbrauch' },
            ],
          },
        },
        {
          type: 'switches',
          at: [0, 10, 16, 2],
          config: {
            items: [
              { datapoint: 'demo:licht_esstisch', label: 'Esstisch' },
              { datapoint: 'demo:licht_vitrine', label: 'Vitrine' },
              { datapoint: 'demo:licht_treppe', label: 'Treppe' },
              { datapoint: 'demo:licht_terrasse', label: 'Terrasse' },
            ],
          },
        },
      ],
    },
  },
};

/**
 * Liest eine JSON-Datei und meldet Fehler so, dass man sie ohne Programmierkenntnis
 * beheben kann – mit Dateiname und der Stelle, an der es hakt.
 */
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${file} lässt sich nicht lesen: ${detail}. Häufige Ursachen: ein Zeilenumbruch mitten in einem eingefügten Wert, ein fehlendes Komma oder ein fehlendes Anführungszeichen.`,
    );
  }
}

export interface LoadedConfig {
  config: AppConfig;
  dataDir: string;
  /** true, wenn keine eigene Konfiguration gefunden wurde. */
  demo: boolean;
}

/** Liest `config.json` aus dem Datenordner (Umgebungsvariable CULINOLA_DATA, sonst `./data`). */
export function loadConfig(): LoadedConfig {
  const dataDir = resolve(process.env.CULINOLA_DATA ?? 'data');
  const file = join(dataDir, 'config.json');
  if (!existsSync(file)) return { config: DEMO_CONFIG, dataDir, demo: true };

  const raw = readJson(file) as Partial<AppConfig>;
  if (!Array.isArray(raw.sources)) throw new Error(`${file}: "sources" fehlt oder ist keine Liste.`);
  if (!raw.layouts || typeof raw.layouts !== 'object') throw new Error(`${file}: "layouts" fehlt.`);
  // "api" ist in secrets.json der Platz für die Zugangstokens
  if (raw.sources.some((source) => source.id === 'api')) throw new Error(`${file}: Eine Quelle darf nicht "api" heißen – der Name ist vergeben.`);
  const config: AppConfig = { port: raw.port ?? 8090, sources: raw.sources, layouts: raw.layouts };
  if (raw.access) config.access = raw.access;
  if (raw.site) config.site = raw.site;
  return { config, dataDir, demo: false };
}

/**
 * Führt die in `config.json` benannten Zugänge mit ihren Tokens aus `secrets.json`
 * zusammen. Ein benannter Zugang ohne Token ist ein Einrichtungsfehler und kein offener Zugang.
 */
export function loadAccess(config: AppConfig, secrets: Record<string, Record<string, string>>): AccessToken[] {
  const entries = config.access?.tokens ?? [];
  if (!Array.isArray(entries)) throw new Error('config.json: "access.tokens" muss eine Liste sein.');
  return entries.map((entry) => {
    if (!entry.name || !isRole(entry.role)) {
      throw new Error(`config.json: Zugang "${entry.name ?? '?'}" braucht einen Namen und eine Stufe (read, control oder admin).`);
    }
    const token = secrets.api?.[entry.name];
    if (!token) throw new Error(`secrets.json: Für den Zugang "${entry.name}" fehlt das Token unter "api".`);
    if (token.length < 16) throw new Error(`secrets.json: Das Token für "${entry.name}" ist zu kurz – mindestens 16 Zeichen.`);
    return { name: entry.name, role: entry.role, token };
  });
}

/**
 * Geheimnisse stehen getrennt von der Konfiguration in `secrets.json`
 * (`{ "<Instanz>": { "<Name>": "…" } }`) und kommen nie über die API zurück.
 */
export function loadSecrets(dataDir: string): Record<string, Record<string, string>> {
  const file = join(dataDir, 'secrets.json');
  if (!existsSync(file)) return {};
  return readJson(file) as Record<string, Record<string, string>>;
}
