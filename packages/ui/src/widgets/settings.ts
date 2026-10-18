/**
 * Die Einstellungen der Kacheln, so beschrieben, dass der Editor daraus ein Formular bauen kann.
 * Bezeichnungen stehen übersetzt in den Sprachdateien: `fields.<Kachelart>.<Name>`, sonst `fields.common.<Name>`;
 * ein Hinweis dazu unter demselben Namen mit angehängtem `Hint`.
 *
 * Was hier nicht steht, bleibt in der Kachel erhalten und lässt sich im Editor als JSON ändern.
 */
export type Field = {
  /** Bezeichnung und Hinweis, die die Einstellung selbst mitbringt – so beschreiben Plugins ihre Einstellungen. */
  label?: Record<string, string>;
  hint?: Record<string, string>;
} & (
  | { key: string; type: 'text'; placeholder?: string; initial?: string }
  | { key: string; type: 'number'; min?: number; max?: number; step?: number; placeholder?: number; initial?: number }
  /** `fallback` ist, was ohne die Angabe gilt – genau dann steht sie nicht in der Konfiguration. */
  | { key: string; type: 'boolean'; fallback?: boolean }
  /** Mehrere kurze Texte, im Formular durch Komma getrennt. */
  | { key: string; type: 'tags' }
  /** Auswahl aus festen Werten; der erste ist die Vorgabe. Bezeichnungen unter `fields.options.<Name>.<Wert>`. */
  | { key: string; type: 'select'; options: readonly string[]; explicit?: boolean }
  /**
   * Ein Datenpunkt. `writable` grenzt die Auswahl zunächst auf Schaltbares ein. Mit `inner` darf die Angabe auch
   * ein Objekt sein, das den Datenpunkt unter diesem Namen trägt – dann bleibt der Rest des Objekts stehen.
   */
  | { key: string; type: 'datapoint'; writable?: boolean; inner?: string }
  /** Eine eingerichtete Instanz dieses Plugins. */
  | { key: string; type: 'source'; plugin: string }
  /** Einträge zum Hinzufügen, Sortieren und Entfernen. */
  | { key: string; type: 'list'; fields: readonly Field[] }
  /** Zusammengehörige Angaben in einem aufklappbaren Abschnitt. */
  | { key: string; type: 'group'; fields: readonly Field[] }
);

/**
 * Lässt sich die Angabe im Formular bearbeiten? Eine Liste, in der anderes als Objekte steht (etwa Kurzformen
 * wie "dw-de"), und Texte mit Komma, zwischen denen anderes als Text steht, würde das Formular verstümmeln –
 * sie bleiben, wie sie sind, und lassen sich als JSON ändern.
 */
export function editable(field: Field, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (field.type === 'list') return Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  if (field.type === 'tags') return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  return true;
}

/** Die Einstellungen, mit denen eine neue Quelle beginnt: was ihr Plugin als Vorgabe nennt – so steht es sichtbar im Formular. */
export function initialValues(fields: readonly Field[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => ((field.type === 'text' || field.type === 'number') && field.initial !== undefined ? [[field.key, field.initial]] : [])));
}

/** Ein neuer Eintrag einer Liste: leer – bis auf Auswahlen, die das Plugin immer verlangt. */
export function blankEntry(fields: readonly Field[]): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => (field.type === 'select' && field.explicit ? [[field.key, field.options[0]]] : [])));
}

const title: Field = { key: 'title', type: 'text' };
const label: Field = { key: 'label', type: 'text' };
const datapoint: Field = { key: 'datapoint', type: 'datapoint' };
const source = (plugin: string): Field => ({ key: 'source', type: 'source', plugin });
const points = (...keys: string[]): Field[] => keys.map((key) => ({ key, type: 'datapoint' }));

