import type Anthropic from '@anthropic-ai/sdk';
import type { Datapoint } from '@culinola/sdk';

/** Name des Werkzeugs, mit dem das Sprachmodell Werte liest – in der Schreibweise der Aktionen ("bereich__name"). */
export const VALUES_TOOL = 'values__read';

/** So viele Werte bekommt das Sprachmodell höchstens zur Auswahl genannt. */
const MAX_VALUES = 200;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Ein Wert, nach dem man fragen kann. */
export interface KnownValue {
  id: string;
  /** So heißt der Wert im Haus: die Beschriftung der Kachel oder der Name aus der Konfiguration. */
  name: string;
  unit?: string;
  /** Bezeichnung aus dem Quellsystem, wenn sie mehr sagt als der Name. */
  label?: string;
}

/**
 * Stellt zusammen, wonach man fragen kann: zuerst die Werte aus der Konfiguration der Sprachsteuerung,
 * dann alles, was auf den Anzeigen steht. Ein Wert ohne Beschriftung heißt wie im Quellsystem; gibt es
 * auch dort keinen Namen, bleibt er weg. Tragen zwei Werte denselben Namen, kommt die Einheit dazu.
 */
export function knownValues(wanted: { id: string; name?: string }[], shown: { id: string; name: string }[], datapoints: Datapoint[]): KnownValue[] {
  const current = new Map(datapoints.map((datapoint) => [datapoint.id, datapoint]));
  const byId = new Map<string, KnownValue>();
  for (const entry of [...wanted, ...shown]) {
    if (byId.has(entry.id)) continue;
    const datapoint = current.get(entry.id);
    const label = datapoint?.label?.replace(/\s+/g, ' ').trim();
    const name = entry.name?.replace(/\s+/g, ' ').trim() || label;
    if (!name) continue;
    byId.set(entry.id, {
      id: entry.id,
      name,
      ...(datapoint?.unit ? { unit: datapoint.unit } : {}),
      ...(label && label.toLowerCase() !== name.toLowerCase() ? { label } : {}),
    });
  }
  const values = [...byId.values()].slice(0, MAX_VALUES);
  // Namen sind der Schlüssel, mit dem das Sprachmodell fragt – sie müssen eindeutig sein
  const taken = new Set<string>();
  for (const value of values) {
    const base = value.name;
    for (const addition of ['', value.unit, value.label, value.id]) {
      if (addition === undefined) continue;
      value.name = addition ? `${base} (${addition})` : base;
      if (!taken.has(value.name.toLowerCase())) break;
    }
    taken.add(value.name.toLowerCase());
  }
  return values;
}

/** Das Werkzeug, mit dem das Sprachmodell Werte liest. Ohne bekannte Werte gibt es keines. */
export function valuesTool(known: KnownValue[]): Anthropic.Tool | undefined {
  if (!known.length) return undefined;
  const lines = known.map((value) => `- ${value.name}${value.unit && !value.name.endsWith(`(${value.unit})`) ? ` [${value.unit}]` : ''}${value.label ? ` – ${value.label}` : ''}`);
  return {
    name: VALUES_TOOL,
    description: `Liest aktuelle Werte aus dem Haus: Temperaturen, Strom, Schalter, wer zu Hause ist, Sonnenzeiten. Nur aufrufen, wenn nach einem Wert gefragt wird, und nur die Werte lesen, die die Frage braucht. Bekannt sind:\n${lines.join('\n')}`,
    input_schema: {
      type: 'object' as const,
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', enum: known.map((value) => value.name) },
          description: 'Namen der Werte, genau wie in der Liste',
        },
      },
      required: ['names'],
    },
  };
}

function clock(time: Date, now: Date, region: string): string {
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' }).format(date);
  const hours = new Intl.DateTimeFormat(region, { timeStyle: 'short' }).format(time);
  return day(time) === day(now) ? `heute ${hours}` : `${new Intl.DateTimeFormat(region, { dateStyle: 'full' }).format(time)}, ${hours}`;
}

function wording(datapoint: Datapoint, now: Date, region: string): string {
  const { value } = datapoint;
  if (typeof value === 'boolean') return value ? 'ja (an, offen oder anwesend – je nachdem, was der Name meint)' : 'nein (aus, zu oder abwesend – je nachdem, was der Name meint)';
  if (typeof value === 'number') return `${Number(value.toFixed(2))}${datapoint.unit ? ` ${datapoint.unit}` : ''}`;
  const text = String(value);
  // Zeitpunkte kommen in Weltzeit; vorgelesen wird die Uhrzeit hier im Haus
  if (ISO_TIME.test(text) && !Number.isNaN(Date.parse(text))) return clock(new Date(text), now, region);
  return `${text.slice(0, 200)}${datapoint.unit ? ` ${datapoint.unit}` : ''}`;
}

/**
 * Die gefragten Werte als Zeilen für das Sprachmodell: "Außen: 12.3 °C". Was es nicht gibt oder gerade
 * keinen Wert hat, steht ehrlich so da – das Modell soll nichts erfinden.
 */
export function readValues(known: KnownValue[], names: string[], datapoints: Datapoint[], options: { now?: Date; region?: string } = {}): string {
  const now = options.now ?? new Date();
  const region = options.region ?? 'de-DE';
  const current = new Map(datapoints.map((datapoint) => [datapoint.id, datapoint]));
  const byName = new Map(known.map((value) => [value.name.toLowerCase(), value]));
  const lines = names.slice(0, 20).map((asked) => {
    const value = byName.get(asked.trim().toLowerCase());
    if (!value) return `${asked}: unbekannt`;
    const datapoint = current.get(value.id);
    if (!datapoint || datapoint.value === null) return `${value.name}: kein Wert vorhanden`;
    if (datapoint.quality === 'error') return `${value.name}: gestört, kein verlässlicher Wert`;
    const stale = datapoint.quality === 'stale' ? ` (veraltet, Stand ${clock(new Date(datapoint.ts), now, region)})` : '';
    return `${value.name}: ${wording(datapoint, now, region)}${stale}`;
  });
  return lines.join('\n') || 'Es wurde kein Wert genannt.';
}
