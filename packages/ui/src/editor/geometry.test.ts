import { describe, expect, it } from 'vitest';
import { History, firstFree, isFree, moved, regrid, resized, stageSize } from './geometry.ts';

const grid = { columns: 12, rows: 6 };

describe('moved', () => {
  it('verschiebt um ganze Rastereinheiten', () => {
    expect(moved([2, 1, 4, 2], 3, 2, grid)).toEqual([5, 3, 4, 2]);
    expect(moved([2, 1, 4, 2], -1, -1, grid)).toEqual([1, 0, 4, 2]);
  });

  it('bleibt am Rand des Rasters stehen', () => {
    expect(moved([2, 1, 4, 2], 99, 99, grid)).toEqual([8, 4, 4, 2]);
    expect(moved([2, 1, 4, 2], -99, -99, grid)).toEqual([0, 0, 4, 2]);
  });
});

describe('resized', () => {
  it('zieht an der rechten und unteren Kante, die andere bleibt stehen', () => {
    expect(resized([2, 1, 4, 2], 'e', 2, 5, grid)).toEqual([2, 1, 6, 2]);
    expect(resized([2, 1, 4, 2], 's', 5, 1, grid)).toEqual([2, 1, 4, 3]);
    expect(resized([2, 1, 4, 2], 'se', -1, 1, grid)).toEqual([2, 1, 3, 3]);
  });

  it('zieht an der linken und oberen Kante, die andere bleibt stehen', () => {
    expect(resized([2, 1, 4, 2], 'w', -2, 0, grid)).toEqual([0, 1, 6, 2]);
    expect(resized([2, 1, 4, 2], 'n', 0, 1, grid)).toEqual([2, 2, 4, 1]);
    expect(resized([2, 1, 4, 2], 'nw', 1, -1, grid)).toEqual([3, 0, 3, 3]);
    expect(resized([2, 1, 4, 2], 'ne', 1, -1, grid)).toEqual([2, 0, 5, 3]);
    expect(resized([2, 1, 4, 2], 'sw', -1, 1, grid)).toEqual([1, 1, 5, 3]);
  });

  it('geht nicht über den Rand und nicht unter die kleinste Größe', () => {
    expect(resized([2, 1, 4, 2], 'se', 99, 99, grid)).toEqual([2, 1, 10, 5]);
    expect(resized([2, 1, 4, 2], 'nw', -99, -99, grid)).toEqual([0, 0, 6, 3]);
    expect(resized([2, 1, 4, 2], 'se', -99, -99, grid)).toEqual([2, 1, 1, 1]);
    expect(resized([2, 1, 4, 2], 'nw', 99, 99, grid)).toEqual([5, 2, 1, 1]);
    expect(resized([2, 1, 4, 2], 'se', -99, -99, grid, [3, 2])).toEqual([2, 1, 3, 2]);
    expect(resized([2, 1, 4, 2], 'nw', 99, 99, grid, [3, 2])).toEqual([3, 1, 3, 2]);
  });

  it('macht eine Kachel, die schon kleiner ist als ihre kleinste Größe, nicht von selbst größer', () => {
    expect(resized([2, 1, 2, 1], 'e', -1, 0, grid, [3, 2])).toEqual([2, 1, 2, 1]);
    expect(resized([2, 1, 2, 1], 'e', 2, 0, grid, [3, 2])).toEqual([2, 1, 4, 1]);
  });
});

describe('isFree', () => {
  const widgets = [{ at: [0, 0, 4, 2] }, { at: [4, 0, 4, 2] }] as const;
  const list = widgets.map((widget) => ({ at: [...widget.at] as [number, number, number, number] }));

  it('lässt eine Kachel an ihrem eigenen Platz und auf freier Fläche zu', () => {
    expect(isFree(list, 0, [0, 0, 4, 2], grid)).toBe(true);
    expect(isFree(list, 0, [0, 2, 4, 2], grid)).toBe(true);
    expect(isFree(list, 0, [8, 0, 4, 2], grid)).toBe(true);
  });

  it('weist ab, was auf einer anderen Kachel oder außerhalb liegt', () => {
    expect(isFree(list, 0, [1, 0, 4, 2], grid)).toBe(false);
    expect(isFree(list, 0, [9, 0, 4, 2], grid)).toBe(false);
    // Eine neue Kachel (kein eigener Platz) darf auf keiner liegen
    expect(isFree(list, -1, [0, 0, 1, 1], grid)).toBe(false);
  });
});

