import { XMLParser } from 'fast-xml-parser';

export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  /** Bild zur Meldung, so wie es der Anbieter im Feed mitliefert. */
  image?: string;
  /** Zeitpunkt der Veröffentlichung in Millisekunden seit 1970; 0, wenn der Feed keinen nennt. */
  published: number;
}

const SUMMARY_MAX = 420;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, htmlEntities: true, trimValues: true });

type Node = Record<string, unknown>;

function list(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is Node => typeof entry === 'object' && entry !== null);
}

/** Der Textinhalt eines Elements – gleich, ob es Attribute trägt oder nicht. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return text((value as Node)['#text']);
  return '';
}

/** Entfernt HTML und kürzt auf eine Länge, die als Anreißer taugt. */
export function plainText(html: string): string {
  const plain = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= SUMMARY_MAX) return plain;
  const cut = plain.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), SUMMARY_MAX - 40))} …`;
}

function httpUrl(value: unknown): string | undefined {
  const url = text(value).trim();
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function firstImageIn(html: string): string | undefined {
  return httpUrl(/<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1]);
}

/** Das Bild einer Meldung: Anhang, Medienangabe oder das erste Bild im Text. */
function imageOf(item: Node, body: string): string | undefined {
  for (const enclosure of list(item.enclosure)) {
    const type = text(enclosure['@_type']);
    if (type.startsWith('image/') || (!type && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(text(enclosure['@_url'])))) {
      const url = httpUrl(enclosure['@_url']);
      if (url) return url;
    }
  }
  for (const key of ['media:content', 'media:thumbnail']) {
    for (const media of list(item[key])) {
      const medium = text(media['@_medium']);
      const type = text(media['@_type']);
      if (medium && medium !== 'image') continue;
      if (type && !type.startsWith('image/')) continue;
      const url = httpUrl(media['@_url']);
      if (url) return url;
    }
  }
  for (const group of list(item['media:group'])) {
    const nested = imageOf(group, '');
    if (nested) return nested;
  }
  return firstImageIn(body);
}

function time(value: unknown): number {
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function atomLink(entry: Node): string | undefined {
  const links = list(entry.link);
  const best = links.find((link) => text(link['@_rel']) === 'alternate') ?? links.find((link) => !link['@_rel']) ?? links[0];
  return httpUrl(best?.['@_href']) ?? httpUrl(entry.link);
}

/**
 * Liest Meldungen aus einem Feed. Verstanden werden RSS 2.0, das ältere RDF-Format
 * und Atom; Meldungen ohne Überschrift oder Adresse werden ausgelassen.
 */
export function parseFeed(xml: string): NewsItem[] {
  const root = parser.parse(xml) as Node;
  const rss = root.rss as Node | undefined;
  const rdf = root['rdf:RDF'] as Node | undefined;
  const atom = root.feed as Node | undefined;
  const items: NewsItem[] = [];

  const push = (title: string, body: string, link: string | undefined, image: string | undefined, published: number) => {
    const clean = plainText(title);
    if (!clean || !link) return;
    items.push({ title: clean, summary: plainText(body), link, ...(image ? { image } : {}), published });
  };

  if (rss || rdf) {
    const entries = rss ? list((rss.channel as Node | undefined)?.item) : list(rdf!.item);
    for (const entry of entries) {
      const body = text(entry.description) || text(entry['content:encoded']);
      const full = `${text(entry.description)} ${text(entry['content:encoded'])}`;
      push(text(entry.title), body, httpUrl(entry.link) ?? httpUrl(entry.guid), imageOf(entry, full), time(entry.pubDate) || time(entry['dc:date']));
    }
  } else if (atom) {
    for (const entry of list(atom.entry)) {
      const body = text(entry.summary) || text(entry.content);
      push(text(entry.title), body, atomLink(entry), imageOf(entry, `${text(entry.summary)} ${text(entry.content)}`), time(entry.published) || time(entry.updated));
    }
  } else {
    throw new Error('Die Antwort ist kein RSS- oder Atom-Feed.');
  }
  return items;
}

/**
 * Ob eine Seite sich in einer anderen anzeigen lässt. Maßgeblich sind die
 * Kopfzeilen der Antwort; jede Einschränkung gilt als Verbot, außer der ausdrücklichen Freigabe für alle.
 */
export function embeddable(headers: Headers): boolean {
  if (headers.get('x-frame-options')) return false;
  const ancestors = /frame-ancestors([^;]*)/i.exec(headers.get('content-security-policy') ?? '');
  return !ancestors || ancestors[1]!.trim() === '*';
}
