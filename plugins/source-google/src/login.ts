// Meldet Culinola einmalig bei Google an:  npm run google:login
//
// Der Befehl öffnet die Anmeldeseite von Google im Browser dieses Rechners und nimmt die
// Antwort auf einer Adresse entgegen, die nur dieser Rechner erreicht. Gespeichert wird die
// dauerhafte Anmeldung im Datenordner; das Kennwort sieht Culinola nie.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { authorizationUrl, createVerifier, exchangeCode, READ_SCOPES, readClient, tokenFile, writeToken } from './auth.ts';

const WAIT_MS = 10 * 60 * 1000;

const instance = process.argv.find((argument) => argument.startsWith('--instance='))?.slice(11) ?? 'google';
const storageDir = join(resolve(process.env.CULINOLA_DATA ?? 'data'), instance);

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  // Gelingt das Öffnen nicht, bleibt die ausgegebene Adresse zum Kopieren
  spawn(command as string, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}

const page = (title: string, text: string) =>
  `<!doctype html><html lang="de"><meta charset="utf-8"><title>Culinola</title><body style="font-family:sans-serif;max-width:32em;margin:15vh auto;padding:0 1em"><h1>${title}</h1><p>${text}</p></body></html>`;

try {
  const client = readClient(storageDir);
  const { verifier, challenge } = createVerifier();
  const state = randomBytes(16).toString('hex');

  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  // Der Browser erfährt das Ergebnis erst, wenn Google den Code auch eingelöst hat
  let answer: (title: string, text: string) => Promise<void> = () => Promise.resolve();
  const code = new Promise<string>((done, fail) => {
    const timeout = setTimeout(() => fail(new Error('Zehn Minuten ohne Anmeldung – abgebrochen.')), WAIT_MS);
    server.on('request', (request, response) => {
      const query = new URL(request.url ?? '/', redirectUri).searchParams;
      // Der Browser fragt nebenher nach einem Symbol für die Seite; das ist keine Antwort von Google
      if (!query.has('code') && !query.has('error')) return void response.writeHead(404).end();
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      clearTimeout(timeout);
      if (query.get('state') !== state) {
        response.end(page('Anmeldung abgebrochen', 'Die Antwort gehört nicht zu dieser Anmeldung. Bitte den Befehl neu starten.'));
        fail(new Error('Die Antwort gehört nicht zu dieser Anmeldung.'));
      } else if (query.has('error')) {
        response.end(page('Anmeldung abgelehnt', 'Google hat keinen Zugriff erteilt. Dieses Fenster kann geschlossen werden.'));
        fail(new Error(`Google hat keinen Zugriff erteilt (${query.get('error')}).`));
      } else {
        answer = (title, text) => new Promise((sent) => response.end(page(title, text), sent));
        done(query.get('code')!);
      }
    });
  });

  const url = authorizationUrl(client, redirectUri, READ_SCOPES, challenge, state);
  console.log('Die Anmeldeseite von Google öffnet sich im Browser. Falls nicht, diese Adresse dort öffnen:\n');
  console.log(url + '\n');
  if (!process.argv.includes('--no-browser')) openBrowser(url);

  try {
    const token = await exchangeCode(client, await code, redirectUri, verifier);
    const missing = READ_SCOPES.filter((scope) => !token.scopes.includes(scope));
    if (missing.length) throw new Error('Auf der Seite von Google wurde nicht alles angehakt. Bitte neu anmelden und beide Zugriffe – Kalender und Kontakte – erlauben.');
    writeToken(storageDir, token);
    await answer('Anmeldung abgeschlossen', 'Culinola darf jetzt Kalender und Kontakte lesen. Dieses Fenster kann geschlossen werden.');
    console.log(`Angemeldet. Die Anmeldung liegt in ${tokenFile(storageDir)}.`);
  } catch (error) {
    await answer('Anmeldung fehlgeschlagen', 'Näheres steht im Fenster, in dem der Befehl gestartet wurde.');
    throw error;
  } finally {
    // Offene Verbindungen des Browsers sollen das Beenden nicht aufhalten
    server.close();
    server.closeAllConnections();
  }
  process.exit(0);
} catch (error) {
  console.error(`Anmeldung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
