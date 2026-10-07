import { describe, expect, it } from 'vitest';
import { hasAttachments, mailDocument, newestFirst, senderOf } from './mail.ts';

describe('hasAttachments', () => {
  const text = { type: 'text/plain' };
  const html = { type: 'text/html' };

  it('findet Anlagen auch tief im Aufbau der Nachricht', () => {
    const pdf = { type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'rechnung.pdf' } };
    expect(hasAttachments(pdf)).toBe(true);
    expect(hasAttachments({ type: 'multipart/mixed', childNodes: [{ type: 'multipart/alternative', childNodes: [text, html] }, pdf] })).toBe(true);
    // Manche Programme nennen nur den Dateinamen und keine Art der Beilage
    expect(hasAttachments({ type: 'multipart/mixed', childNodes: [text, { type: 'application/zip', parameters: { name: 'fotos.zip' } }] })).toBe(true);
  });

  it('zählt Bilder im Text, Signaturen und reine Textnachrichten nicht', () => {
    expect(hasAttachments(text)).toBe(false);
    expect(hasAttachments({ type: 'multipart/alternative', childNodes: [text, html] })).toBe(false);
    expect(hasAttachments({ type: 'multipart/related', childNodes: [html, { type: 'image/png', disposition: 'inline', id: '<logo@x>', parameters: { name: 'logo.png' } }] })).toBe(false);
    expect(hasAttachments({ type: 'multipart/related', childNodes: [html, { type: 'image/png', id: '<logo@x>', parameters: { name: 'logo.png' } }] })).toBe(false);
    expect(hasAttachments({ type: 'multipart/signed', childNodes: [text, { type: 'application/pgp-signature', disposition: 'attachment', dispositionParameters: { filename: 'signature.asc' } }] })).toBe(false);
    expect(hasAttachments(undefined)).toBe(false);
  });

  it('zählt ein beigelegtes Bild ohne Bezug zum Text als Anlage', () => {
    expect(hasAttachments({ type: 'multipart/mixed', childNodes: [text, { type: 'image/jpeg', parameters: { name: 'urlaub.jpg' } }] })).toBe(true);
  });
});

describe('senderOf', () => {
  it('nimmt den Namen, sonst die Adresse', () => {
    expect(senderOf([{ name: ' Anna Beispiel ', address: 'anna@example.org' }])).toBe('Anna Beispiel');
    expect(senderOf([{ name: '', address: 'anna@example.org' }])).toBe('anna@example.org');
    expect(senderOf([])).toBe('');
    expect(senderOf(undefined)).toBe('');
  });
});

describe('newestFirst', () => {
  it('mischt die Konten nach Eingang und begrenzt die Liste', () => {
    const entry = (account: string, uid: number, date: string) => ({ account, uid, date, from: '', subject: '', unread: false, attachments: false, size: 0 });
    const list = newestFirst([entry('a', 1, '2026-10-07T08:00:00Z'), entry('b', 7, '2026-10-07T12:00:00Z'), entry('a', 2, '2026-10-07T10:00:00Z'), entry('b', 8, '2026-10-07T12:00:00Z')], 3);
    expect(list.map((item) => `${item.account}${item.uid}`)).toEqual(['b8', 'b7', 'a2']);
  });
});

describe('mailDocument', () => {
  const page = mailDocument('<p>Hallo</p><script>alert(1)</script><img src="https://example.org/zaehler.gif">');

  it('verbietet Skripte und jedes Nachladen von außen, lässt aber eingebettete Bilder zu', () => {
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain('img-src data:');
    expect(policy).not.toMatch(/https?:|\*|script-src/);
  });

  it('lässt auf Wunsch Bilder aus dem Netz zu – und sonst weiterhin nichts', () => {
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(mailDocument('<p>x</p>', true))?.[1] ?? '';
    expect(policy).toContain('img-src data: https: http:');
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toMatch(/script-src|connect-src|frame-src|\*/);
    expect(mailDocument('<p>x</p>', true)).toContain('name="referrer" content="no-referrer"');
  });

  it('stellt den eigenen Rahmen vor den Inhalt der Nachricht', () => {
    expect(page.indexOf('Content-Security-Policy')).toBeLessThan(page.indexOf('<p>Hallo</p>'));
    expect(page.indexOf('<base target="_blank">')).toBeLessThan(page.indexOf('<p>Hallo</p>'));
    expect(page.startsWith('<!doctype html>')).toBe(true);
  });
});
