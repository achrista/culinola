import { describe, expect, it } from 'vitest';
import { beaufort, compassPoint, isNight, toKmh, uvLevel, weatherIcon } from './weather.ts';

describe('weatherIcon', () => {
  it('liest Wetterkennzahlen und unterscheidet Tag und Nacht nur, wo es etwas zu sehen gibt', () => {
    expect(weatherIcon('800', '')).toBe('clear-day');
    expect(weatherIcon(800, '', true)).toBe('clear-night');
    expect(weatherIcon('802', '', true)).toBe('partly-cloudy-night');
    expect(weatherIcon('804', '', true)).toBe('overcast');
    expect(weatherIcon('211', '')).toBe('thunderstorms-rain');
    expect(weatherIcon('301', '')).toBe('drizzle');
    expect(weatherIcon('501', '')).toBe('rain');
    expect(weatherIcon('511', '')).toBe('sleet');
    expect(weatherIcon('601', '')).toBe('snow');
    expect(weatherIcon('615', '')).toBe('sleet');
    expect(weatherIcon('701', '')).toBe('mist');
    expect(weatherIcon('741', '')).toBe('fog');
  });

  it('liest Symbolkennungen, die die Tageszeit selbst nennen', () => {
    expect(weatherIcon('01n', '')).toBe('clear-night');
    expect(weatherIcon('02d', '', true)).toBe('partly-cloudy-day');
    expect(weatherIcon('10n', '')).toBe('rain');
    expect(weatherIcon('50d', '')).toBe('mist');
  });

  it('deutet deutsche und englische Beschreibungen', () => {
    expect(weatherIcon(undefined, 'Klarer Himmel')).toBe('clear-day');
    expect(weatherIcon(undefined, 'Klarer Himmel', true)).toBe('clear-night');
    expect(weatherIcon(undefined, 'Ein paar Wolken')).toBe('partly-cloudy-day');
    expect(weatherIcon(undefined, 'Überwiegend bewölkt')).toBe('cloudy');
    expect(weatherIcon(undefined, 'Bedeckt')).toBe('overcast');
    expect(weatherIcon(undefined, 'Leichter Regen')).toBe('rain');
    expect(weatherIcon(undefined, 'Mäßiger Schneeregen')).toBe('sleet');
    expect(weatherIcon(undefined, 'Gewitter mit leichtem Regen')).toBe('thunderstorms-rain');
    expect(weatherIcon(undefined, 'light snow')).toBe('snow');
    expect(weatherIcon(undefined, 'scattered clouds', true)).toBe('partly-cloudy-night');
    expect(weatherIcon(undefined, 'Nebel')).toBe('fog');
  });

  it('zieht die Kennzahl dem Text vor und fällt bei Unbekanntem auf den Text zurück', () => {
    expect(weatherIcon('500', 'Klarer Himmel')).toBe('rain');
    expect(weatherIcon('999', 'Klarer Himmel')).toBe('clear-day');
    expect(weatherIcon('NULL', 'Bedeckt')).toBe('overcast');
  });

  it('zeigt bei fehlenden Angaben das Symbol für „nicht verfügbar“', () => {
    expect(weatherIcon(undefined, undefined)).toBe('not-available');
    expect(weatherIcon('', 'UNDEF')).toBe('not-available');
    expect(weatherIcon(null, 42)).toBe('not-available');
  });
});

describe('isNight', () => {
  const at = (time: string) => new Date(`2026-10-06T${time}:00`).getTime();
  const rise = new Date('2026-10-06T07:23:00').toISOString();
  const set = new Date('2026-10-06T18:44:00').toISOString();

  it('unterscheidet Tag und Nacht nach Sonnenauf- und -untergang', () => {
    expect(isNight(at('07:22'), rise, set)).toBe(true);
    expect(isNight(at('07:23'), rise, set)).toBe(false);
    expect(isNight(at('18:43'), rise, set)).toBe(false);
    expect(isNight(at('18:44'), rise, set)).toBe(true);
  });

  it('vergleicht nur die Uhrzeit, auch wenn die Angaben vom Vortag stammen', () => {
    expect(isNight(new Date('2026-10-07T12:00:00').getTime(), rise, set)).toBe(false);
    expect(isNight(new Date('2026-10-07T23:00:00').getTime(), rise, set)).toBe(true);
  });

  it('nimmt ohne brauchbare Angaben den Tag an', () => {
    expect(isNight(at('02:00'), undefined, undefined)).toBe(false);
    expect(isNight(at('02:00'), 'UNDEF', set)).toBe(false);
  });
});

describe('Wind', () => {
  it('ordnet Grad einer von acht Himmelsrichtungen zu', () => {
    expect([0, 22, 23, 90, 180, 270, 337, 338, 360, -45, 725].map(compassPoint)).toEqual([0, 0, 1, 2, 4, 6, 7, 0, 0, 7, 0]);
  });

  it('bestimmt die Windstärke nach Beaufort', () => {
    expect([0, 0.9, 1, 5.9, 19, 20, 61, 117, 118, 200].map(beaufort)).toEqual([0, 0, 1, 1, 3, 4, 7, 11, 12, 12]);
  });

  it('rechnet Geschwindigkeiten in km/h um', () => {
    expect(toKmh(10, 'm/s')).toBeCloseTo(36);
    expect(toKmh(10, 'mph')).toBeCloseTo(16.09, 2);
    expect(toKmh(10, 'kn')).toBeCloseTo(18.52);
    expect(toKmh(10, 'km/h')).toBe(10);
    expect(toKmh(10, undefined)).toBe(10);
  });
});

describe('uvLevel', () => {
  it('teilt den UV-Index in die fünf Gefahrenstufen ein', () => {
    expect([0, 2.4, 2.5, 5, 6, 7.4, 8, 10, 10.5, 14].map(uvLevel)).toEqual(['low', 'low', 'moderate', 'moderate', 'high', 'high', 'veryHigh', 'veryHigh', 'extreme', 'extreme']);
  });
});
