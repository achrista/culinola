import { describe, expect, it } from 'vitest';
import { placeOf } from './place.ts';

describe('placeOf', () => {
  it('nennt bei Nummern aus dem eigenen Land den Ort des Ortsnetzes', async () => {
    expect(await placeOf('0821123456', 'DE', 'de')).toBe('Augsburg');
    expect(await placeOf('089 123456', 'DE', 'de')).toBe('München');
    expect(await placeOf('089123456', 'DE', 'en')).toBe('Munich');
  });

  it('nennt bei ausländischen Nummern Ort und Land, gleich wie die Ländervorwahl geschrieben ist', async () => {
    expect(await placeOf('004312345678', 'DE', 'de')).toBe('Wien, Österreich');
    expect(await placeOf('+4312345678', 'DE', 'de')).toBe('Wien, Österreich');
    expect(await placeOf('+41446681800', 'DE', 'en')).toBe('Zurich, Switzerland');
  });

  it('nennt nur das Land, wenn das Verzeichnis den Ort nicht kennt', async () => {
    expect(await placeOf('0033145678901', 'DE', 'de')).toBe('Frankreich');
  });

  it('sagt bei Nummern ohne Ort, was für eine es ist', async () => {
    expect(await placeOf('015112345678', 'DE', 'de')).toBe('Mobilfunk');
    expect(await placeOf('08001234567', 'DE', 'de')).toBe('kostenlose Rufnummer');
    expect(await placeOf('00436641234567', 'DE', 'de')).toBe('Mobilfunk, Österreich');
  });

  it('liest dieselbe Nummer von einem anderen Land aus anders', async () => {
    expect(await placeOf('0821123456', 'AT', 'de')).not.toBe('Augsburg');
    expect(await placeOf('+49821123456', 'AT', 'de')).toBe('Augsburg, Deutschland');
  });

  it('bleibt leer, wo sich nichts sagen lässt', async () => {
    for (const number of ['', '?', 'anonym', '110', '12']) expect(await placeOf(number, 'DE', 'de'), number).toBe('');
  });
});
