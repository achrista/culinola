import type { Grid } from '@culinola/sdk';

/** Wo eine Kachel in der Liste zum Hinzufügen steht. */
export type Group = 'house' | 'media' | 'family' | 'other';
export const GROUPS: readonly Group[] = ['house', 'media', 'family', 'other'];

/**
 * Die Beschreibung einer Kachelart: Was der Editor über sie wissen muss, ohne sie zu zeigen.
 * Name und Beschreibungssatz stehen übersetzt in den Sprachdateien unter `catalog.<Art>`.
 */
export interface WidgetInfo {
  group: Group;
  /** Zeichen als Linienzug auf 24 × 24 – in der Farbe der Schrift gezeichnet, passend zu jedem Farbschema. */
  icon: string;
  /** Übliche und kleinste sinnvolle Größe (Breite, Höhe), gemessen in einem Raster von 48 × 24. */
  size: readonly [number, number];
  min: readonly [number, number];
  /** Einstellungen, mit denen eine neue Kachel beginnt. */
  defaults?: Record<string, unknown>;
  /**
   * Die Quelle, an der die Kachel hängt: das Plugin, das sie braucht, die Einstellung, die dessen Instanz nennt,
   * und die Instanz, die ohne diese Einstellung gilt – dieselbe Vorgabe wie in der Kachel selbst.
   */
  source?: { plugin: string; key: string; instance?: string };
}

/** Das Raster, in dem die Größen oben gemessen sind. */
export const REFERENCE: Grid = { columns: 48, rows: 24 };

export const catalog: Record<string, WidgetInfo> = {
  'value-tile': {
    group: 'house',
    icon: 'M4 16a8 8 0 1 1 16 0M12 16l4-6M3 20h18',
    size: [6, 2],
    min: [3, 1],
    defaults: { datapoint: '', label: '' },
  },
  switches: {
    group: 'house',
    icon: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7Zm8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
    size: [24, 2],
    min: [4, 2],
    defaults: { items: [] },
  },
  chart: {
    group: 'house',
    icon: 'M4 4v16h16M7 15l4-5 3 3 5-7',
    size: [13, 6],
    min: [8, 4],
    defaults: { title: '', series: [] },
  },
  presence: {
    group: 'house',
    icon: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0',
    size: [12, 3],
    min: [3, 2],
    defaults: { items: [] },
  },
  weather: {
    group: 'house',
    icon: 'M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 9.5a4.3 4.3 0 0 1 0 8.5H7Z',
    size: [14, 4],
    min: [6, 3],
  },
  'sun-moon': {
    group: 'house',
    icon: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
    size: [10, 5],
    min: [6, 3],
    source: { plugin: 'source-astro', key: 'source', instance: 'astro' },
  },
  video: {
    group: 'media',
    icon: 'M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm11 4 5-3v8l-5-3',
    size: [10, 6],
    min: [4, 3],
    defaults: { stream: '', label: '' },
    source: { plugin: 'media-video', key: 'source', instance: 'video' },
  },
  radio: {
    group: 'media',
    icon: 'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm2 0 9-4.5M8.5 16.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6-4h3.5m-3.5 3.5h3.5',
    size: [24, 3],
    min: [10, 2],
    source: { plugin: 'media-radio', key: 'source', instance: 'radio' },
  },
  'media-window': {
    group: 'media',
    icon: 'M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 16h8m-6-12 5 2.5-5 2.5V9Z',
    size: [10, 6],
    min: [4, 3],
    source: { plugin: 'media-radio', key: 'source', instance: 'radio' },
  },
  news: {
    group: 'media',
    icon: 'M5 5h11v14H6.5A2.5 2.5 0 0 1 4 16.5V5Zm11 4h4v7.5a2.5 2.5 0 0 1-2.5 2.5M7.5 9h5m-5 3.5h5m-5 3.5h3',
    size: [14, 9],
    min: [8, 3],
    source: { plugin: 'source-rss', key: 'source', instance: 'news' },
  },
  image: {
    group: 'media',
    icon: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm-2 11 5-5 4 4 3-3 6 6M15.5 9.5h.01',
    size: [11, 8],
    min: [3, 2],
    defaults: { url: '', label: '' },
  },
  web: {
    group: 'media',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z',
    size: [12, 8],
    min: [4, 3],
    defaults: { url: '', label: '' },
  },
  calendar: {
    group: 'family',
    icon: 'M5.5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm-2 5h17M8 3v4m8-4v4',
    size: [14, 5],
    min: [8, 3],
    source: { plugin: 'source-google', key: 'source', instance: 'google' },
  },
  reminders: {
    group: 'family',
    icon: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4.5a2 2 0 0 0 4 0',
    size: [14, 4],
    min: [8, 3],
    source: { plugin: 'source-google', key: 'source', instance: 'google' },
  },
  calls: {
    group: 'family',
    icon: 'M5 3.5h3.4l1.6 4.6-2 1.6a12.5 12.5 0 0 0 6.3 6.3l1.6-2 4.6 1.6V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2Z',
    size: [12, 6],
    min: [8, 3],
    source: { plugin: 'source-fritzbox', key: 'source', instance: 'fritzbox' },
  },
  mail: {
    group: 'family',
    icon: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm-1.5 2.5L12 13l8.5-5.5',
    size: [12, 6],
    min: [8, 3],
    source: { plugin: 'source-mail', key: 'source', instance: 'mail' },
  },
  checklist: {
    group: 'family',
    icon: 'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm1 8.5 3 3 5-6.5',
    size: [14, 6],
    min: [6, 3],
    source: { plugin: 'source-merkio', key: 'source', instance: 'merkio' },
  },
  recipes: {
    group: 'family',
    icon: 'M5 10.5h14V16a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5.5Zm-2.5 0h19M9.5 7c0-1.2 1-1.3 1-2.5M13.5 7c0-1.2 1-1.3 1-2.5',
    size: [10, 6],
    min: [6, 2],
    source: { plugin: 'recipes', key: 'source', instance: 'recipes' },
  },
  clock: {
    group: 'other',
    icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3.5 2',
    size: [8, 3],
    min: [4, 2],
    // Ohne Eieruhr zeigt die Uhr nur die Zeit; ist eine eingerichtet, wird sie eingetragen
    source: { plugin: 'timer', key: 'timer' },
  },
  voice: {
    group: 'other',
    icon: 'M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm-6-3.5a6 6 0 0 0 12 0M12 17.5V21',
    size: [3, 3],
    min: [2, 2],
    source: { plugin: 'voice', key: 'source', instance: 'voice' },
  },
  note: {
    group: 'other',
    icon: 'M6 4h12a2 2 0 0 1 2 2v9l-5 5H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm9 16v-5h5M8 9h8m-8 3.500h5',
    size: [8, 3],
    min: [2, 1],
    defaults: { title: '', text: '' },
  },
};

