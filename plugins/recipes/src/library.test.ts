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
