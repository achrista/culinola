import type { LayoutConfig } from './config.ts';

/** Ob sich eine fremde Seite in einer Kachel zeigen lässt. */
export interface EmbedResult {
  ok: boolean;
  /** `refused`: Die Seite verbietet das Einbetten. `unreachable`: Der Kern erreicht sie nicht – die Anzeige vielleicht doch. */
  reason?: 'refused' | 'unreachable';
  /** Die Kopfzeile, die das Einbetten verbietet, oder der Fehler beim Abruf. */
  detail?: string;
}

const TIMEOUT_MS = 8_000;
const KEEP_MS = 10 * 60_000;

/** Passt eine Quelle aus `frame-ancestors` (etwa `https://*.example.org` oder `kueche:8443`) auf den Rechner der Anzeige? */
function sourceMatches(source: string, host: string): boolean {
  const pattern = source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
  const [wantedName = '', wantedPort] = pattern.toLowerCase().split(/:(?=[\d*]+$)/);
  const [name = '', port] = host.toLowerCase().split(/:(?=\d+$)/);
  if (wantedPort && wantedPort !== '*' && wantedPort !== port) return false;
  return wantedName.startsWith('*.') ? name.endsWith(wantedName.slice(1)) : wantedName === name;
}

/**
 * Liest aus den Kopfzeilen einer Seite, ob sie sich in eine fremde Seite einbetten lässt. Liefert die
 * Kopfzeile, die es verbietet – oder nichts, wenn nichts dagegen spricht. `host` ist der Rechner der
 * Anzeige, wie ihn der Browser nennt ("kueche:8443"); ohne ihn gilt jede namentliche Erlaubnis als fremd.
 */
export function framingRefusal(headers: Headers, host?: string): string | undefined {
  const policy = headers.get('content-security-policy') ?? '';
  const ancestors = policy
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === 'frame-ancestors');
  // Wo die Seite Vorfahren nennt, gilt nur das – die ältere Kopfzeile X-Frame-Options ist dann ohne Wirkung
  if (ancestors) {
    const sources = ancestors.slice(1);
    const open = sources.some((source) => source === '*' || /^https?:$/i.test(source) || (!source.startsWith("'") && !!host && sourceMatches(source, host)));
    return open ? undefined : `Content-Security-Policy: frame-ancestors ${sources.join(' ') || "'none'"}`;
  }
  const options = headers.get('x-frame-options')?.trim();
  if (options && /^(deny|sameorigin)\b/i.test(options)) return `X-Frame-Options: ${options}`;
  return undefined;
}

/**
 * Prüft die Seiten, die in Kacheln vom Typ "web" stehen – und nur die: Der Kern ruft keine Adressen ab,
 * die ihm ein Aufrufer nennt. Das Ergebnis gilt einige Minuten.
 */
export class EmbedCheck {
  private readonly urls = new Set<string>();
  private readonly known = new Map<string, { at: number; result: Promise<EmbedResult> }>();
  private readonly load: typeof fetch;

  constructor(layouts: Record<string, LayoutConfig>, load: typeof fetch = fetch) {
    this.load = load;
    for (const layout of Object.values(layouts)) {
      for (const widget of layout?.widgets ?? []) {
        const url = widget.type === 'web' ? (widget.config as { url?: unknown } | undefined)?.url : undefined;
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) this.urls.add(url);
      }
    }
  }

  allows(url: string): boolean {
    return this.urls.has(url);
  }

  check(url: string, host?: string, now = Date.now()): Promise<EmbedResult> {
    const key = `${host ?? ''} ${url}`;
    const before = this.known.get(key);
    if (before && now - before.at < KEEP_MS) return before.result;
    const result = this.fetch(url, host);
    this.known.set(key, { at: now, result });
    return result;
  }

  private async fetch(url: string, host?: string): Promise<EmbedResult> {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
    try {
      const response = await this.load(url, {
        signal: stop.signal,
        redirect: 'follow',
        headers: { Accept: 'text/html,*/*;q=0.8' },
      });
      // Gebraucht werden nur die Kopfzeilen
      void response.body?.cancel().catch(() => undefined);
      const refusal = framingRefusal(response.headers, host);
      return refusal ? { ok: false, reason: 'refused', detail: refusal } : { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: 'unreachable',
        detail: stop.signal.aborted ? 'keine Antwort' : error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