/** Rechnet eine Größe aus dem Bezugsraster in das Raster des Layouts um – nie kleiner als eine Einheit, nie größer als das Raster. */
export function sizeIn(size: readonly [number, number], grid: Grid): [number, number] {
  const scale = (value: number, own: number, reference: number) => Math.min(own, Math.max(1, Math.round((value * own) / reference)));
  return [scale(size[0], grid.columns, REFERENCE.columns), scale(size[1], grid.rows, REFERENCE.rows)];
}

/** Die kleinste sinnvolle Größe einer Kachel im Raster des Layouts; unbekannte Kacheln dürfen bis auf eine Einheit schrumpfen. */
export function minimumOf(type: string, grid: Grid): [number, number] {
  const info = catalog[type];
  return info ? sizeIn(info.min, grid) : [1, 1];
}

/** Eine eingerichtete Quelle, wie der Kern sie unter `/status` nennt. */
export interface Source {
  id: string;
  plugin: string;
}

/**
 * Ob die Quelle einer Kachelart eingerichtet ist – und die Instanz dazu. Die Uhr ist eine Ausnahme:
 * Sie läuft auch ohne Eieruhr.
 */
export function sourceFor(type: string, sources: readonly Source[]): { needed?: string; instance?: string } {
  const wanted = catalog[type]?.source;
  if (!wanted) return {};
  const usual = sources.find((source) => source.plugin === wanted.plugin && source.id === wanted.instance);
  const found = usual ?? sources.find((source) => source.plugin === wanted.plugin);
  if (found) return { instance: found.id };
  return wanted.instance === undefined ? {} : { needed: wanted.plugin };
}

/** Die Einstellungen, mit denen eine neue Kachel beginnt: ihre Vorgaben und die Instanz ihrer Quelle, wo sie nicht die übliche ist. */
export function initialConfig(type: string, sources: readonly Source[]): Record<string, unknown> | undefined {
  const info = catalog[type];
  if (!info) return undefined;
  const config: Record<string, unknown> = structuredClone(info.defaults ?? {});
  const { instance } = sourceFor(type, sources);
  if (info.source && instance !== undefined && instance !== info.source.instance) config[info.source.key] = instance;
  return Object.keys(config).length ? config : undefined;
}
