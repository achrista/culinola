import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
/** Deckel für heruntergeladene Seiten und Dateien. */
export const MAX_DOWNLOAD_BYTES = 20_000_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export interface Download {
  url: string;
  contentType: string;
  data: Uint8Array;
}

export interface PageContent {
  text: string;
  imageUrl?: string;
}

export function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7));
    return low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
  }
  // Unbekanntes gilt als unsicher
  return true;
}

/** Lässt nur öffentliche Webadressen durch – kein Zugriff auf das eigene Netz des Servers. */
export async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Die Webadresse ist ungültig.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Nur Adressen mit http oder https werden gelesen.');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i.test(host)) throw new Error('Diese Adresse wird nicht gelesen.');
  const addresses = isIPv4(host) || isIPv6(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error(`Der Server ${host} wurde nicht gefunden.`);
  if (addresses.some((entry) => isPrivateIp(entry.address))) throw new Error('Diese Adresse wird nicht gelesen.');
  return parsed;
}

/** Lädt eine Adresse; jede Weiterleitung wird vor dem Folgen erneut geprüft. */
export async function download(url: string, signal?: AbortSignal): Promise<Download> {
  let target = (await assertPublicUrl(url)).href;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await fetch(target, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/pdf,image/*;q=0.9,*/*;q=0.5', 'Accept-Language': 'de,en;q=0.7' },
      redirect: 'manual',
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      target = (await assertPublicUrl(new URL(location, target).href)).href;
      continue;
    }
    if (!response.ok) throw new Error(`Die Seite antwortet mit Fehler ${response.status}.`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > MAX_DOWNLOAD_BYTES) throw new Error('Die Seite ist zu groß.');
      chunks.push(chunk);
    }
    return { url: target, contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(), data: Buffer.concat(chunks) };
  }
  throw new Error('Zu viele Weiterleitungen.');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&(auml|ouml|uuml|Auml|Ouml|Uuml|szlig);/g, (_, name: string) => ({ auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' })[name] ?? '')
    .replace(/&amp;/g, '&');
}

function plain(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? decodeEntities(String(value))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

type Node = Record<string, unknown>;

/** schema.org/Recipe einsammeln, auch aus Listen und @graph. */
function recipeNodes(node: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(node)) for (const entry of node) recipeNodes(entry, found);
  else if (node && typeof node === 'object') {
    const entry = node as Node;
    const type = entry['@type'];
    if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) found.push(entry);
    if (entry['@graph']) recipeNodes(entry['@graph'], found);
  }
  return found;
}

function instructions(value: unknown): string[] {
  if (typeof value === 'string') return [plain(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(instructions);
  if (value && typeof value === 'object') {
    const step = value as Node;
    // Ein Abschnitt (HowToSection) bringt seine Überschrift und eigene Schritte mit
    if (step['itemListElement']) return [...(plain(step['name']) ? [`${plain(step['name'])}:`] : []), ...instructions(step['itemListElement'])];
    return [plain(step['text']) || plain(step['name'])].filter(Boolean);
  }
  return [];
}

function imageOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(imageOf).find(Boolean);
  if (value && typeof value === 'object') return imageOf((value as Node)['url']);
  return undefined;
}

function recipeText(recipe: Node): PageContent | undefined {
  const raw = recipe['recipeIngredient'] ?? recipe['ingredients'];
  const ingredients = (Array.isArray(raw) ? raw : [raw]).map(plain).filter(Boolean);
  if (!ingredients.length) return undefined;
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = plain(Array.isArray(value) ? value[0] : value);
    if (text) lines.push(`${label}: ${text}`);
  };
  add('Rezept', recipe['name']);
  add('Beschreibung', recipe['description']);
  add('Ergibt / Portionen', recipe['recipeYield']);
  add('Vorbereitungszeit', recipe['prepTime']);
  add('Koch- oder Backzeit', recipe['cookTime']);
  add('Gesamtzeit', recipe['totalTime']);
  add('Kategorie', recipe['recipeCategory']);
  add('Stichworte', recipe['keywords']);
  lines.push('Zutaten:', ...ingredients.map((entry) => `- ${entry}`));
  const steps = instructions(recipe['recipeInstructions']);
  if (steps.length) lines.push('Zubereitung:', ...steps);
  const image = imageOf(recipe['image']);
  return { text: lines.join('\n'), ...(image ? { imageUrl: image } : {}) };
}

function absolute(url: string | undefined, base: string): string | undefined {
  try {
    const parsed = url ? new URL(decodeEntities(url), base) : undefined;
    return parsed && /^https?:$/.test(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Holt das Rezept aus einer Webseite: bevorzugt die maschinenlesbaren Angaben der Seite
 * (schema.org/Recipe), sonst ihren Fließtext.
 */
export function readHtml(html: string, baseUrl: string): PageContent {
  const openGraph = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html)?.[1];
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, json = ''] of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(json.trim());
    } catch {
      continue;
    }
    for (const node of recipeNodes(data)) {
      const found = recipeText(node);
      if (!found) continue;
      const image = absolute(found.imageUrl ?? openGraph, baseUrl);
      // Manche Seiten nennen dort nur die Zutaten; die Zubereitung steht dann im Fließtext
      const text = found.text.includes('\nZubereitung:\n') ? found.text : `${found.text}\n\nText der Seite:\n${pageText(html)}`;
      return { text, ...(image ? { imageUrl: image } : {}) };
    }
  }
  const image = absolute(openGraph, baseUrl);
  return { text: pageText(html), ...(image ? { imageUrl: image } : {}) };
}

function pageText(html: string): string {
  const title = plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  const body = html
    .replace(/<(script|style|noscript|svg|template|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return title ? `Seitentitel: ${title}\n${text}` : text;
}
