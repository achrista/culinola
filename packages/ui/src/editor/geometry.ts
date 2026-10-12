import { type Grid, type Place, inside, overlaps } from '@culinola/sdk';

/** Die acht Griffe einer Kachel, nach Himmelsrichtung: Kanten und Ecken. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Verschiebt eine Kachel um ganze Rastereinheiten; am Rand des Rasters bleibt sie stehen. */
export function moved(at: Place, dx: number, dy: number, grid: Grid): Place {
  const [x, y, w, h] = at;
  return [clamp(x + dx, 0, Math.max(0, grid.columns - w)), clamp(y + dy, 0, Math.max(0, grid.rows - h)), w, h];
}

/**
 * Zieht an einem Griff: Die gegenüberliegende Kante bleibt stehen. Kleiner als `min` (Breite, Höhe)
 * und über den Rand des Rasters hinaus geht es nicht.
 */
export function resized(at: Place, handle: Handle, dx: number, dy: number, grid: Grid, min: readonly [number, number] = [1, 1]): Place {
  let [x, y, w, h] = at;
  const right = x + w;
  const bottom = y + h;
  if (handle.includes('e')) w = clamp(w + dx, Math.min(min[0], w), grid.columns - x);
  if (handle.includes('w')) {
    x = clamp(x + dx, 0, right - Math.min(min[0], w));
    w = right - x;
  }
  if (handle.includes('s')) h = clamp(h + dy, Math.min(min[1], h), grid.rows - y);
  if (handle.includes('n')) {
    y = clamp(y + dy, 0, bottom - Math.min(min[1], h));
    h = bottom - y;
  }
  return [x, y, w, h];
}

/** Ist der Platz frei – im Raster und auf keiner anderen Kachel? `index` ist die Kachel, die dorthin soll. */
export function isFree(widgets: readonly { at: Place }[], index: number, at: Place, grid: Grid): boolean {
  return inside(at, grid) && widgets.every((other, position) => position === index || !overlaps(other.at, at));
}

/**
 * Die erste freie Stelle für eine Kachel dieser Größe, zeilenweise von oben links gesucht –
 * oder nichts, wenn sie nirgends hinpasst.
 */
export function firstFree(widgets: readonly { at: Place }[], size: readonly [number, number], grid: Grid): Place | undefined {
  const [w, h] = size;
  for (let y = 0; y + h <= grid.rows; y++) {
    for (let x = 0; x + w <= grid.columns; x++) {
      const at: Place = [x, y, w, h];
      if (isFree(widgets, -1, at, grid)) return at;
    }
  }
  return undefined;
}

/**
 * Rechnet die Plätze aller Kacheln in ein anderes Raster um: Jede Kante wandert an die nächste Linie des neuen
 * Rasters, gemeinsame Kanten bleiben gemeinsam. `exact` sagt, ob dabei alles aufging – beim Verfeinern (24 → 48)
 * immer, beim Vergröbern nur, wenn die Kacheln auf den Linien des gröberen Rasters lagen. `valid` ist falsch,
 * wenn Kacheln danach übereinander oder außerhalb lägen; dann taugt das Ergebnis nicht.
 */
export function regrid(places: readonly Place[], from: Grid, to: Grid): { places: Place[]; exact: boolean; valid: boolean } {
  let exact = true;
  const edge = (value: number, own: number, target: number) => {
    if ((value * target) % own !== 0) exact = false;
    return Math.round((value * target) / own);
  };
  const result = places.map(([x, y, w, h]): Place => {
    const left = edge(x, from.columns, to.columns);
    const top = edge(y, from.rows, to.rows);
    return [left, top, Math.max(1, edge(x + w, from.columns, to.columns) - left), Math.max(1, edge(y + h, from.rows, to.rows) - top)];
  });
  const list = result.map((at) => ({ at }));
  return { places: result, exact, valid: result.every((at, index) => isFree(list, index, at, to)) };
}

export const samePlace = (a: Place, b: Place): boolean => a.every((value, position) => value === b[position]);

/**
 * Größe der Bühne in Bildpunkten: Das Layout wird so groß aufgebaut wie auf dem Bildschirm, für den es
 * gedacht ist, und im Ganzen verkleinert – nur so zeigen die Kacheln, was sie dort zeigen. `screen` nennt
 * Bildpunkte ([1920, 1080]) oder nur das Verhältnis ([16, 9]); ohne Angabe gilt 16:9.
 */
export function stageSize(screen: unknown): [width: number, height: number] {
  const [width, height] = Array.isArray(screen) && screen.length === 2 && screen.every((side) => typeof side === 'number' && Number.isFinite(side) && side > 0) ? (screen as [number, number]) : [16, 9];
  if (width >= 320 && height >= 240) return [Math.round(width), Math.round(height)];
  return width >= height ? [1920, Math.round((1920 * height) / width)] : [Math.round((1920 * width) / height), 1920];
}

/** Rückgängig und Wiederholen: Vor jeder Änderung wird der Stand davor abgelegt. */
export class History<T> {
  past: T[] = [];
  future: T[] = [];

  /** Merkt sich den Stand vor einer Änderung; was zurückgenommen war, lässt sich danach nicht mehr wiederholen. */
  record(before: T): void {
    this.past.push(before);
    this.future = [];
  }

  /** Liefert den Stand vor der letzten Änderung – `current` wandert zu denen, die sich wiederholen lassen. */
  undo(current: T): T | undefined {
    const before = this.past.pop();
    if (before !== undefined) this.future.push(current);
    return before;
  }

  redo(current: T): T | undefined {
    const after = this.future.pop();
    if (after !== undefined) this.past.push(current);
    return after;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
