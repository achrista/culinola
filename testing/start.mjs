// Startet die Testinstanz: ein Kern mit erfundenen Werten, Beispielrezepten und allen
// Bausteinen, die ohne eigene Geräte laufen. Die Vorlage aus `testing/instance` wird bei
// jedem Start frisch in einen Wegwerfordner gelegt – die eigenen Daten bleiben unberührt.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const target = join(tmpdir(), 'culinola-testinstanz');
rmSync(target, { recursive: true, force: true });
cpSync(fileURLToPath(new URL('./instance', import.meta.url)), target, { recursive: true });
writeFileSync(join(target, 'recipes', 'Kuchen', 'kuchen.png'), stripes(480, 320));
// Ein Rezept mit Zutatentabelle – für die Einkaufsliste. Es ist das Beispiel, das dem Rezept-Plugin beiliegt.
cpSync(fileURLToPath(new URL('../plugins/recipes/examples/pfannkuchen.md', import.meta.url)), join(target, 'recipes', 'pfannkuchen.md'));

process.env.CULINOLA_DATA = target;

// Aktivierungswort: Das Sprachmodell wird nicht mitgeliefert. Wer es ausprobieren will, nennt seine Datei beim Start:
//   CULINOLA_VOSK_MODEL=/pfad/zu/model.tar.gz npm run test:instance
if (process.env.CULINOLA_VOSK_MODEL && existsSync(process.env.CULINOLA_VOSK_MODEL)) {
  mkdirSync(join(target, 'voice'), { recursive: true });
  cpSync(process.env.CULINOLA_VOSK_MODEL, join(target, 'voice', 'model.tar.gz'));
  console.log('Sprachmodell für das Aktivierungswort übernommen.');
}

// Neue Rezepte: Statt der Claude-API antwortet ein Platzhalter auf diesem Rechner mit einem festen
// Rezept. So lässt sich das Hinzufügen durchspielen, ohne dass etwas das Haus verlässt oder kostet.
const { startStandIn } = await import('../packages/recipe-import/src/standin.ts');
const standIn = await startStandIn();
process.env.ANTHROPIC_BASE_URL = standIn.url;
process.env.ANTHROPIC_API_KEY = 'platzhalter-der-testinstanz';
console.log(`Platzhalter für die Claude-API auf ${standIn.url}`);

// Einkaufsliste: Ebenso antwortet statt Merkio ein Platzhalter mit einer erfundenen Familie.
const { startStandIn: startMerkio } = await import('../plugins/source-merkio/src/standin.ts');
const merkio = await startMerkio();
const configFile = join(target, 'config.json');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
config.sources.find((source) => source.id === 'merkio').config = { url: merkio.url, lists: ['Einkauf', 'Aufgaben'] };
// Fremde Seiten: Die Kachel "web" bettet hier zwei Seiten von diesem Rechner ein – eine, die es erlaubt,
// und eine, die es wie viele Seiten im Netz verbietet. So braucht die Prüfung kein Internet.
const pages = await startPages();
for (const widget of config.layouts.web.widgets) if (widget.type === 'web') widget.config.url = widget.config.url.replace('http://fremde-seiten', pages);
console.log(`Platzhalter für fremde Seiten auf ${pages}`);
writeFileSync(configFile, JSON.stringify(config, null, 2));
writeFileSync(join(target, 'secrets.json'), JSON.stringify({ merkio: merkio.account }, null, 2));
// Geräte über MQTT: ein Platzhalter-Broker mit einem nachgespielten Luftsensor und einem schaltbaren Licht.
const { startStandIn: startBroker } = await import('../plugins/connector-mqtt/src/standin.ts');
const broker = await startBroker();
config.sources.find((source) => source.id === 'mqtt').config.url = broker.url;
writeFileSync(configFile, JSON.stringify(config, null, 2));
writeFileSync(join(target, 'secrets.json'), JSON.stringify({ merkio: merkio.account, mqtt: broker.account }, null, 2));
// Homematic: eine Platzhalter-Zentrale mit Schalter, Rollladen und Wandthermostat.
const { startStandIn: startCcu } = await import('../plugins/connector-homematic/src/standin.ts');
const ccu = await startCcu();
Object.assign(config.sources.find((source) => source.id === 'homematic').config, { host: ccu.host, interfaces: [{ name: 'alle', port: ccu.port }], regaPort: ccu.port });
writeFileSync(configFile, JSON.stringify(config, null, 2));
console.log(`Platzhalter für Homematic auf ${ccu.host}:${ccu.port}`);
console.log(`Platzhalter für MQTT auf ${broker.url}`);
console.log(`Platzhalter für Merkio auf ${merkio.url}`);
console.log(`Testinstanz in ${target}`);
await import('../packages/core/src/main.ts');

/** Zwei kleine Seiten zum Einbetten: `/frei` zeigt Uhrzeit, einen Zähler und Verweise, `/verboten` untersagt das Einbetten. */
async function startPages() {
  const page = (title, body) => `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<body style="margin:0;padding:24px;font:18px system-ui;background:#eef3f7;color:#123"><h1 style="margin-top:0">${title}</h1>${body}</body></html>`;
  const free = page(
    'Fremde Seite',
    `<p>Geladen um <strong id="geladen"></strong>, jetzt ist es <strong id="jetzt"></strong>.</p>
<p><button id="taste" style="font:inherit;padding:10px 20px">Angetippt: 0</button></p>
<p><a href="/zweite">Zur zweiten Seite</a> · <a href="https://example.org/" target="_top">Versuch, die Anzeige zu verlassen</a></p>
<p style="height:900px;border-left:6px solid #9bb">Lange Seite zum Rollen</p><p>Ende der Seite.</p>
<script>const zeit=()=>new Date().toLocaleTimeString('de-DE');document.getElementById('geladen').textContent=zeit();
setInterval(()=>document.getElementById('jetzt').textContent=zeit(),1000);let n=0;
document.getElementById('taste').onclick=(e)=>e.target.textContent='Angetippt: '+(++n);</script>`,
  );
  const server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    const send = (status, body, headers = {}) => (response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers }), response.end(body));
    if (path === '/frei') return send(200, free);
    if (path === '/zweite') return send(200, page('Zweite Seite', '<p><a href="/frei">Zurück</a></p>'));
    if (path === '/verboten') return send(200, page('Verboten', '<p>Diese Seite sollte in keiner Kachel zu sehen sein.</p>'), { 'X-Frame-Options': 'DENY' });
    return send(404, page('Nicht gefunden', ''));
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  return `http://localhost:${server.address().port}`;
}

/** Ein Streifenbild als PNG, hier erzeugt – so braucht die Testinstanz kein fremdes Foto. */
function stripes(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      const band = Math.floor(((x + y) / width) * 6) % 2;
      raw.set(band ? [217, 152, 15] : [240, 185, 58], at);
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Farbtiefe
  header[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
