import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext, SeriesPoint } from '@culinola/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dayOf, estimateUrl, merge, parseEstimate, powerAt, slice } from './forecast.ts';
import plugin from './index.ts';

const at = (time: string) => Date.parse(time);
/** Eine Antwort, wie forecast.solar sie liefert – zwei Tage, Zeiten in Weltzeit. */
const answer = (scale = 1) => ({
  result: {
    watts: {
      '2026-10-09T05:27:00+00:00': 0,
      '2026-10-09T06:00:00+00:00': 800 * scale,
      '2026-10-09T10:00:00+00:00': 6000 * scale,
      '2026-10-09T12:00:00+00:00': 4000 * scale,
      '2026-10-09T16:40:00+00:00': 0,
      '2026-10-10T05:29:00+00:00': 0,
      '2026-10-10T10:00:00+00:00': 3000 * scale,
      '2026-10-10T16:38:00+00:00': 0,
    },
    watt_hours_day: { '2026-10-09': 38_551 * scale, '2026-10-10': 20_817 * scale },
  },
  message: { code: 0, type: 'success' },
});
const plant = { latitude: 48.123456, longitude: 10.9, declination: 10, azimuth: -15, kwp: 18 };

describe('Prognose lesen', () => {
  it('bildet die Abfrage aus den Angaben zur Anlage, den Standort auf rund zehn Meter gerundet', () => {
    expect(estimateUrl(plant)).toBe('https://api.forecast.solar/estimate/48.1235/10.9/10/-15/18?time=utc');
    expect(estimateUrl(plant, 'http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/estimate/48.1235/10.9/10/-15/18?time=utc');
    // Winkel in ganzen Grad; ein eigener Schlüssel steht vor dem Pfad
    expect(estimateUrl({ ...plant, declination: 9.6, azimuth: -14.4, kwp: 17.25 }, undefined, 'abcDEF0123456789')).toBe('https://api.forecast.solar/abcDEF0123456789/estimate/48.1235/10.9/10/-14/17.25?time=utc');
  });

  it('liest Leistung und Tagesertrag und ordnet nach der Zeit', () => {
    const forecast = parseEstimate(answer(), 1000);
    expect(forecast.points).toHaveLength(8);
    expect(forecast.points[1]).toEqual([at('2026-10-09T06:00:00Z'), 800]);
    expect(forecast.days).toEqual({ '2026-10-09': 38_551, '2026-10-10': 20_817 });
    expect(forecast.fetched).toBe(1000);
  });

  it('weist Antworten ohne Prognose zurück und übergeht Unlesbares', () => {
    for (const body of [null, {}, { result: {} }, { result: { watts: {} } }, { result: { watts: { unsinn: 5 } } }, { message: { type: 'error' }, result: null }]) {
      expect(() => parseEstimate(body, 0), JSON.stringify(body)).toThrow(/keine Prognose/);
    }
    const mixed = parseEstimate({ result: { watts: { '2026-10-09T06:00:00+00:00': -5, unsinn: 1, '2026-10-09T07:00:00+00:00': 'viel' }, watt_hours_day: { heute: 1, '2026-10-09': 'x' } } }, 0);
    expect(mixed).toMatchObject({ points: [[at('2026-10-09T06:00:00Z'), 0]], days: {} });
  });
});

describe('Leistung im Tagesverlauf', () => {
  const { points } = parseEstimate(answer(), 0);

  it('verbindet die Stützstellen und ist nachts null', () => {
    expect(powerAt(points, at('2026-10-09T06:00:00Z'))).toBe(800);
    expect(powerAt(points, at('2026-10-09T08:00:00Z'))).toBe(3400);
    expect(powerAt(points, at('2026-10-09T11:00:00Z'))).toBe(5000);
    // vor Sonnenaufgang, in der Nacht zwischen den Tagen und nach dem Ende der Prognose
    for (const time of ['2026-10-09T03:00:00Z', '2026-10-09T22:00:00Z', '2026-10-10T02:00:00Z', '2026-10-11T12:00:00Z']) expect(powerAt(points, at(time)), time).toBe(0);
    expect(powerAt([], 5)).toBe(0);
  });

  it('schneidet einen Zeitraum aus und setzt an seine Ränder den dort erwarteten Wert', () => {
    const part = slice(points, at('2026-10-09T08:00:00Z'), at('2026-10-09T11:00:00Z'));
    expect(part).toEqual([
      [at('2026-10-09T08:00:00Z'), 3400],
      [at('2026-10-09T10:00:00Z'), 6000],
      [at('2026-10-09T11:00:00Z'), 5000],
    ]);
    // Ein ganzer Tag beginnt mit der ersten und endet mit der letzten Stützstelle, die es gibt
    const day = slice(points, at('2026-10-08T22:00:00Z'), at('2026-10-09T21:59:59Z'));
    expect([day[0]![0], day.at(-1)![0], day.length]).toEqual([at('2026-10-09T05:27:00Z'), at('2026-10-09T21:59:59Z'), 6]);
    expect(day.at(-1)![1]).toBe(0);
    expect(slice(points, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'))).toEqual([]);
    expect(slice([], 0, 10)).toEqual([]);
  });

  it('behält beim Erneuern den Rückblick und vergisst, was älter als drei Tage ist', () => {
    const old = { points: [[at('2026-10-05T10:00:00Z'), 1], [at('2026-10-08T10:00:00Z'), 2], [at('2026-10-09T06:00:00Z'), 3]] as SeriesPoint[], days: { '2026-10-05': 1, '2026-10-08': 2, '2026-10-09': 3 }, fetched: 0 };
    const merged = merge(old, parseEstimate(answer(), at('2026-10-09T09:00:00Z')));
    expect(merged.points.slice(0, 2)).toEqual([
      [at('2026-10-08T10:00:00Z'), 2],
      [at('2026-10-09T05:27:00Z'), 0],
    ]);
    expect(merged.days).toEqual({ '2026-10-08': 2, '2026-10-09': 38_551, '2026-10-10': 20_817 });
    expect(merge(undefined, old)).toBe(old);
  });
});

describe('Prognose als Plugin', () => {
  let dir: string;
  const running: AbortController[] = [];
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'culinola-prognose-'));
  });
  afterEach(() => {
    for (const stop of running.splice(0)) stop.abort();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function start(name: string) {
    const stop = new AbortController();
    running.push(stop);
    const datapoints = new Map<string, unknown>();
    const warnings: string[] = [];
    let history: ((id: string, from: Date, to: Date) => Promise<SeriesPoint[]>) | undefined;
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'prognose',
      config: plugin.parseConfig!(plant),
      log: { info: () => undefined, warn: (message) => void warnings.push(message), error: () => undefined },
      secrets: { get: () => undefined },
      storageDir: join(dir, name),
      datapoints: { set: (update) => void datapoints.set(update.id, update.value), list: () => [], shown: () => [] },
      actions: { register: () => undefined, list: () => [], run: async () => undefined },
      resources: { set: () => undefined },
      routes: { get: () => undefined, post: () => undefined },
      onCommand: () => undefined,
      provideHistory: (handler) => void (history = handler),
      signal: stop.signal,
    };
    void plugin.start!(context);
    return { datapoints, warnings, history: (from: string, to: string) => history!('power', new Date(from), new Date(to)), storageDir: context.storageDir };
  }
  const settle = () => new Promise((resume) => setTimeout(resume, 30));

  it('holt die Prognose, meldet Leistung und Ertrag und liefert die Kurve für das Diagramm', async () => {
    vi.useFakeTimers({ now: at('2026-10-09T08:00:00Z'), toFake: ['Date'] });
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => (asked.push(url), Response.json(answer())));
    const shown = start('abruf');
    await settle();
    expect(asked).toEqual(['https://api.forecast.solar/estimate/48.1235/10.9/10/-15/18?time=utc']);
    expect(shown.datapoints.get('power')).toBe(3400);
    expect(shown.datapoints.get(dayOf(Date.now()) === '2026-10-09' ? 'today' : 'tomorrow')).toBe(38.6);
    expect(shown.datapoints.get('updated')).toBe('2026-10-09T08:00:00.000Z');
    expect((await shown.history('2026-10-09T09:00:00Z', '2026-10-09T12:00:00Z')).map(([, watts]) => watts)).toEqual([4700, 6000, 4000]);
    expect(JSON.parse(readFileSync(join(shown.storageDir, 'forecast.json'), 'utf8'))).toMatchObject({ fetched: at('2026-10-09T08:00:00Z') });
  });

  it('nimmt nach einem Neustart die gespeicherte Prognose, solange sie frisch ist', async () => {
    vi.useFakeTimers({ now: at('2026-10-09T08:00:00Z'), toFake: ['Date'] });
    let calls = 0;
    vi.stubGlobal('fetch', async () => (calls++, Response.json(answer())));
    start('neustart');
    await settle();
    vi.setSystemTime(at('2026-10-09T09:00:00Z'));
    const again = start('neustart');
    await settle();
    expect(calls).toBe(1);
    expect(again.datapoints.get('power')).toBe(4700);
  });

  it('behält die alte Prognose, wenn der Dienst nicht antwortet, und meldet das einmal', async () => {
    vi.useFakeTimers({ now: at('2026-10-09T08:00:00Z'), toFake: ['Date'] });
    vi.stubGlobal('fetch', async () => new Response('zu viele', { status: 429 }));
    const shown = start('gesperrt');
    await settle();
    expect(shown.datapoints.get('power')).toBeNull();
    expect(shown.warnings).toEqual([expect.stringMatching(/keine weiteren Abfragen/)]);
    expect(await shown.history('2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z')).toEqual([]);
  });

  it('prüft die Angaben zur Anlage', () => {
    expect(plugin.parseConfig!(plant)).toEqual({ ...plant, refreshMinutes: 180, url: 'https://api.forecast.solar' });
    for (const raw of [{}, { ...plant, latitude: 95 }, { ...plant, declination: -1 }, { ...plant, azimuth: 270 }, { ...plant, kwp: 0 }, { ...plant, refreshMinutes: 2 }, { ...plant, url: 'forecast' }, { ...plant, longitude: '10' }]) {
      expect(() => plugin.parseConfig!(raw), JSON.stringify(raw)).toThrow();
    }
  });
});
