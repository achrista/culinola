import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateIp, readHtml } from './web.ts';

describe('Schutz des eigenen Netzes', () => {
  it('erkennt private und lokale Adressen', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.178.1', '172.20.0.5', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', 'unsinn']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2a00:1450:4001::1']) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it('weist alles ab, was keine öffentliche Webadresse ist', async () => {
    for (const url of ['kein-url', 'file:///etc/passwd', 'ftp://example.org/', 'http://localhost:8090/', 'http://fritz.box.local/', 'http://192.168.178.1/', 'http://[::1]/', 'http://127.0.0.1:3000/api']) {
      await expect(assertPublicUrl(url), url).rejects.toThrow();
    }
  });
});

describe('Rezeptseiten', () => {
  it('bevorzugt die maschinenlesbaren Angaben der Seite', () => {
    const data = {
      '@graph': [
        { '@type': 'WebSite', name: 'Backseite' },
        {
          '@type': ['Recipe', 'Thing'],
          name: 'Brandteig &amp; Windbeutel',
          recipeYield: ['12', '12 Stück'],
          totalTime: 'PT45M',
          image: [{ '@type': 'ImageObject', url: '/bilder/brandteig.jpg' }],
          recipeIngredient: ['250 ml  Wasser', '150 g Mehl'],
          recipeInstructions: [
            { '@type': 'HowToSection', name: 'Teig', itemListElement: [{ '@type': 'HowToStep', text: '<p>Wasser aufkochen.</p>' }] },
            { '@type': 'HowToStep', text: 'Backen.' },
          ],
        },
      ],
    };
    const html = `<html><head><title>Egal</title><script type="application/ld+json">{kaputt</script><script type="application/ld+json">${JSON.stringify(data)}</script></head><body>Werbung</body></html>`;
    expect(readHtml(html, 'https://example.org/rezepte/brandteig')).toEqual({
      text: 'Rezept: Brandteig & Windbeutel\nErgibt / Portionen: 12\nGesamtzeit: PT45M\nZutaten:\n- 250 ml Wasser\n- 150 g Mehl\nZubereitung:\nTeig:\nWasser aufkochen.\nBacken.',
      imageUrl: 'https://example.org/bilder/brandteig.jpg',
    });
  });

  it('nimmt sonst den Fließtext ohne Skripte und das Vorschaubild', () => {
    const html = `<html><head><title>Omas K&auml;sekuchen</title><meta property="og:image" content="https://example.org/kuchen.jpg"><style>p{}</style></head><body><script>alert(1)</script><h1>Käsekuchen</h1><p>500&nbsp;g Quark</p><ul><li>3 Eier</li></ul></body></html>`;
    expect(readHtml(html, 'https://example.org/')).toEqual({ text: 'Seitentitel: Omas Käsekuchen\nKäsekuchen\n500 g Quark\n3 Eier', imageUrl: 'https://example.org/kuchen.jpg' });
  });

  it('ergänzt den Fließtext, wenn die Angaben der Seite keine Zubereitung nennen', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Brandteig', recipeIngredient: ['100 g Mehl'] })}</script><p>Wasser aufkochen und Mehl einrühren.</p>`;
    expect(readHtml(html, 'https://example.org/').text).toBe('Rezept: Brandteig\nZutaten:\n- 100 g Mehl\n\nText der Seite:\nWasser aufkochen und Mehl einrühren.');
  });

  it('übernimmt kein Bild mit fremdem Adressschema', () => {
    const html = '<meta property="og:image" content="javascript:alert(1)"><p>Text</p>';
    expect(readHtml(html, 'https://example.org/').imageUrl).toBeUndefined();
  });
});
