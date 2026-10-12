import { describe, expect, it } from 'vitest';
import { inside, layoutProblems, overlaps } from './layout.ts';

describe('overlaps', () => {
  it('erkennt Kacheln, die übereinander liegen', () => {
    expect(overlaps([0, 0, 4, 2], [3, 1, 4, 2])).toBe(true);
    expect(overlaps([2, 2, 1, 1], [0, 0, 8, 8])).toBe(true);
  });

  it('lässt Kacheln nebeneinander und untereinander zu', () => {
    expect(overlaps([0, 0, 4, 2], [4, 0, 4, 2])).toBe(false);
    expect(overlaps([0, 0, 4, 2], [0, 2, 4, 2])).toBe(false);
  });
});

describe('inside', () => {
  const grid = { columns: 12, rows: 6 };

  it('nimmt Kacheln bis an den Rand an', () => {
    expect(inside([0, 0, 12, 6], grid)).toBe(true);
    expect(inside([11, 5, 1, 1], grid)).toBe(true);
  });

  it('weist ab, was über den Rand reicht oder keine Fläche hat', () => {
    for (const at of [[11, 0, 2, 1], [0, 5, 1, 2], [-1, 0, 2, 1], [0, 0, 0, 1], [0, 0, 1, -1]] as const) {
      expect(inside([...at], grid), JSON.stringify(at)).toBe(false);
    }
  });
});

describe('layoutProblems', () => {
  const grid = { columns: 12, rows: 6 };
  const good = { grid, widgets: [{ type: 'clock', at: [0, 0, 4, 2] }, { type: 'gibt-es-nicht', at: [4, 0, 8, 6], config: { beliebig: true } }] };

  it('findet an einem ordentlichen Layout nichts – auch nicht an unbekannten Kacheln und Angaben', () => {
    expect(layoutProblems(good)).toEqual([]);
    expect(layoutProblems({ ...good, screen: [1920, 1080], eigenes: 'bleibt' })).toEqual([]);
    expect(layoutProblems({ grid, widgets: [] })).toEqual([]);
  });

  it('nennt die Kachel, die über einer anderen oder außerhalb liegt', () => {
    expect(layoutProblems({ grid, widgets: [{ type: 'clock', at: [0, 0, 4, 2] }, { type: 'note', at: [3, 1, 2, 2] }] })).toEqual(['Kachel 2 ("note") liegt über Kachel 1 ("clock").']);
    expect(layoutProblems({ grid, widgets: [{ type: 'clock', at: [10, 0, 4, 2] }] })).toEqual(['Kachel 1 ("clock") liegt mit [10, 0, 4, 2] nicht ganz im Raster von 12 × 6.']);
  });

  it('verlangt Art und Platz in ganzen Zahlen', () => {
    for (const widget of [{ at: [0, 0, 1, 1] }, { type: 'clock' }, { type: 'clock', at: [0, 0, 1] }, { type: 'clock', at: [0, 0, 1.5, 1] }, { type: 'clock', at: ['0', 0, 1, 1] }, null, 'clock']) {
      expect(layoutProblems({ grid, widgets: [widget] }), JSON.stringify(widget)).not.toEqual([]);
    }
  });

  it('weist ab, was kein Layout ist', () => {
    for (const value of [null, [], 'main', { widgets: [] }, { grid }, { grid: { columns: 0, rows: 6 }, widgets: [] }, { grid: { columns: 12, rows: 100000 }, widgets: [] }, { grid: { columns: '12', rows: 6 }, widgets: [] }, { grid, widgets: {} }]) {
      expect(layoutProblems(value), JSON.stringify(value)).toHaveLength(1);
    }
    expect(layoutProblems({ ...good, screen: '16:9' })).toHaveLength(1);
    expect(layoutProblems({ ...good, screen: [16, 0] })).toHaveLength(1);
  });
});
