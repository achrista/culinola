// Meldet Docker, ob der Kern antwortet. Gefragt wird die Startseite: Sie verlangt
// kein Zugangstoken und sagt trotzdem, dass der Kern Anfragen bedient.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let port = 8090;
try {
  const config = JSON.parse(readFileSync(join(process.env.CULINOLA_DATA ?? 'data', 'config.json'), 'utf8'));
  if (Number.isInteger(config.port)) port = config.port;
} catch {
  // Ohne eigene Konfiguration läuft der Kern mit Beispielwerten auf dem üblichen Port.
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(4000) });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
