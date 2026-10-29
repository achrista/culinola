import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join, resolve } from 'node:path';
import type { Logger } from '@culinola/sdk';

/** Hierhin meldet sich jede Installation einmal am Tag – ohne Inhalte, nur damit wir wissen, wie viele es gibt. */
export const TELEMETRY_URL = 'https://ping.culinola.org/v1/ping';
const DAY = 24 * 60 * 60 * 1000;
/** Erst nach dem Start melden, damit ein Absturz in der ersten Minute nicht als Installation zählt. */
const FIRST_DELAY = 60 * 1000;
const ID_FILE = 'installation-id';

/** Was gemeldet wird – alles, und nichts darüber hinaus. */
export interface TelemetryPing {
  /** Zufällige Kennung dieser Installation, einmal erzeugt und im Datenordner abgelegt. */
  id: string;
  version: string;
  /** "linux", "win32", "darwin" … */
  os: string;
  arch: string;
  docker: boolean;
  /** true, solange Culinola ohne eigene Konfiguration mit Beispielwerten läuft. */
  demo: boolean;
}

/**
 * Abgeschaltet ist die Meldung mit `"telemetry": false` in `config.json` oder `CULINOLA_TELEMETRY=0`;
 * in CI-Läufen (Umgebungsvariable `CI`) bleibt sie ebenfalls aus, damit Tests nicht mitzählen.
 */
export function telemetryEnabled(configured: boolean | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (configured === false) return false;
  if (env.CI) return false;
  const value = env.CULINOLA_TELEMETRY?.trim().toLowerCase();
  return !(value && ['0', 'false', 'off', 'no', 'nein', 'aus'].includes(value));
}

/** Liest die Kennung der Installation oder legt sie an. Lässt sich der Datenordner nicht beschreiben, gilt eine für diesen Lauf. */
export function installationId(dataDir: string): string {
  const file = join(dataDir, ID_FILE);
  try {
    if (existsSync(file)) {
      const id = readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f-]{36}$/.test(id)) return id;
    }
    const id = randomUUID();
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${id}\n`);
    return id;
  } catch {
    return randomUUID();
  }
}

function culinolaVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

export function telemetryPing(dataDir: string, demo: boolean): TelemetryPing {
  return { id: installationId(dataDir), version: culinolaVersion(), os: platform(), arch: arch(), docker: existsSync('/.dockerenv'), demo };
}

/** Schickt die Meldung. Scheitert sie, merkt das niemand – sie ist für uns, nicht für den Betrieb. */
export async function sendPing(ping: TelemetryPing, url = TELEMETRY_URL): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ping),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Meldet sich eine Minute nach dem Start und dann täglich. Gibt eine Funktion zum Anhalten zurück. */
export function startTelemetry(options: { configured: boolean | undefined; dataDir: string; demo: boolean; log: Logger }): () => void {
  if (!telemetryEnabled(options.configured)) return () => {};
  options.log.info('Culinola meldet sich einmal am Tag anonym (zufällige Kennung, Version, Betriebssystem) – abschalten mit "telemetry": false in config.json oder CULINOLA_TELEMETRY=0.');
  const ping = () => void sendPing(telemetryPing(options.dataDir, options.demo));
  const first = setTimeout(ping, FIRST_DELAY);
  const daily = setInterval(ping, DAY);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
