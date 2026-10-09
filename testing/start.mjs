// Startet die Testinstanz: ein Kern mit erfundenen Werten, Beispielrezepten und allen
// Bausteinen, die ohne eigene Geräte laufen. Die Vorlage aus `testing/instance` wird bei
// jedem Start frisch in einen Wegwerfordner gelegt – die eigenen Daten bleiben unberührt.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const target = join(tmpdir(), 'culinola-testinstanz');
rmSync(target, { recursive: true, force: true });
cpSync(fileURLToPath(new URL('./instance', import.meta.url)), target, { recursive: true });
writeFileSync(join(target, 'recipes', 'Kuchen', 'kuchen.png'), stripes(480, 320));

process.env.CULINOLA_DATA = target;

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
writeFileSync(configFile, JSON.stringify(config, null, 2));
writeFileSync(join(target, 'secrets.json'), JSON.stringify({ merkio: merkio.account }, null, 2));
console.log(`Platzhalter für Merkio auf ${merkio.url}`);
console.log(`Testinstanz in ${target}`);
await import('../packages/core/src/main.ts');

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
