import { describe, expect, it } from 'vitest';
import { embeddable, parseFeed, plainText } from './parse.ts';

describe('parseFeed', () => {
  it('liest RSS 2.0 mit Bild als Anhang', () => {
    const items = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>Erste Meldung</title><link>https://example.org/a</link><description><![CDATA[<p>Text der <b>Meldung</b>.</p>]]></description>
        <pubDate>Tue, 06 Oct 2026 16:20:00 +0200</pubDate><enclosure url="https://example.org/a.jpg" type="image/jpeg" length="1"/></item>
      <item><title>Zweite &amp; letzte</title><link>https://example.org/b</link><description>Kurz.</description></item>
    </channel></rss>`);
    expect(items).toEqual([
      { title: 'Erste Meldung', summary: 'Text der Meldung .', link: 'https://example.org/a', image: 'https://example.org/a.jpg', published: Date.parse('2026-10-06T14:20:00Z') },
      { title: 'Zweite & letzte', summary: 'Kurz.', link: 'https://example.org/b', published: 0 },
    ]);
  });

  it('nimmt das erste Bild aus dem Text, wenn kein Anhang da ist', () => {
    const [item] = parseFeed(`<rss><channel><item><title>T</title><link>https://example.org/a</link>
      <content:encoded><![CDATA[<p><img src="https://example.org/bild.png" alt=""/>Text</p>]]></content:encoded></item></channel></rss>`);
    expect(item?.image).toBe('https://example.org/bild.png');
    expect(item?.summary).toBe('Text');
  });

  it('liest Medienangaben und übergeht Videos', () => {
    const [item] = parseFeed(`<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>T</title><link>https://example.org/a</link>
      <media:content url="https://example.org/film.mp4" medium="video"/><media:thumbnail url="https://example.org/vorschau.jpg"/></item></channel></rss>`);
    expect(item?.image).toBe('https://example.org/vorschau.jpg');
  });

  it('liest das ältere RDF-Format mit Datum nach Dublin Core', () => {
    const [item] = parseFeed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item><title>RDF-Meldung</title><link>https://example.org/r</link><description>Text</description><dc:date>2026-10-06T14:20:00Z</dc:date></item></rdf:RDF>`);
    expect(item).toEqual({ title: 'RDF-Meldung', summary: 'Text', link: 'https://example.org/r', published: Date.parse('2026-10-06T14:20:00Z') });
  });

  it('liest Atom und wählt die Adresse der Meldung, nicht die des Feeds', () => {
    const [item] = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Atom-Meldung</title>
      <link rel="self" href="https://example.org/feed"/><link rel="alternate" href="https://example.org/artikel"/>
      <summary>Kurztext</summary><updated>2026-10-06T14:20:00Z</updated></entry></feed>`);
    expect(item).toEqual({ title: 'Atom-Meldung', summary: 'Kurztext', link: 'https://example.org/artikel', published: Date.parse('2026-10-06T14:20:00Z') });
  });

  it('lässt Meldungen ohne Überschrift oder Adresse aus', () => {
    expect(parseFeed('<rss><channel><item><title>Ohne Adresse</title></item><item><link>https://example.org/x</link></item></channel></rss>')).toEqual([]);
  });

  it('nimmt keine Adressen an, die nicht ins Web zeigen', () => {
    const [item] = parseFeed(`<rss><channel><item><title>T</title><link>https://example.org/a</link>
      <enclosure url="javascript:alert(1)" type="image/png"/></item><item><title>Böse</title><link>javascript:alert(1)</link></item></channel></rss>`);
    expect(item).toEqual({ title: 'T', summary: '', link: 'https://example.org/a', published: 0 });
  });

  it('meldet, wenn die Antwort gar kein Feed ist', () => {
    expect(() => parseFeed('<html><body>Seite</body></html>')).toThrow(/kein RSS- oder Atom-Feed/);
  });
});

describe('plainText', () => {
  it('entfernt HTML samt Skripten und kürzt an einer Wortgrenze', () => {
    expect(plainText('<script>x()</script><p>Hallo&nbsp;Welt</p>')).toBe('Hallo Welt');
    const long = plainText('Wort '.repeat(200));
    expect(long.length).toBeLessThanOrEqual(422);
    expect(long.endsWith(' …')).toBe(true);
  });
});

describe('embeddable', () => {
  it('erlaubt Seiten ohne Einschränkung und mit ausdrücklicher Freigabe', () => {
    expect(embeddable(new Headers())).toBe(true);
    expect(embeddable(new Headers({ 'content-security-policy': "default-src 'self'; frame-ancestors *" }))).toBe(true);
  });

  it('wertet jede Einschränkung als Verbot', () => {
    expect(embeddable(new Headers({ 'x-frame-options': 'SAMEORIGIN' }))).toBe(false);
    expect(embeddable(new Headers({ 'content-security-policy': "frame-ancestors 'self'" }))).toBe(false);
    expect(embeddable(new Headers({ 'content-security-policy': "frame-ancestors 'none'; upgrade-insecure-requests" }))).toBe(false);
  });
});
