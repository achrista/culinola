import { describe, expect, it } from 'vitest';
import { downsample, parseDuration, parseTime } from './series.ts';

describe('parseDuration', () => {
  it('liest Sekunden, Minuten, Stunden und Tage', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('24h')).toBe(86_400_000);
    expect(parseDuration('7d')).toBe(604_800_000);
  });

  it('lehnt Unbekanntes ab', () => {
    expect(() => parseDuration('5 Minuten')).toThrow(/Ungültige Dauer/);
  });
});

describe('parseTime', () => {
  it('rechnet relative Angaben von jetzt zurück', () => {
    expect(parseTime('-1h', 10_000_000)).toBe(10_000_000 - 3_600_000);
  });

  it('liest ISO-Zeitpunkte', () => {
    expect(parseTime('2026-10-07T12:00:00Z', 0)).toBe(Date.UTC(2026, 9, 7, 12));
  });
});

describe('downsample', () => {
  it('bildet je Zeitschritt den Mittelwert und lässt leere Schritte aus', () => {
    const points: [number, number][] = [[0, 10], [500, 20], [1000, 30], [5000, 50]];
    expect(downsample(points, 1000, 'avg')).toEqual([[0, 15], [1000, 30], [5000, 50]]);
  });

  it('kennt Minimum, Maximum und letzten Wert', () => {
    const points: [number, number][] = [[0, 10], [500, 20], [900, 5]];
    expect(downsample(points, 1000, 'min')).toEqual([[0, 5]]);
    expect(downsample(points, 1000, 'max')).toEqual([[0, 20]]);
    expect(downsample(points, 1000, 'last')).toEqual([[0, 5]]);
  });
});
