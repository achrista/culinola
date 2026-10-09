import type { SeriesPoint } from '@culinola/sdk';

/** Eine Ertragsprognose: erwartete Leistung im Zeitverlauf und der Ertrag je Tag. */
export interface Forecast {
  /** Zeitpunkt in Millisekunden und erwartete Leistung in Watt, zeitlich geordnet. */
  points: SeriesPoint[];
  /** Erwarteter Ertrag je Tag in Wattstunden, Schlüssel ist das Datum am Standort (JJJJ-MM-TT). */
  days: Record<string, number>;
  /** Wann die Prognose geholt wurde. */
  fetched: number;
}

export interface Plant {
  latitude: number;
  longitude: number;
  /** Neigung der Module: 0 liegt flach, 90 steht senkrecht. */
  declination: number;
  /** Ausrichtung wie bei forecast.solar: 0 ist Süden, -90 Osten, 90 Westen, 180 Norden. */
  azimuth: number;
  /** Leistung der Anlage in Kilowatt Spitze. */
  kwp: number;
}

/**
 * Die Adresse der Abfrage bei forecast.solar; Zeiten kommen in Weltzeit zurück. Der Dienst rechnet den Standort
 * auf vier Nachkommastellen und die Winkel in ganzen Grad. Ein eigener Schlüssel steht vor dem Pfad.
 */
export function estimateUrl(plant: Plant, base = 'https://api.forecast.solar', apiKey?: string): string {
  const part = (value: number, digits: number) => encodeURIComponent(String(Math.round(value * 10 ** digits) / 10 ** digits));
  const key = apiKey ? `/${encodeURIComponent(apiKey)}` : '';
  return `${base.replace(/\/+$/, '')}${key}/estimate/${part(plant.latitude, 4)}/${part(plant.longitude, 4)}/${part(plant.declination, 0)}/${part(plant.azimuth, 0)}/${part(plant.kwp, 3)}?time=utc`;
}

/** Liest die Antwort von forecast.solar. Wirft, wenn sie keine Prognose enthält. */
export function parseEstimate(body: unknown, fetched: number): Forecast {
  const result = (body as { result?: { watts?: unknown; watt_hours_day?: unknown } } | null)?.result;
  if (!result || typeof result.watts !== 'object' || result.watts === null) throw new Error('Die Antwort enthält keine Prognose.');
  const points: SeriesPoint[] = [];
  for (const [time, watts] of Object.entries(result.watts)) {
    const at = Date.parse(time);
    if (Number.isFinite(at) && typeof watts === 'number' && Number.isFinite(watts)) points.push([at, Math.max(0, watts)]);
  }
  if (!points.length) throw new Error('Die Antwort enthält keine Prognose.');
  points.sort((a, b) => a[0] - b[0]);
  const days: Record<string, number> = {};
  for (const [day, value] of Object.entries((result.watt_hours_day ?? {}) as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof value === 'number' && Number.isFinite(value)) days[day] = value;
  }
  return { points, days, fetched };
}

/**
 * Die erwartete Leistung zu einem Zeitpunkt: zwischen zwei Stützstellen gerade verbunden,
 * vor der ersten und nach der letzten null – dort scheint die Sonne nicht.
 */
export function powerAt(points: SeriesPoint[], time: number): number {
  let before: SeriesPoint | undefined;
  for (const point of points) {
    if (point[0] > time) {
      // Vor der ersten Stützstelle ist es dunkel; über Nacht verbindet die Gerade zwei Nullen und bleibt damit null
      if (!before) return 0;
      const share = (time - before[0]) / (point[0] - before[0]);
      return Math.round(before[1] + (point[1] - before[1]) * share);
    }
    before = point;
  }
  return before && before[0] === time ? before[1] : 0;
}

/** Die Stützstellen eines Zeitraums, an seinen Rändern mit dem dort erwarteten Wert ergänzt. */
export function slice(points: SeriesPoint[], from: number, to: number): SeriesPoint[] {
  const inside = points.filter(([time]) => time >= from && time <= to);
  if (!points.length || points.at(-1)![0] < from || points[0]![0] > to) return [];
  const first: SeriesPoint[] = inside[0]?.[0] === from || from < points[0]![0] ? [] : [[from, powerAt(points, from)]];
  const last: SeriesPoint[] = inside.at(-1)?.[0] === to || to > points.at(-1)![0] ? [] : [[to, powerAt(points, to)]];
  return [...first, ...inside, ...last];
}

/** Führt eine neue Prognose mit der bisherigen zusammen: Was vor ihrem Beginn liegt, bleibt für den Rückblick stehen. */
export function merge(old: Forecast | undefined, fresh: Forecast, keepMs = 3 * 86_400_000): Forecast {
  if (!old) return fresh;
  const start = fresh.points[0]![0];
  const kept = old.points.filter(([time]) => time < start && time >= fresh.fetched - keepMs);
  const oldest = new Date(fresh.fetched - keepMs).toISOString().slice(0, 10);
  const days = Object.fromEntries(Object.entries({ ...old.days, ...fresh.days }).filter(([day]) => day >= oldest));
  return { points: [...kept, ...fresh.points], days, fetched: fresh.fetched };
}

/** Datum am Rechner des Kerns als JJJJ-MM-TT – der Kern steht dort, wo auch die Anlage steht. */
export function dayOf(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
