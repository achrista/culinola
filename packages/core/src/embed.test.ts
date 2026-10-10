import { describe, expect, it } from 'vitest';
import { EmbedCheck, framingRefusal } from './embed.ts';

const headers = (entries: Record<string, string>) => new Headers(entries);

describe('Darf eine Seite eingebettet werden?', () => {
  it('liest das Verbot aus X-Frame-Options', () => {
    expect(framingRefusal(headers({}))).toBeUndefined();
    expect(framingRefusal(headers({ 'X-Frame-Options': 'DENY' }))).toBe('X-Frame-Options: DENY');
    expect(framingRefusal(headers({ 'x-frame-options': ' sameorigin ' }))).toBe('X-Frame-Options: sameorigin');
    // Veraltete Angaben, die kein Browser mehr beachtet
    expect(framingRefusal(headers({ 'X-Frame-Options': 'ALLOW-FROM https://example.org' }))).toBeUndefined();
  });

  it('liest frame-ancestors und vergleicht mit dem Rechner der Anzeige', () => {
    const csp = (value: string) => headers({ 'Content-Security-Policy': value });
    expect(framingRefusal(csp("default-src 'self'"))).toBeUndefined();
    expect(framingRefusal(csp("default-src 'self'; frame-ancestors 'none'"))).toBe("Content-Security-Policy: frame-ancestors 'none'");
    expect(framingRefusal(csp("frame-ancestors 'self'"), 'kueche:8443')).toBe("Content-Security-Policy: frame-ancestors 'self'");
    expect(framingRefusal(csp('frame-ancestors *'))).toBeUndefined();
    expect(framingRefusal(csp('frame-ancestors https:'))).toBeUndefined();
    expect(framingRefusal(csp("frame-ancestors 'self' https://kueche:8443"), 'kueche:8443')).toBeUndefined();
    expect(framingRefusal(csp('frame-ancestors https://kueche:8443'), 'kueche:8090')).toBeDefined();
    expect(framingRefusal(csp('frame-ancestors *.fritz.box'), 'nas.fritz.box:8443')).toBeUndefined();
    expect(framingRefusal(csp('frame-ancestors https://example.org'), 'kueche:8443')).toBeDefined();
    // Ohne den Rechner der Anzeige gilt eine namentliche Erlaubnis als fremd
    expect(framingRefusal(csp('frame-ancestors https://kueche:8443'))).toBeDefined();
    // Nennt die Seite Vorfahren, zählt X-Frame-Options nicht mehr
    expect(
      framingRefusal(
        headers({
          'Content-Security-Policy': 'frame-ancestors *',
          'X-Frame-Options': 'DENY',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('Prüfung der eingebetteten Seiten', () => {
  const layouts = {
    main: {
      grid: { columns: 2, rows: 1 },
      widgets: [
        {
          type: 'web',
          at: [0, 0, 1, 1] as [number, number, number, number],
          config: { url: 'https://offen.example/' },
        },
        {
          type: 'web',
          at: [1, 0, 1, 1] as [number, number, number, number],
          config: { url: 'https://zu.example/' },
        },
        {
          type: 'web',
          at: [1, 0, 1, 1] as [number, number, number, number],
          config: { url: 'https://weg.example/' },
        },
        {
          type: 'image',
          at: [1, 0, 1, 1] as [number, number, number, number],
          config: { url: 'https://bild.example/a.jpg' },
        },
        {
          type: 'web',
          at: [1, 0, 1, 1] as [number, number, number, number],
          config: { url: 'file:///etc/passwd' },
        },
      ],
    },
  };

  it('ruft nur Adressen ab, die in einer Kachel "web" stehen, und merkt sich das Ergebnis', async () => {
    const asked: string[] = [];
    const load = (async (url: string) => {
      asked.push(url);
      if (url.includes('weg')) throw new Error('getaddrinfo ENOTFOUND weg.example');
      return new Response('', {
        headers: url.includes('zu') ? { 'X-Frame-Options': 'DENY' } : {},
      });
    }) as typeof fetch;
    const check = new EmbedCheck(layouts, load);
    expect(check.allows('https://offen.example/')).toBe(true);
    for (const url of ['https://bild.example/a.jpg', 'file:///etc/passwd', 'https://fremd.example/', '']) expect(check.allows(url), url).toBe(false);

    expect(await check.check('https://offen.example/', 'kueche:8443', 1000)).toEqual({ ok: true });
    expect(await check.check('https://zu.example/', 'kueche:8443', 1000)).toEqual({
      ok: false,
      reason: 'refused',
      detail: 'X-Frame-Options: DENY',
    });
    expect(await check.check('https://weg.example/', 'kueche:8443', 1000)).toEqual({
      ok: false,
      reason: 'unreachable',
      detail: 'getaddrinfo ENOTFOUND weg.example',
    });
    await check.check('https://offen.example/', 'kueche:8443', 60_000);
    expect(asked).toHaveLength(3);
    // Nach einigen Minuten wird neu nachgesehen
    await check.check('https://offen.example/', 'kueche:8443', 1000 + 11 * 60_000);
    expect(asked).toHaveLength(4);
  });
});
