import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inside, parseRecipe, recipeId } from './library.ts';

describe('parseRecipe', () => {
  it('liest Kopfdaten und lässt sie aus dem Text heraus', () => {
    const recipe = parseRecipe('kuchen.md', '---\ntitle: Käsekuchen\ncategory: Backen\ntags: [Kuchen, Quark]\ntime: 90 min\nservings: 12\n---\n\n## Zutaten\n\n- 500 g Quark\n');
    expect(recipe).toEqual({ title: 'Käsekuchen', category: 'Backen', tags: ['Kuchen', 'Quark'], time: '90 min', servings: '12', markdown: '## Zutaten\n\n- 500 g Quark' });
  });

  it('versteht deutsche Feldnamen und Stichworte als Aufzählung mit Kommas', () => {
    const recipe = parseRecipe('x.md', '---\nTitel: Linsensuppe\nKategorie: Suppen\nStichworte: vegetarisch, schnell\nPortionen: 4\nZeit: 30 min\n---\nText');
    expect(recipe).toMatchObject({ title: 'Linsensuppe', category: 'Suppen', tags: ['vegetarisch', 'schnell'], servings: '4', time: '30 min', markdown: 'Text' });
  });

  it('nimmt ohne Kopfdaten die erste Überschrift als Titel und zeigt sie nicht doppelt', () => {
    const recipe = parseRecipe('pfannkuchen.md', '# Pfannkuchen\n\nMehl und Milch verrühren.\n');
    expect(recipe).toEqual({ title: 'Pfannkuchen', tags: [], markdown: 'Mehl und Milch verrühren.' });
  });

  it('lässt eine Überschrift stehen, die vom Titel der Kopfdaten abweicht', () => {
    const recipe = parseRecipe('x.md', '---\ntitle: Sonntagsbraten\n---\n# Vorbereitung\n\nText');
    expect(recipe.title).toBe('Sonntagsbraten');
    expect(recipe.markdown).toBe('# Vorbereitung\n\nText');
  });

  it('fällt auf den Dateinamen zurück', () => {
    expect(parseRecipe('omas_apfel-strudel.md', 'Nur Text.').title).toBe('omas apfel strudel');
  });

  it('meldet unlesbare Kopfdaten und zeigt das Rezept trotzdem', () => {
    const recipe = parseRecipe('suppe.md', '---\ntitle: [offen\n---\n# Suppe\n\nText');
    expect(recipe.problem).toMatch(/Kopfdaten nicht lesbar/);
    expect(recipe).toMatchObject({ title: 'Suppe', markdown: 'Text' });
  });

  it('nennt das Bild aus den Kopfdaten, sonst das erste im Text', () => {
    expect(parseRecipe('x.md', '---\nbild: fotos/suppe.jpg\n---\n![a](anderes.png)').image).toBe('fotos/suppe.jpg');
    expect(parseRecipe('x.md', '# Kuchen\n\nText ![Der Kuchen](bilder/kuchen.png "Titel") und ![b](zwei.png)').image).toBe('bilder/kuchen.png');
    expect(parseRecipe('x.md', 'Ohne Bild.').image).toBeUndefined();
  });

  it('nennt die Herkunft aus den Kopfdaten, sonst aus der Zeile "Quelle" im Text', () => {
    expect(parseRecipe('a.md', '---\nsource: Familienrezept\n---\nText\n\nQuelle: [Instagram](<https://www.instagram.com/reel/ABC>)').source).toBe('Familienrezept');
    expect(parseRecipe('a.md', '---\nQuelle: Oma Lina\n---\nText').source).toBe('Oma Lina');
    expect(parseRecipe('a.md', 'Text\n\nQuelle: [Instagram](<https://www.instagram.com/reel/ABC>)\n').source).toBe('Instagram');
    expect(parseRecipe('a.md', 'Quelle: Zeitschrift\n\nText\n\nSource: [Koch \\[neu\\]](https://example.org/a)').source).toBe('Koch [neu]');
    expect(parseRecipe('a.md', 'Text\r\nQuelle: <https://www.chefkoch.de/rezepte/1>\r\n').source).toBe('chefkoch.de');
    expect(parseRecipe('a.md', 'Text\nquelle:   Kochbuch „Backen“, Seite 12  ').source).toBe('Kochbuch „Backen“, Seite 12');
    expect(parseRecipe('a.md', `Text\nQuelle: ${'x'.repeat(80)}`).source).toHaveLength(40);
    for (const text of ['Text', 'Die Quelle: unbekannt', 'Quelle:\nText', '---\nsource: [a, b]\n---\nText']) expect(parseRecipe('a.md', text).source, text).toBeUndefined();
  });

  it('kommt mit Windows-Zeilenenden zurecht', () => {
    const recipe = parseRecipe('x.md', '---\r\ntitle: Brot\r\n---\r\n\r\nKneten.\r\n');
    expect(recipe).toMatchObject({ title: 'Brot', markdown: 'Kneten.' });
  });
});

describe('recipeId', () => {
  it('bildet aus Pfad und Namen eine Kennung ohne Sonderzeichen', () => {
    expect(recipeId('Kuchen/Omas Käsekuchen.md')).toBe('kuchen-omas-kaesekuchen');
    expect(recipeId('Crème brûlée.MD')).toBe('creme-brulee');
    expect(recipeId('Soßen\\Weiße Soße.md')).toBe('sossen-weisse-sosse');
  });
});

describe('inside', () => {
  const root = resolve('rezepte');

  it('lässt Dateien im Ordner und in Unterordnern zu', () => {
    expect(inside(root, 'kuchen', 'bild.jpg')).toBe(join(root, 'kuchen', 'bild.jpg'));
    expect(inside(root, 'kuchen', '../bild.jpg')).toBe(join(root, 'bild.jpg'));
  });

  it('weist alles ab, was aus dem Ordner hinausführt', () => {
    expect(inside(root, '../secrets.json')).toBeUndefined();
    expect(inside(root, 'kuchen', '../../secrets.json')).toBeUndefined();
    expect(inside(root, resolve('anderswo', 'datei.png'))).toBeUndefined();
    expect(inside(root, '.')).toBeUndefined();
  });
});
