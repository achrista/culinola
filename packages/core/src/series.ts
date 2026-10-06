import type { SeriesPoint } from '@culinola/sdk';

export type Aggregation = 'avg' | 'min' | 'max' | 'last';

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Liest Angaben wie "30s", "5m", "24h", "7d" als Millisekunden. */
export function parseDuration(text: string): number {
  const match = /^(\d+)([smhd])$/.exec(text.trim());
  if (!match) throw new Error(`Ungültige Dauer "${text}": erwartet wird z. B. "5m" oder "24h".`);
  return Number(match[1]) * UNITS[match[2] as string]!;
}

/** Liest einen Zeitpunkt: ISO-Datum oder relativ zu jetzt ("-24h"). */
export function parseTime(text: string, now: number): number {
  if (text.startsWith('-')) return now - parseDuration(text.slice(1));
  const time = Date.parse(text);
  if (Number.isNaN(time)) throw new Error(`Ungültiger Zeitpunkt "${text}".`);
  return time;
}

/**
 * Verdichtet eine Reihe auf feste Zeitschritte. Leere Schritte werden
 * ausgelassen, damit Lücken im Diagramm als Lücken erkennbar bleiben.
 */
export function downsample(points: readonly SeriesPoint[], stepMs: number, aggregation: Aggregation): SeriesPoint[] {
  if (stepMs <= 0 || points.length === 0) return [...points];
  const buckets = new Map<number, number[]>();
  for (const [time, value] of points) {
    const start = Math.floor(time / stepMs) * stepMs;
    const bucket = buckets.get(start);
    if (bucket) bucket.push(value);
    else buckets.set(start, [value]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, values]) => [start, aggregate(values, aggregation)]);
}

function aggregate(values: number[], aggregation: Aggregation): number {
  switch (aggregation) {
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'last':
      return values[values.length - 1]!;
    case 'avg':
      return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
