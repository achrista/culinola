import { describe, expect, it } from 'vitest';
import { matches } from './search.ts';

describe('Suche in Texten', () => {
  const kuchen = ['Omas Käsekuchen', 'Kuchen', 'Familienrezept', 'süß', undefined];

  it('findet ohne Rücksicht auf Groß- und Kleinschreibung, mitten im Wort', () => {
    expect(matches('OMAS', kuchen)).toBe(true);
    expect(matches('kuchen', kuchen)).toBe(true);
    expect(matches('torte', kuchen)).toBe(false);
  });

  it('nimmt Umlaute getippt, ausgeschrieben oder weggelassen', () => {
    for (const query of ['käse', 'kaese', 'kase', 'suess', 'süss', 'sus']) expect(matches(query, kuchen)).toBe(true);
    expect(matches('creme brulee', ['Crème brûlée'])).toBe(true);
  });

  it('verlangt jedes Wort, gleich in welchem Text', () => {
    expect(matches('käse familie', kuchen)).toBe(true);
    expect(matches('käse torte', kuchen)).toBe(false);
  });

  it('lässt ohne Suchwort alles durch', () => {
    expect(matches('', kuchen)).toBe(true);
    expect(matches('   ', [])).toBe(true);
  });
});
