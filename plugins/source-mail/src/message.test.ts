import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { readableMessage } from './message.ts';

const HEAD = ['From: Anna Beispiel <anna@example.org>', 'To: kueche@example.org, Opa <opa@example.org>', 'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=', 'Date: Wed, 07 Oct 2026 18:30:00 +0200', 'MIME-Version: 1.0'];
const mail = (...lines: string[]) => simpleParser([...HEAD, ...lines].join('\r\n'));
const part = (boundary: string, headers: string[], body: string) => [`--${boundary}`, ...headers, '', body];

describe('readableMessage', () => {
  it('liest eine Textnachricht mit Kopfangaben', async () => {
    const message = readableMessage(await mail('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', 'Hallo,\r\ndas ist Text.'), '');
    expect(message).toEqual({ subject: 'Grüße', from: '"Anna Beispiel" <anna@example.org>', to: 'kueche@example.org, "Opa" <opa@example.org>', date: '2026-10-07T16:30:00.000Z', text: 'Hallo,\ndas ist Text.', attachments: [] });
  });

  it('legt HTML in den Schutzrahmen und nennt Anlagen nur beim Namen', async () => {
    const parsed = await mail(
      'Content-Type: multipart/mixed; boundary="aussen"',
      '',
      ...part('aussen', ['Content-Type: text/html; charset=utf-8'], '<p>Guten <b>Tag</b></p><script>alert(1)</script>'),
      ...part('aussen', ['Content-Type: application/pdf; name="rechnung.pdf"', 'Content-Disposition: attachment; filename="rechnung.pdf"', 'Content-Transfer-Encoding: base64'], Buffer.from('%PDF-1.4 erfunden').toString('base64')),
      '--aussen--',
    );
    const message = readableMessage(parsed, '');
    expect(message.html).toContain("default-src 'none'");
    expect(message.html).toContain('<p>Guten <b>Tag</b></p>');
    expect(message.attachments).toEqual([{ name: 'rechnung.pdf', size: 17 }]);
    // Der Inhalt der Anlage gehört nicht in die Antwort
    expect(JSON.stringify(message)).not.toContain('erfunden');
  });

  it('zählt Bilder im Text nicht zu den Anlagen und bettet sie ein', async () => {
    const parsed = await mail(
      'Content-Type: multipart/related; boundary="rel"',
      '',
      ...part('rel', ['Content-Type: text/html; charset=utf-8'], '<p>Logo: <img src="cid:logo@x"></p>'),
      ...part('rel', ['Content-Type: image/png; name="logo.png"', 'Content-ID: <logo@x>', 'Content-Disposition: inline; filename="logo.png"', 'Content-Transfer-Encoding: base64'], 'iVBORw0KGgo='),
      '--rel--',
    );
    const message = readableMessage(parsed, '');
    expect(message.attachments).toEqual([]);
    expect(message.html).toContain('src="data:image/png;base64,');
    expect(message.html).not.toContain('cid:');
  });

  it('macht aus einer Nachricht, die nur Rich Text enthält, lesbaren Text', async () => {
    const rtf = String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Liebe Gr\'fc\'dfe\par aus dem B\'fcro}`;
    const parsed = await mail('Content-Type: application/rtf; name="nachricht.rtf"', 'Content-Transfer-Encoding: base64', '', Buffer.from(rtf, 'latin1').toString('base64'));
    const message = readableMessage(parsed, '');
    expect(message.text).toBe('Liebe Grüße\naus dem Büro');
    expect(message.attachments).toEqual([]);
    expect(message).not.toHaveProperty('html');
  });

  it('lässt ein beigelegtes RTF-Dokument eine Anlage sein, wenn die Nachricht eigenen Text hat', async () => {
    const parsed = await mail(
      'Content-Type: multipart/mixed; boundary="aussen"',
      '',
      ...part('aussen', ['Content-Type: text/plain; charset=utf-8'], 'Das Protokoll hängt an.'),
      ...part('aussen', ['Content-Type: application/rtf; name="protokoll.rtf"', 'Content-Disposition: attachment; filename="protokoll.rtf"'], String.raw`{\rtf1 Protokoll}`),
      '--aussen--',
    );
    const message = readableMessage(parsed, '');
    expect(message.text).toBe('Das Protokoll hängt an.');
    expect(message.attachments.map((entry) => entry.name)).toEqual(['protokoll.rtf']);
  });

  it('nimmt ohne Datum in der Nachricht den Zeitpunkt des Eingangs', async () => {
    const parsed = await simpleParser(['From: a@example.org', 'Subject: x', '', 'Text'].join('\r\n'));
    expect(readableMessage(parsed, '2026-10-01T08:00:00.000Z').date).toBe('2026-10-01T08:00:00.000Z');
  });
});
