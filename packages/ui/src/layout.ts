import type { Grid, Place } from '@culinola/sdk';
import { catalog } from './widgets/catalog.ts';

export interface Widget {
  type: string;
  at: Place;
  config?: unknown;
}

export interface Layout {
  grid: Grid;
  widgets: Widget[];
  /** Breite und Höhe des Bildschirms, für den das Layout gedacht ist – in Bildpunkten oder nur als Verhältnis. */
  screen?: [width: number, height: number];
  /** Eigenes Farbschema für Tag und Nacht; ohne Angabe gilt, was für alle Anzeigen eingestellt ist. */
  theme?: string;
  nightTheme?: string;
}

/** Ein Layout, wie es der Kern liefert: mit dem Stand, auf dem eine Änderung aufbaut. */
export type LoadedLayout = Layout & { rev?: string };

const DATAPOINT_ID = /^[a-z][a-z0-9-]*:[\w.-]+$/;

/** Die Quelle, an der eine Kachel hängt, wenn ihre Konfiguration keine nennt – so, wie es die Beschreibung der Kachel sagt. */
const DEFAULT_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(catalog).flatMap(([type, info]) => (info.source?.key === 'source' && info.source.instance ? [[type, info.source.instance]] : [])),
);

/**
 * Sammelt alle Datenpunkt-Kennungen aus den Widget-Einstellungen: jede Angabe der Form
 * "quelle:name". Was nur so aussieht und keiner ist, schadet nicht – der Kern schickt dazu nichts.
 */
function collectIds(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    if (DATAPOINT_ID.test(value)) found.add(value);
  } else if (Array.isArray(value)) value.forEach((entry) => collectIds(entry, found));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      // Widgets, die an einer ganzen Quelle hängen (Radio, Video, Eieruhr), brauchen alle ihre Datenpunkte
      if ((key === 'source' || key === 'timer' || key === 'tv') && typeof entry === 'string') found.add(`${entry}:*`);
      else collectIds(entry, found);
    }
  }
}

/** Welche Datenpunkte ein Layout braucht – nur diese abonniert die Anzeige. */
export function datapointsOf(layout: Layout): Set<string> {
  const ids = new Set<string>();
  collectIds(layout.widgets, ids);
  for (const widget of layout.widgets) {
    const source = DEFAULT_SOURCES[widget.type];
    if (source && typeof (widget.config as { source?: unknown } | undefined)?.source !== 'string') ids.add(`${source}:*`);
  }
  return ids;
}

/**
 * Ein Schlüssel je Kachel aus Art und Einstellungen. So bleibt eine Kachel dieselbe, wenn sie nur den
 * Platz wechselt – das Radio spielt weiter, das Diagramm lädt nicht neu –, und wird neu aufgebaut,
 * wenn sich ihre Einstellungen ändern.
 */
export function widgetKeys(widgets: readonly Widget[]): string[] {
  const seen = new Map<string, number>();
  return widgets.map((widget) => {
    const content = `${widget.type} ${JSON.stringify(widget.config ?? null)}`;
    const count = seen.get(content) ?? 0;
    seen.set(content, count + 1);
    return `${content} ${count}`;
  });
}

/** Das Layout, das diese Anzeige zeigt: Adresszusatz ?layout=name; ohne ihn gilt "main". */
export function wantedLayout(): string {
  return new URLSearchParams(location.search).get('layout') ?? 'main';
}
