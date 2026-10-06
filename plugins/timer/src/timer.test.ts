import { describe, expect, it } from 'vitest';
import { countdown, extend, MAX_SECONDS, restore, settle, stopwatch } from './timer.ts';

const NOW = Date.parse('2026-10-06T12:00:00Z');

describe('countdown', () => {
  it('stellt die Eieruhr auf volle Sekunden', () => {
    expect(countdown(NOW, 390.4)).toEqual({ mode: 'down', end: NOW + 390_000, duration: 390 });
  });

  it('weist unbrauchbare Dauern ab', () => {
    expect(() => countdown(NOW, 0)).toThrow(/mindestens eine Sekunde/);
    expect(() => countdown(NOW, Number.NaN)).toThrow(/mindestens eine Sekunde/);
    expect(() => countdown(NOW, MAX_SECONDS + 1)).toThrow(/höchstens 24 Stunden/);
  });
});

describe('settle', () => {
  it('meldet erst, wenn die Zeit um ist', () => {
    const running = countdown(NOW, 60);
    expect(settle(running, NOW + 59_999)).toBe(running);
    expect(settle(running, NOW + 60_000)).toEqual({ mode: 'done', end: NOW + 60_000, duration: 60 });
  });

  it('lässt Stoppuhr und Ruhezustand unberührt', () => {
    expect(settle(stopwatch(NOW), NOW + 1e9)).toEqual({ mode: 'up', since: NOW });
    expect(settle({ mode: 'idle' }, NOW)).toEqual({ mode: 'idle' });
  });
});

describe('extend', () => {
  it('verlängert und verkürzt die laufende Eieruhr', () => {
    const running = countdown(NOW, 300);
    expect(extend(running, NOW + 10_000, 60)).toEqual({ mode: 'down', end: NOW + 360_000, duration: 360 });
    expect(extend(running, NOW + 10_000, -60)).toEqual({ mode: 'down', end: NOW + 240_000, duration: 240 });
  });

  it('lässt sie ablaufen, wenn mehr abgezogen wird, als übrig ist', () => {
    expect(extend(countdown(NOW, 30), NOW + 10_000, -60).mode).toBe('done');
  });

  it('gibt nach dem Klingeln noch eine Minute', () => {
    const done = settle(countdown(NOW, 60), NOW + 60_000);
    expect(extend(done, NOW + 75_000, 60)).toEqual({ mode: 'down', end: NOW + 135_000, duration: 60 });
  });

  it('weist ab, was sich nicht verlängern lässt', () => {
    expect(() => extend({ mode: 'idle' }, NOW, 60)).toThrow(/keine Eieruhr/);
    expect(() => extend(stopwatch(NOW), NOW, 60)).toThrow(/keine Eieruhr/);
    expect(() => extend(countdown(NOW, 60), NOW, 0)).toThrow(/seconds/);
    expect(() => extend(countdown(NOW, MAX_SECONDS), NOW, 60)).toThrow(/höchstens 24 Stunden/);
  });
});

describe('restore', () => {
  it('setzt eine laufende Eieruhr nach einem Neustart fort', () => {
    expect(restore({ mode: 'down', end: NOW + 5000, duration: 60 }, NOW)).toEqual({ mode: 'down', end: NOW + 5000, duration: 60 });
  });

  it('meldet eine Eieruhr, die während des Neustarts abgelaufen ist', () => {
    expect(restore({ mode: 'down', end: NOW - 5000, duration: 60 }, NOW)).toEqual({ mode: 'done', end: NOW - 5000, duration: 60 });
  });

  it('setzt die Stoppuhr fort, aber keine aus der Zukunft oder von vorgestern', () => {
    expect(restore({ mode: 'up', since: NOW - 90_000 }, NOW)).toEqual({ mode: 'up', since: NOW - 90_000 });
    expect(restore({ mode: 'up', since: NOW + 1000 }, NOW)).toEqual({ mode: 'idle' });
    expect(restore({ mode: 'up', since: NOW - 2 * MAX_SECONDS * 1000 }, NOW)).toEqual({ mode: 'idle' });
  });

  it('wertet alles Unlesbare als Ruhezustand', () => {
    for (const raw of [undefined, null, 'x', {}, { mode: 'down' }, { mode: 'down', end: 'bald', duration: 60 }, { mode: 'sonstwas', end: 1, duration: 1 }]) {
      expect(restore(raw, NOW)).toEqual({ mode: 'idle' });
    }
  });
});
