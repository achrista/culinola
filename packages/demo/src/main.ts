import { resolveMediaWith } from '../../ui/src/media.ts';
import { startCore } from './core.ts';
import { language } from './language.ts';
import { createServer, socketClass } from './server.ts';
import { forget } from './shims/fs.ts';

// Die Demo: Erst startet der Kern im Browser, dann übernimmt er die Aufrufe der Oberfläche an `/api/v1`,
// und zuletzt startet die unveränderte Oberfläche selbst.

// Die Rezepte gibt es auf Deutsch und Englisch; beide Fassungen zeigen dieselben Fotos
const recipeTexts = import.meta.glob<string>('../recipes/*/**/*.md', { query: '?raw', import: 'default', eager: true });
const recipeImages = import.meta.glob<string>('../recipes/de/**/*.{jpg,png,webp}', { query: '?url', import: 'default', eager: true });
const logos = import.meta.glob<string>('../media/logos/*.png', { query: '?url', import: 'default', eager: true });
const templateFiles = import.meta.glob<unknown>('../../../templates/*.json', { import: 'default', eager: true });

const within = (prefix: string, path: string) => path.slice(prefix.length);
const files: Record<string, string | Uint8Array> = {};
const ownRecipes = `../recipes/${language}/`;
for (const [path, text] of Object.entries(recipeTexts)) if (path.startsWith(ownRecipes)) files[`recipes/${within(ownRecipes, path)}`] = text;
const imageByName = new Map(Object.entries(recipeImages).map(([path, url]) => [path.split('/').pop()!, url]));
// Die Logos holt der Browser selbst; im Datenordner steht nur, dass es sie gibt
for (const path of Object.keys(logos)) files[`radio/logos/${within('../media/logos/', path)}`] = new Uint8Array();
const templates = Object.fromEntries(Object.entries(templateFiles).map(([path, raw]) => [within('../../../templates/', path).replace(/\.json$/, ''), raw]));
const media = `${import.meta.env.BASE_URL}media/`;
const clips = { kamera3: `${media}haustuer.mp4`, kamera2: `${media}garten.mp4` };

const core = await startCore({ files, clips, templates });
const server = createServer(core);

// Aufrufe an den Kern bleiben im Browser; alles andere geht wie gewohnt ins Netz
const network = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/v1/')) {
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : request.headers.get('content-type')?.includes('application/octet-stream') ? await request.blob() : await request.text();
    return server.handle(request.method, url, body, request.headers.get('content-type') ?? '');
  }
  // Fremde Server verlangen für eine eigene Kennung des Programms eine Rückfrage, die viele nicht beantworten
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.delete('User-Agent');
  return network(input, { ...init, headers });
};
window.WebSocket = socketClass(core) as unknown as typeof WebSocket;

// Ton und Bilder, die der Browser selbst lädt: Radio direkt vom Sender, Logos und Rezeptbilder aus der Demo
resolveMediaWith((path) => {
  // "/p/<Instanz>/<Art>/<Kennung>/…"
  const [, , instance, kind, id, ...rest] = path.split('/').map((part) => decodeURIComponent(part.split('?')[0]!));
  const source = core.config.sources.find((entry) => entry.id === instance);
  if (source?.plugin === 'media-radio') {
    const station = (source.config as { stations?: { id: string; url?: string; image?: string }[] }).stations?.find((entry) => entry.id === id);
    if (kind === 'stream') return station?.url;
    if (kind === 'logo') return logos[`../media/logos/${station?.image ?? ''}`];
  }
  if (source?.plugin === 'recipes' && kind === 'file') {
    return imageByName.get(rest.at(-1) ?? '');
  }
  return undefined;
});

// Die Webseite um die Demo herum darf klingeln lassen und die Demo zurücksetzen
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const wanted = (event.data as { culinola?: unknown } | null)?.culinola;
  if (wanted === 'ring') {
    try {
      core.events.raise('hausglocke');
    } catch {
      // Wer die Meldung beim Einrichten gelöscht hat, hört eben keine Klingel.
    }
  }
  if (wanted === 'reset') {
    forget();
    location.reload();
  }
});

await import('../../ui/src/main.ts');
