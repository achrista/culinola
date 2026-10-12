import type { Field } from '../widgets/settings.ts';

/** Eine Meldung, wie das Formular sie zeigt: der Name als Feld, die Bedingung mit Art und Wert als Text. */
export type EventEntry = Record<string, unknown>;

/** Die Felder einer Meldung. Bezeichnungen stehen in den Sprachdateien unter `fields.events`. */
export const EVENT_FIELDS: readonly Field[] = [
  { key: 'name', type: 'text' },
  { key: 'text', type: 'text' },
  { key: 'sound', type: 'select', options: ['chime', 'bell', 'beep', 'none'] },
  { key: 'speak', type: 'boolean' },
  { key: 'seconds', type: 'number', min: 1, max: 3600 },
  { key: 'video', type: 'text' },
  { key: 'videoSource', type: 'text', placeholder: 'video' },
  { key: 'signal', type: 'boolean' },
  {
    key: 'when',
    type: 'group',
    fields: [
      { key: 'datapoint', type: 'datapoint' },
      { key: 'test', type: 'select', options: ['equals', 'above', 'below'], explicit: true },
      { key: 'value', type: 'text' },
    ],
  },
];

const TESTS = ['equals', 'above', 'below'] as const;

/** Aus dem Abschnitt "events" der Konfiguration werden Einträge für das Formular. Was es nicht kennt, bleibt am Eintrag. */
export function toEntries(events: Record<string, unknown>): EventEntry[] {
  return Object.entries(events).map(([name, raw]) => {
    const { show, when, ...rest } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const entry: EventEntry = { name, ...rest };
    if (show === false) entry['signal'] = true;
    if (when && typeof when === 'object') {
      const condition = when as Record<string, unknown>;
      const test = TESTS.find((key) => condition[key] !== undefined) ?? 'equals';
      entry['when'] = { datapoint: condition['datapoint'] ?? '', test, value: condition[test] === undefined ? '' : String(condition[test]) };
    }
    return entry;
  });
}

/**
 * Der Wert einer Bedingung aus dem Textfeld: „genau“ nimmt wahr/falsch, eine Zahl oder sonst den Text –
 * „über“ und „unter“ brauchen eine Zahl.
 */
export function conditionValue(test: string, text: string): string | number | boolean {
  const trimmed = text.trim();
  const number = Number(trimmed.replace(',', '.'));
  if (test !== 'equals') return number;
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  return trimmed !== '' && Number.isFinite(number) ? number : trimmed;
}

/** Aus den Einträgen des Formulars wird wieder der Abschnitt "events". Wirft mit einer Meldung, wenn ein Name fehlt oder doppelt ist. */
export function toEvents(entries: readonly EventEntry[], problems: { noName: string; twice: (name: string) => string }): Record<string, unknown> {
  const events: Record<string, unknown> = {};
  for (const entry of entries) {
    const { name, signal, when, ...rest } = entry;
    const key = typeof name === 'string' ? name.trim() : '';
    if (!key) throw new Error(problems.noName);
    if (Object.hasOwn(events, key)) throw new Error(problems.twice(key));
    const event: Record<string, unknown> = { ...rest };
    if (signal === true) event['show'] = false;
    const condition = (when && typeof when === 'object' ? when : {}) as Record<string, unknown>;
    if (typeof condition['datapoint'] === 'string' && condition['datapoint']) {
      const test = typeof condition['test'] === 'string' ? condition['test'] : 'equals';
      event['when'] = { datapoint: condition['datapoint'], [test]: conditionValue(test, String(condition['value'] ?? '')) };
    }
    events[key] = event;
  }
  return events;
}