export const settings: Record<string, readonly Field[]> = {
  'value-tile': [
    datapoint,
    label,
    { key: 'secondary', type: 'datapoint', inner: 'datapoint' },
    { key: 'unit', type: 'text' },
    { key: 'decimals', type: 'number', min: 0, max: 6 },
    { key: 'factor', type: 'number', step: 0.001 },
    { key: 'gauge', type: 'group', fields: [{ key: 'min', type: 'number', placeholder: 0 }, { key: 'max', type: 'number' }] },
    { key: 'warn', type: 'group', fields: ['lowAlarm', 'lowWarn', 'highWarn', 'highAlarm'].map((key): Field => ({ key, type: 'number' })) },
    { key: 'fresh', type: 'datapoint' },
    { key: 'chart', type: 'group', fields: [title, { key: 'series', type: 'list', fields: [datapoint, label, { key: 'factor', type: 'number', step: 0.001 }, { key: 'step', type: 'boolean' }] }] },
  ],
  switches: [
    {
      key: 'items',
      type: 'list',
      fields: [{ key: 'datapoint', type: 'datapoint', writable: true }, label, { key: 'type', type: 'select', options: ['switch', 'cover'] }, { key: 'up', type: 'text' }, { key: 'down', type: 'text' }],
    },
    { key: 'columns', type: 'number', min: 1, max: 12 },
  ],
  chart: [
    title,
    {
      key: 'series',
      type: 'list',
      fields: [datapoint, label, { key: 'area', type: 'boolean' }, { key: 'forecast', type: 'boolean' }, { key: 'factor', type: 'number', step: 0.001 }, { key: 'step', type: 'boolean' }],
    },
  ],
  presence: [
    { key: 'items', type: 'list', fields: [datapoint, label] },
    { key: 'home', type: 'tags' },
  ],
  weather: [
    ...points('temperature', 'condition', 'code'),
    { key: 'wind', type: 'group', fields: [...points('direction', 'speed'), { key: 'unit', type: 'text', placeholder: 'km/h' }] },
    ...points('uv', 'sunrise', 'sunset'),
    { key: 'days', type: 'list', fields: points('condition', 'code', 'max', 'min') },
  ],
  'sun-moon': [source('source-astro')],
  video: [source('media-video'), { key: 'stream', type: 'text' }, label, { key: 'tv', type: 'source', plugin: 'media-radio' }, { key: 'fit', type: 'select', options: ['cover', 'fill', 'contain'] }],
  radio: [source('media-radio')],
  'media-window': [source('media-radio'), { key: 'video', type: 'source', plugin: 'media-video' }, { key: 'idle', type: 'text' }],
  news: [source('source-rss'), { key: 'feeds', type: 'tags' }, { key: 'seconds', type: 'number', min: 1 }, { key: 'closeAfter', type: 'number', min: 0 }],
  image: [{ key: 'url', type: 'text', placeholder: 'https://…' }, label, { key: 'refreshSeconds', type: 'number', min: 1, placeholder: 300 }, { key: 'fit', type: 'select', options: ['cover', 'contain'] }],
  web: [
    { key: 'url', type: 'text', placeholder: 'https://…' },
    label,
    { key: 'zoom', type: 'number', min: 0.1, max: 4, step: 0.05, placeholder: 1 },
    { key: 'refreshMinutes', type: 'number', min: 1 },
    { key: 'interactive', type: 'boolean' },
  ],
  calendar: [source('source-google'), title],
  reminders: [source('source-google'), title],
  calls: [source('source-fritzbox'), title, { key: 'sound', type: 'boolean', fallback: true }],
  mail: [source('source-mail'), title],
  checklist: [source('source-merkio'), { key: 'list', type: 'text' }, title, { key: 'recentHours', type: 'number', min: 0, placeholder: 12 }],
  recipes: [source('recipes'), title, { key: 'seconds', type: 'number', min: 1 }],
  clock: [
    { key: 'timer', type: 'source', plugin: 'timer' },
    { key: 'ringVolume', type: 'number', min: 0, max: 200, placeholder: 100 },
    { key: 'reminderVolume', type: 'number', min: 0, max: 200, placeholder: 40 },
  ],
  voice: [source('voice'), title, { key: 'speak', type: 'boolean', fallback: true }, { key: 'wakeWord', type: 'text' }],
  note: [title, { key: 'text', type: 'text' }],
};

/** Setzt eine Angabe in einer Kopie; ohne Wert (leeres Feld) verschwindet sie – der Rest bleibt, wie er ist. */
export function withValue(config: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const next = { ...config };
  const empty = value === undefined || value === null || value === '' || (typeof value === 'number' && Number.isNaN(value));
  if (empty) delete next[key];
  else next[key] = value;
  return next;
}

/** Der Datenpunkt einer Angabe, die ihn auch in einem Objekt tragen darf. */
export function datapointIn(value: unknown, inner?: string): string {
  if (typeof value === 'string') return value;
  const held = inner && value && typeof value === 'object' ? (value as Record<string, unknown>)[inner] : undefined;
  return typeof held === 'string' ? held : '';
}

/** Trägt einen Datenpunkt ein; ein Objekt um ihn herum behält seine übrigen Angaben. */
export function withDatapoint(value: unknown, id: string, inner?: string): unknown {
  if (inner && value && typeof value === 'object' && !Array.isArray(value)) return id ? { ...value, [inner]: id } : undefined;
  return id || undefined;
}

/** Text mit Kommas in eine Liste – und leer, wenn nichts übrig bleibt. */
export function tagsOf(text: string): string[] | undefined {
  const tags = text.split(',').map((tag) => tag.trim()).filter(Boolean);
  return tags.length ? tags : undefined;
}

/** Versetzt einen Eintrag einer Liste um einen Platz; am Rand bleibt die Liste, wie sie ist. */
export function shifted<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const next = [...list];
  const target = index + by;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
