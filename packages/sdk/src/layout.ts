// Das Raster eines Layouts: was Kern und Oberfläche gleich rechnen müssen – der Kern prüft damit vor dem
// Speichern, der Editor beim Ziehen.

/** Platz einer Kachel im Raster: Spalte, Zeile, Breite, Höhe – in Rastereinheiten, ab 0 gezählt. */
export type Place = [x: number, y: number, w: number, h: number];

export interface Grid {
  columns: number;
  rows: number;
}

/** Mehr Spalten oder Zeilen sind ein Tippfehler, kein Layout. */
export const MAX_GRID = 400;

/** Liegen zwei Kacheln übereinander? Kacheln, die sich nur an der Kante berühren, tun es nicht. */
export function overlaps(a: Place, b: Place): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** Liegt die Kachel ganz im Raster? */
export function inside(at: Place, grid: Grid): boolean {
  return at[0] >= 0 && at[1] >= 0 && at[2] >= 1 && at[3] >= 1 && at[0] + at[2] <= grid.columns && at[1] + at[3] <= grid.rows;
}

function isPlace(value: unknown): value is Place {
  return Array.isArray(value) && value.length === 4 && value.every((entry) => Number.isInteger(entry));
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_GRID;

/**
 * Prüft die Form eines Layouts: Raster, Kacheln mit Art und Platz, alle im Raster, keine über einer anderen.
 * Liefert, was nicht stimmt, in Sätzen für den, der es beheben soll – eine leere Liste heißt: in Ordnung.
 * Die Einstellungen der Kacheln (`config`) prüft das nicht; die kennt nur die jeweilige Kachel.
 */
export function layoutProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Ein Layout ist ein Objekt mit "grid" und "widgets".'];
  const { grid, widgets, screen } = value as { grid?: Partial<Grid> | null; widgets?: unknown; screen?: unknown };
  if (!grid || typeof grid !== 'object' || !isCount(grid.columns) || !isCount(grid.rows)) {
    return [`"grid" braucht "columns" und "rows" als ganze Zahlen von 1 bis ${MAX_GRID}.`];
  }
  if (!Array.isArray(widgets)) return ['"widgets" fehlt oder ist keine Liste.'];

  const problems: string[] = [];
  if (screen !== undefined && !(Array.isArray(screen) && screen.length === 2 && screen.every((side) => typeof side === 'number' && Number.isFinite(side) && side > 0))) {
    problems.push('"screen" nennt Breite und Höhe des Bildschirms, etwa [16, 9] oder [1920, 1080].');
  }
  const placed: { name: string; at: Place }[] = [];
  widgets.forEach((widget: unknown, index) => {
    const { type, at } = (widget && typeof widget === 'object' ? widget : {}) as { type?: unknown; at?: unknown };
    const name = `Kachel ${index + 1}${typeof type === 'string' && type ? ` ("${type}")` : ''}`;
    if (typeof type !== 'string' || !type) problems.push(`${name}: "type" fehlt.`);
    if (!isPlace(at)) problems.push(`${name}: "at" braucht vier ganze Zahlen – Spalte, Zeile, Breite, Höhe.`);
    else if (!inside(at, grid as Grid)) problems.push(`${name} liegt mit [${at.join(', ')}] nicht ganz im Raster von ${grid.columns} × ${grid.rows}.`);
    else {
      const other = placed.find((entry) => overlaps(entry.at, at));
      if (other) problems.push(`${name} liegt über ${other.name}.`);
      placed.push({ name, at });
    }
  });
  return problems;
}