describe('firstFree', () => {
  const list = [{ at: [0, 0, 4, 2] as [number, number, number, number] }, { at: [4, 0, 8, 1] as [number, number, number, number] }];

  it('findet die erste Lücke, zeilenweise von oben links', () => {
    expect(firstFree(list, [2, 1], grid)).toEqual([4, 1, 2, 1]);
    expect(firstFree(list, [8, 2], grid)).toEqual([4, 1, 8, 2]);
    expect(firstFree(list, [12, 2], grid)).toEqual([0, 2, 12, 2]);
    expect(firstFree([], [12, 6], grid)).toEqual([0, 0, 12, 6]);
  });

  it('liefert nichts, wenn die Kachel nirgends hinpasst', () => {
    expect(firstFree(list, [12, 5], grid)).toBeUndefined();
    expect(firstFree(list, [13, 1], grid)).toBeUndefined();
    expect(firstFree([{ at: [0, 0, 12, 6] }], [1, 1], grid)).toBeUndefined();
  });
});

describe('regrid', () => {
  const coarse = { columns: 12, rows: 6 };
  const fine = { columns: 48, rows: 24 };

  it('rechnet beim Verfeinern alle Kacheln genau um', () => {
    expect(regrid([[0, 0, 4, 2], [4, 0, 8, 1], [11, 5, 1, 1]], coarse, fine)).toEqual({ places: [[0, 0, 16, 8], [16, 0, 32, 4], [44, 20, 4, 4]], exact: true, valid: true });
  });

  it('geht beim Vergröbern auf, wenn die Kacheln auf den Linien des gröberen Rasters liegen', () => {
    expect(regrid([[0, 0, 16, 8], [16, 0, 32, 4]], fine, coarse)).toEqual({ places: [[0, 0, 4, 2], [4, 0, 8, 1]], exact: true, valid: true });
  });

  it('rundet, was nicht aufgeht, und hält gemeinsame Kanten zusammen', () => {
    const result = regrid([[0, 0, 13, 3], [13, 0, 11, 3], [24, 0, 24, 3]], fine, coarse);
    expect(result.places).toEqual([[0, 0, 3, 1], [3, 0, 3, 1], [6, 0, 6, 1]]);
    expect([result.exact, result.valid]).toEqual([false, true]);
  });

  it('meldet, wenn Kacheln danach übereinander lägen', () => {
    // Zwei schmale Kacheln nebeneinander fallen im groben Raster auf dieselbe Einheit
    const result = regrid([[0, 0, 1, 1], [1, 0, 1, 1]], fine, coarse);
    expect([result.exact, result.valid]).toEqual([false, false]);
  });

  it('ändert nur eine Richtung, wenn nur Zeilen dazukommen', () => {
    expect(regrid([[2, 3, 4, 3]], { columns: 12, rows: 6 }, { columns: 12, rows: 12 }).places).toEqual([[2, 6, 4, 6]]);
  });
});

describe('stageSize', () => {
  it('nimmt Bildpunkte, wie sie sind, und rechnet ein Verhältnis auf 1920 um', () => {
    expect(stageSize([1280, 800])).toEqual([1280, 800]);
    expect(stageSize([16, 9])).toEqual([1920, 1080]);
    expect(stageSize([16, 10])).toEqual([1920, 1200]);
    expect(stageSize([9, 16])).toEqual([1080, 1920]);
  });

  it('gilt ohne oder mit unbrauchbarer Angabe als 16:9', () => {
    for (const screen of [undefined, '16:9', [16], [0, 9], [16, Number.NaN]]) expect(stageSize(screen), JSON.stringify(screen)).toEqual([1920, 1080]);
  });
});

describe('History', () => {
  it('nimmt Schritte zurück und wiederholt sie', () => {
    const history = new History<string>();
    history.record('a');
    history.record('b');
    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
    expect(history.undo('a')).toBeUndefined();
    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeUndefined();
    expect(history.undo('c')).toBe('b');
  });

  it('vergisst nach einer neuen Änderung, was zurückgenommen war', () => {
    const history = new History<string>();
    history.record('a');
    expect(history.undo('b')).toBe('a');
    history.record('a');
    expect(history.redo('x')).toBeUndefined();
    expect(history.undo('x')).toBe('a');
  });
});
