import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { legacyDocText } from './office.ts';
import { pdfPhotos } from './pdf.ts';
import { EmptySourceError, kindOf, readSource } from './source.ts';

const jpeg = (bytes: number) => Uint8Array.from({ length: bytes }, (_, index) => (index === 0 ? 0xff : index === 1 ? 0xd8 : index === 2 ? 0xff : index % 251));

function docx(body: string, media: Record<string, Uint8Array> = {}): Uint8Array {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
  return zipSync({ 'word/document.xml': strToU8(xml), ...Object.fromEntries(Object.entries(media).map(([name, data]) => [`word/media/${name}`, data])) });
}

const p = (text: string) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="2835"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (...paragraphs: string[]) => `<w:tc>${paragraphs.map(p).join('')}</w:tc>`;

describe('Word-Dokumente', () => {
  it('liest Absätze, Tabulatoren und Sonderzeichen', async () => {
    const body = `${p('Käsekuchen')}<w:p><w:r><w:t>250 g</w:t><w:tab/><w:t>Quark &amp; Schmand</w:t><w:br/><w:t>3 Eier</w:t></w:r><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>`;
    const source = await readSource({ data: docx(body), name: 'Käsekuchen.docx' });
    expect(source.text).toBe('Käsekuchen\n250 g\tQuark & Schmand\n3 Eier');
  });

  it('macht aus einer einfachen Tabellenzeile eine Zeile', async () => {
    const body = `<w:tbl><w:tr>${cell('250 g')}${cell('Mehl')}</w:tr><w:tr>${cell('')}${cell('Butter')}</w:tr></w:tbl>`;
    expect((await readSource({ data: docx(body), name: 'a.docx' })).text).toBe('250 g\tMehl\n\tButter');
  });

  it('lässt Spalten mit mehreren Absätzen untereinander stehen', async () => {
    const body = `<w:tbl><w:tr>${cell('250 g Mehl', '3 Eier')}${cell('Alles verrühren.')}</w:tr></w:tbl>`;
    expect((await readSource({ data: docx(body), name: 'a.docx' })).text).toBe('250 g Mehl\n3 Eier\n\nAlles verrühren.');
  });

  it('liefert Fotos mit, das größte zuerst, und lässt Zierrat weg', async () => {
    const source = await readSource({ data: docx(p('Text'), { 'image1.png': jpeg(9_000), 'image2.jpeg': jpeg(20_000), 'linie.jpg': jpeg(500), 'logo.emf': jpeg(30_000) }), name: 'a.docx' });
    expect(source.images.map((image) => [image.name, image.mediaType])).toEqual([
      ['image2.jpeg', 'image/jpeg'],
      ['image1.png', 'image/png'],
    ]);
  });

  it('liest OpenDocument-Text samt Leerzeichen-Kürzel und Tabelle', async () => {
    const content = `<office:document-content><office:automatic-styles><style:style>nicht lesen</style:style></office:automatic-styles><office:body><office:text><text:h>Amerikaner</text:h><text:p>Heißluft:<text:s text:c="3"/><text:span>160 °C</text:span><text:tab/>vorgeheizt</text:p><table:table><table:table-row><table:table-cell><text:p>2</text:p></table:table-cell><table:table-cell><text:p>Eier</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>`;
    const source = await readSource({ data: zipSync({ 'content.xml': strToU8(content) }), name: 'Amerikaner.odt' });
    expect(source.text).toBe('Amerikaner\nHeißluft:   160 °C\tvorgeheizt\n2\tEier');
  });

  it('meldet ein leeres Dokument als leer', async () => {
    await expect(readSource({ data: docx('<w:p/>'), name: 'leer.docx' })).rejects.toBeInstanceOf(EmptySourceError);
  });

  it('holt den Text aus Word-Dateien vor Word 97', () => {
    const bytes = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0]), Buffer.alloc(40, 0xff), Buffer.from('LASAGNE\r6 Portionen\r1 kg Hackfleisch\x07B\xe9chamelsauce', 'latin1'), Buffer.from([0, 1, 2])]);
    expect(legacyDocText(bytes)).toBe('LASAGNE\n6 Portionen\n1 kg Hackfleisch\tBéchamelsauce');
  });
});

describe('Art der Quelle', () => {
  it('erkennt Dateien am Inhalt, nicht an der Endung', () => {
    expect(kindOf(strToU8('%PDF-1.4 …'), 'rezept.doc')).toBe('pdf');
    expect(kindOf(jpeg(10), 'foto.bin')).toBe('image/jpeg');
    expect(kindOf(strToU8('Delivery-date: Fri\nSubject: Brandteig'), 'Brandteig.docx')).toBe('text');
    expect(kindOf(strToU8('<!DOCTYPE html><html>'), 'seite')).toBe('html');
    expect(kindOf(Uint8Array.from([1, 0, 2, 0]), 'daten.xyz')).toBeUndefined();
  });

  it('liest alte Textdateien aus Windows mit Umlauten', async () => {
    expect((await readSource({ data: Buffer.from('K\xe4sesp\xe4tzle', 'latin1'), name: 'a.txt' })).text).toBe('Käsespätzle');
  });

  it('weist leeren Text zurück', async () => {
    await expect(readSource({ text: '  \n ' })).rejects.toBeInstanceOf(EmptySourceError);
  });
});

describe('Fotos im PDF', () => {
  const object = (dictionary: string, data: Uint8Array) => Buffer.concat([Buffer.from(`1 0 obj\n<<${dictionary}>>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);

  it('findet eingebettete JPEG-Bilder und übergeht alles andere', () => {
    const photo = jpeg(20_000);
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      object('/Length 5 /Filter /FlateDecode', Buffer.from('abcde')),
      object(`/Type /XObject /Subtype /Image /Filter /DCTDecode /Length ${photo.length} /ColorSpace /DeviceRGB`, photo),
      object('/Subtype /Image /Filter [/DCTDecode] /Length 9 0 R', jpeg(16_000)),
      object('/Subtype /Image /Filter /DCTDecode /Length 100', jpeg(100)),
    ]);
    const photos = pdfPhotos(pdf);
    expect(photos.map((entry) => entry.data.length)).toEqual([20_000, 16_000]);
    expect(Buffer.from(photos[0]!.data).equals(Buffer.from(photo))).toBe(true);
  });
});
