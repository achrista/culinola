import { describe, expect, it } from 'vitest';
import { rtfToText } from './rtf.ts';

describe('rtfToText', () => {
  it('liest Text und Absätze und lässt Schriften, Farben und Formatierung weg', () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fswiss Helvetica;}{\f1 Arial;}}{\colortbl;\red255\green0\blue0;}
{\*\generator Riched20 10.0.19041}\viewkind4\uc1\pard\f0\fs22 Hallo \b zusammen\b0 ,\par
das Training f\'e4llt aus.\par\par
Viele Gr\'fc\'dfe\line der Vorstand\par}`;
    expect(rtfToText(rtf)).toBe('Hallo zusammen,\ndas Training fällt aus.\n\nViele Grüße\nder Vorstand');
  });

  it('liest Unicode-Zeichen und überspringt deren Ersatzzeichen', () => {
    // Ohne String.raw: "荤" wäre dort für JavaScript selbst schon ein Zeichen
    expect(rtfToText('{\\rtf1 Preis: 5 \\u8364? \\u-10179?\\u-8704? Ende}')).toBe('Preis: 5 € 😀 Ende');
    expect(rtfToText(String.raw`{\rtf1\uc2 A\u228\'e4\'e4B}`)).toBe('AäB');
    expect(rtfToText(String.raw`{\rtf1\uc0 A\u228 B}`)).toBe('AäB');
  });

  it('behält maskierte Klammern und setzt Sonderzeichen um', () => {
    expect(rtfToText(String.raw`{\rtf1 a\{b\}c\\d \endash  \ldblquote Zitat\rdblquote\tab Ende\~x}`)).toBe('a{b}c\\d – “Zitat”\tEnde x');
  });

  it('übergeht Bilder, eingebettete Daten und unbekannte Abschnitte', () => {
    const rtf = String.raw`{\rtf1 Vorher {\pict\pngblip 89504e470d0a1a0a} {\*\unbekannt geheim {tiefer}} {\info{\title Titel}{\author Wer}} nachher}`;
    expect(rtfToText(rtf)).toBe('Vorher    nachher'.replace(/ {2,}/g, (spaces) => spaces));
    expect(rtfToText(rtf).replace(/\s+/g, ' ')).toBe('Vorher nachher');
  });

  it('zeigt bei einem Feld das Ergebnis, nicht die Anweisung', () => {
    expect(rtfToText(String.raw`{\rtf1 Siehe {\field{\*\fldinst HYPERLINK "https://example.org"}{\fldrslt unsere Seite}}.}`)).toBe('Siehe unsere Seite.');
  });

  it('kommt mit Kaputtem zurecht', () => {
    expect(rtfToText('')).toBe('');
    expect(rtfToText('kein rtf')).toBe('kein rtf');
    expect(rtfToText(String.raw`{\rtf1 offen {\b fett`)).toBe('offen fett');
    expect(rtfToText(String.raw`}}} zu viele {\rtf1 zu}`)).toBe('zu viele zu');
    expect(rtfToText('{\\rtf1 Ende\\')).toBe('Ende');
  });
});
