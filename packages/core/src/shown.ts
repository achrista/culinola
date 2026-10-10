import type { LayoutConfig } from './config.ts';

/** Ein Datenpunkt, der auf einer Anzeige steht, mit seiner Beschriftung dort. */
export interface ShownDatapoint {
  id: string;
  /** So heißt der Wert auf der Anzeige – und damit im Haus. Leer, wenn die Kachel ihn nicht beschriftet. */
  name: string;
}

const DATAPOINT_ID = /^[a-z][a-z0-9-]*:[\w.-]+$/;
const NAME_KEYS = ['label', 'title', 'name'] as const;

/**
 * Sammelt aus allen Layouts, welche Datenpunkte die Anzeigen zeigen und wie sie dort heißen:
 * `{ "datapoint": "openhab:Mess_TAussen", "label": "Außen" }` ergibt „Außen“. Datenpunkte, die
 * eine Kachel nur nebenbei nutzt (zweiter Wert, Frische), kommen ohne Namen mit. Steht ein
 * Datenpunkt mehrfach da, gilt die erste Beschriftung.
 */
export function shownDatapoints(layouts: Record<string, LayoutConfig>): ShownDatapoint[] {
  const found = new Map<string, string>();
  const note = (id: string, name: string) => {
    if (!found.get(id)) found.set(id, name);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const entry = value as Record<string, unknown>;
    const named = NAME_KEYS.map((key) => entry[key]).find((name): name is string => typeof name === 'string' && !!name.trim());
    for (const [key, inner] of Object.entries(entry)) {
      if (typeof inner === 'string') {
        if (DATAPOINT_ID.test(inner)) note(inner, key === 'datapoint' ? (named?.trim() ?? '') : '');
      } else walk(inner);
    }
  };
  for (const layout of Object.values(layouts)) for (const widget of layout?.widgets ?? []) walk(widget.config);
  return [...found].map(([id, name]) => ({ id, name }));
}
