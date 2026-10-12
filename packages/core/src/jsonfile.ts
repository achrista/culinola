import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** So viele selbst angelegte Sicherungen bleiben liegen. */
const KEEP_BACKUPS = 10;

function stamp(now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Eine Datei im Datenordner, die der Kern nicht nur liest, sondern auch schreibt – `config.json`, `secrets.json`.
 * Vor jedem Schreiben legt er eine Sicherung daneben (`config.vor-<Zeitstempel>.json`, die letzten zehn bleiben),
 * dann schreibt er über eine Nachbardatei, damit nie eine halbe Datei dasteht.
 */
export class JsonFile {
  readonly path: string;
  /** "config" bei `config.json` – so beginnen die Namen der Sicherungen. */
  private readonly stem: string;
  private readonly listeners = new Set<(value: unknown) => void>();

  constructor(path: string) {
    this.path = path;
    this.stem = basename(path).replace(/\.json$/, '');
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  /** Liest die Datei – nichts, wenn es sie nicht gibt. Wirft mit Dateiname, wenn sie sich nicht lesen lässt. */
  read(): unknown {
    if (!this.exists()) return undefined;
    try {
      return JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (error) {
      throw new Error(`${this.path} lässt sich nicht lesen: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }

  /** Meldet jedes Schreiben durch den Kern selbst – damit es niemand für eine Änderung von Hand hält. */
  onWritten(listener: (value: unknown) => void): void {
    this.listeners.add(listener);
  }

  write(value: unknown): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    if (this.exists()) {
      // Zwei Änderungen in derselben Millisekunde dürfen einander die Sicherung nicht überschreiben
      let when = new Date();
      while (existsSync(join(dir, `${this.stem}.vor-${stamp(when)}.json`))) when = new Date(when.getTime() + 1);
      copyFileSync(this.path, join(dir, `${this.stem}.vor-${stamp(when)}.json`));
      // Nur was dieses Muster trägt, hat der Kern angelegt – von Hand benannte Sicherungen (`config.vor-umbau.json`) rührt er nicht an
      const own = readdirSync(dir).filter((name) => name.startsWith(`${this.stem}.vor-`) && /^\d{8}-\d{6}-\d{3}\.json$/.test(name.slice(this.stem.length + '.vor-'.length))).sort();
      for (const name of own.slice(0, -KEEP_BACKUPS)) rmSync(join(dir, name), { force: true });
    }
    // Erst vollständig daneben schreiben, dann umbenennen: Ein Stromausfall hinterlässt die alte oder die neue Datei, nie eine halbe
    const neighbour = `${this.path}.neu`;
    const handle = openSync(neighbour, 'w');
    try {
      writeSync(handle, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync(neighbour, this.path);
    for (const listener of this.listeners) listener(value);
  }
}
