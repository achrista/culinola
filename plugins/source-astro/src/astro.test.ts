import { describe, expect, it } from 'vitest';
import { moon, moonPhaseName, sunPosition, sunTimes } from './astro.ts';
import plugin from './index.ts';

const utc = (text: string) => Date.parse(`${text}Z`);
const minutes = (a: number | undefined, b: number) => Math.abs((a ?? NaN) - b) / 60_000;

describe('Sonnenzeiten', () => {
  it('trifft Auf- und Untergang zur Sommersonnenwende in Berlin auf wenige Minuten', () => {
    // 21. Juni 2026: Aufgang 04:43, Untergang 21:33 Uhr Sommerzeit
    const times = sunTimes(utc('2026-06-21T10:00:00'), 52.52, 13.405);
    expect(minutes(times.sunrise, utc('2026-06-21T02:43:00'))).toBeLessThan(4);
    expect(minutes(times.sunset, utc('2026-06-21T19:33:00'))).toBeLessThan(4);
    expect(minutes(times.noon, utc('2026-06-21T11:08:00'))).toBeLessThan(4);
    expect(times.dawn!).toBeLessThan(times.sunrise!);
    expect(times.dusk!).toBeGreaterThan(times.sunset!);
  });

  it('trifft sie auch zur Wintersonnenwende in München', () => {
    // 21. Dezember 2026: Aufgang 08:01, Untergang 16:22 Uhr Winterzeit
    const times = sunTimes(utc('2026-12-21T11:00:00'), 48.137, 11.575);
    expect(minutes(times.sunrise, utc('2026-12-21T07:01:00'))).toBeLessThan(4);
    expect(minutes(times.sunset, utc('2026-12-21T15:22:00'))).toBeLessThan(4);
  });

  it('liefert für jede Uhrzeit des Tages dieselben Zeiten', () => {
    const morning = sunTimes(utc('2026-10-09T05:00:00'), 48.4, 10.9);
    const evening = sunTimes(utc('2026-10-09T20:00:00'), 48.4, 10.9);
    expect(minutes(morning.sunrise, evening.sunrise!)).toBeLessThan(0.01);
    expect(minutes(morning.sunset, evening.sunset!)).toBeLessThan(0.01);
  });

  it('kennt Polartag und Polarnacht', () => {
    const summer = sunTimes(utc('2026-06-21T12:00:00'), 78.2, 15.6);
    expect([summer.sunrise, summer.sunset]).toEqual([undefined, undefined]);
    expect(Number.isFinite(summer.noon)).toBe(true);
    const winter = sunTimes(utc('2026-12-21T12:00:00'), 78.2, 15.6);
    expect([winter.sunrise, winter.sunset, winter.dawn]).toEqual([undefined, undefined, undefined]);
  });
});

describe('Sonnenstand', () => {
  it('steht mittags im Süden und nachts unter dem Horizont', () => {
    const noon = sunPosition(sunTimes(utc('2026-06-21T10:00:00'), 52.52, 13.405).noon, 52.52, 13.405);
    // Höchststand zur Sommersonnenwende: 90° − Breite + 23,44°
    expect(noon.altitude).toBeCloseTo(60.9, 0);
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(1);
    expect(sunPosition(utc('2026-06-21T23:00:00'), 52.52, 13.405).altitude).toBeLessThan(0);
    // Am Morgen im Osten, am Abend im Westen
    expect(sunPosition(utc('2026-06-21T05:00:00'), 52.52, 13.405).azimuth).toBeLessThan(110);
    expect(sunPosition(utc('2026-06-21T17:00:00'), 52.52, 13.405).azimuth).toBeGreaterThan(250);
  });

  it('steht bei Auf- und Untergang am Horizont', () => {
    const times = sunTimes(utc('2026-10-09T10:00:00'), 48.4, 10.9);
    expect(Math.abs(sunPosition(times.sunrise!, 48.4, 10.9).altitude + 0.833)).toBeLessThan(0.3);
    expect(Math.abs(sunPosition(times.sunset!, 48.4, 10.9).altitude + 0.833)).toBeLessThan(0.3);
  });
});

describe('Mond', () => {
  it('trifft bekannte Voll- und Neumonde', () => {
    // Vollmond am 17. Oktober 2024, 11:26 Uhr; Neumond am 2. Oktober 2024, 18:49 Uhr Weltzeit
    const full = moon(utc('2024-10-17T11:26:00'));
    expect(Math.abs(full.phase - 0.5)).toBeLessThan(0.03);
    expect(full.illumination).toBeGreaterThan(0.98);
    const dark = moon(utc('2024-10-02T18:49:00'));
    expect(Math.min(dark.phase, 1 - dark.phase)).toBeLessThan(0.03);
    expect(dark.illumination).toBeLessThan(0.02);
  });

  it('benennt die Phasen', () => {
    expect([0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.995].map(moonPhaseName)).toEqual(['new', 'waxing-crescent', 'first-quarter', 'waxing-gibbous', 'full', 'waning-gibbous', 'last-quarter', 'waning-crescent', 'new']);
  });
});

describe('Konfiguration', () => {
  it('verlangt einen Standort', () => {
    expect(plugin.parseConfig!({ latitude: 48.4, longitude: 10.9 })).toEqual({ latitude: 48.4, longitude: 10.9 });
    for (const raw of [{}, { latitude: 48.4 }, { latitude: 95, longitude: 10 }, { latitude: '48', longitude: 10 }, { latitude: 48, longitude: 200 }]) expect(() => plugin.parseConfig!(raw), JSON.stringify(raw)).toThrow();
  });
});
