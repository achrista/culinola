import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MerkioItem } from './merkio.ts';
import { mirrorRecipes, withImage, type FetchFile } from './recipes.ts';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'culinola-merkio-rezepte-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const recipe = (id: number, name: string, extra: { photoRev?: number; text?: string } = {}): MerkioItem => ({
  id,
  listId: 14,
  name,
  category: 'cakes',
  content: JSON.stringify({ steps: [extra.text ?? 'Backen'], ...(extra.photoRev ? { image: `${name}.jpg`, photoRev: extra.photoRev } : {}) }),
  updatedAt: '2026-10-27T10:00:00.000Z',
});

/** Spielt Merkio: Die Datei trägt Titel und Inhalt des Eintrags, das Foto nennt seinen Stand. */
function merkio(items: () => MerkioItem[]) {
  const calls: string[] = [];
  const fetchFile: FetchFile = async (path) => {
    calls.push(path);
    const item = items().find((known) => path.startsWith(`/items/${known.id}/`));
    if (!item) throw new Error(`Nicht gefunden: ${path}`);
    if (path.endsWith('/photo')) return { data: new TextEncoder().encode(`foto ${JSON.parse(item.content!).photoRev}`), type: 'image/jpeg' };
    return { data: new TextEncoder().encode(`---\ntitle: ${item.name}\ncategory: Kuchen\nimage: ${item.name}.jpg\n---\n\n${JSON.parse(item.content!).steps[0]}\n`), type: 'text/markdown' };
  };
  return { calls, fetchFile };
}

const visible = (folder: string) => readdirSync(folder).filter((name) => !name.startsWith('.')).sort();

describe('Rezepte aus Merkio in den Ordner', () => {
  it('legt jedes Rezept mit seinem Foto ab und holt nur, was sich geändert hat', async () => {
    const folder = join(dir, 'abgleich');
    let items = [recipe(1, 'Apfelkuchen', { photoRev: 1 }), recipe(2, 'Rührei')];
    const remote = merkio(() => items);

    expect(await mirrorRecipes(folder, 14, items, remote.fetchFile)).toEqual({ written: ['Apfelkuchen', 'Rührei'], removed: [], failed: [], photoless: [] });
    expect(visible(folder)).toEqual(['Apfelkuchen.jpg', 'Apfelkuchen.md', 'Rührei.md']);
    expect(readFileSync(join(folder, 'Apfelkuchen.md'), 'utf8')).toMatch(/^image: "Apfelkuchen\.jpg"$/m);
    // Ohne Foto steht auch keines in den Kopfdaten
    expect(readFileSync(join(folder, 'Rührei.md'), 'utf8')).not.toMatch(/^image:/m);

    remote.calls.length = 0;
    expect(await mirrorRecipes(folder, 14, items, remote.fetchFile)).toEqual({ written: [], removed: [], failed: [], photoless: [] });
    expect(remote.calls).toEqual([]);

    // Neuer Text, gleiches Foto: nur die Datei kommt neu
    items = [recipe(1, 'Apfelkuchen', { photoRev: 1, text: 'Länger backen' }), recipe(2, 'Rührei')];
    await mirrorRecipes(folder, 14, items, remote.fetchFile);
    expect(remote.calls).toEqual(['/items/1/export.md']);
    expect(readFileSync(join(folder, 'Apfelkuchen.md'), 'utf8')).toContain('Länger backen');

    // Neues Foto
    remote.calls.length = 0;
    items = [recipe(1, 'Apfelkuchen', { photoRev: 2, text: 'Länger backen' }), recipe(2, 'Rührei')];
    await mirrorRecipes(folder, 14, items, remote.fetchFile);
    expect(remote.calls).toEqual(['/items/1/photo', '/items/1/export.md']);
    expect(readFileSync(join(folder, 'Apfelkuchen.jpg'), 'utf8')).toBe('foto 2');
  });

  it('benennt mit, räumt Gelöschtes weg und unterscheidet gleichnamige Rezepte', async () => {
    const folder = join(dir, 'namen');
    let items = [recipe(1, 'Apfelkuchen', { photoRev: 1 }), recipe(2, 'Rührei'), recipe(3, 'Rührei')];
    const remote = merkio(() => items);
    await mirrorRecipes(folder, 14, items, remote.fetchFile);
    expect(visible(folder)).toEqual(['Apfelkuchen.jpg', 'Apfelkuchen.md', 'Rührei (2).md', 'Rührei.md']);

    items = [recipe(1, 'Omas Apfelkuchen', { photoRev: 1 }), recipe(3, 'Rührei')];
    expect(await mirrorRecipes(folder, 14, items, remote.fetchFile)).toMatchObject({ written: ['Omas Apfelkuchen'], removed: ['Rührei'] });
    // Das zweite Rührei behält seinen Namen – seine Kennung in Culinola bleibt dieselbe
    expect(visible(folder)).toEqual(['Omas Apfelkuchen.jpg', 'Omas Apfelkuchen.md', 'Rührei (2).md']);
    expect(readFileSync(join(folder, 'Omas Apfelkuchen.md'), 'utf8')).toMatch(/^image: "Omas Apfelkuchen\.jpg"$/m);
  });

  it('lässt den letzten Stand liegen, wenn ein Rezept gerade nicht zu holen ist', async () => {
    const folder = join(dir, 'stoerung');
    const items = [recipe(1, 'Apfelkuchen'), recipe(2, 'Rührei')];
    const remote = merkio(() => items);
    await mirrorRecipes(folder, 14, items, remote.fetchFile);

    const changed = [recipe(1, 'Apfelkuchen', { text: 'Neu' }), recipe(2, 'Rührei', { text: 'Neu' })];
    const broken: FetchFile = (path) => (path.startsWith('/items/1/') ? Promise.reject(new Error('Merkio: Fehler 500')) : merkio(() => changed).fetchFile(path));
    const result = await mirrorRecipes(folder, 14, changed, broken);
    expect(result).toEqual({ written: ['Rührei'], removed: [], failed: ['Apfelkuchen: Merkio: Fehler 500'], photoless: [] });
    expect(readFileSync(join(folder, 'Apfelkuchen.md'), 'utf8')).toContain('Backen');

    // Beim nächsten Abruf kommt es nach
    expect((await mirrorRecipes(folder, 14, changed, merkio(() => changed).fetchFile)).written).toEqual(['Apfelkuchen']);
  });

  it('übernimmt ein Rezept auch, wenn sein Foto fehlt, und holt das Foto später nach', async () => {
    const folder = join(dir, 'ohne-foto');
    const items = [recipe(1, 'Apfelkuchen', { photoRev: 1 })];
    const remote = merkio(() => items);
    const noPhoto: FetchFile = (path) => (path.endsWith('/photo') ? Promise.reject(new Error('Merkio: Kein Foto vorhanden (GET /items/1/photo)')) : remote.fetchFile(path));
    expect(await mirrorRecipes(folder, 14, items, noPhoto)).toEqual({ written: ['Apfelkuchen'], removed: [], failed: [], photoless: ['Apfelkuchen: Merkio: Kein Foto vorhanden (GET /items/1/photo)'] });
    expect(visible(folder)).toEqual(['Apfelkuchen.md']);
    // Ohne Foto auch keine Angabe dazu – das Rezept steht in der Liste, nur die wechselnde Kachel übergeht es
    expect(readFileSync(join(folder, 'Apfelkuchen.md'), 'utf8')).not.toMatch(/^image:/m);

    expect(await mirrorRecipes(folder, 14, items, remote.fetchFile)).toMatchObject({ written: ['Apfelkuchen'], photoless: [] });
    expect(visible(folder)).toEqual(['Apfelkuchen.jpg', 'Apfelkuchen.md']);
    expect((await mirrorRecipes(folder, 14, items, remote.fetchFile)).written).toEqual([]);
  });

  it('ersetzt den ganzen Bestand, wenn eine andere Liste gewählt wird', async () => {
    const folder = join(dir, 'andere-liste');
    const first = [recipe(1, 'Apfelkuchen', { photoRev: 1 })];
    await mirrorRecipes(folder, 14, first, merkio(() => first).fetchFile);
    const second = [{ ...recipe(7, 'Linsensuppe'), listId: 15 }];
    await mirrorRecipes(folder, 15, second, merkio(() => second).fetchFile);
    expect(visible(folder)).toEqual(['Linsensuppe.md']);
    expect(existsSync(join(folder, '.merkio.json'))).toBe(true);
  });
});

describe('Foto in den Kopfdaten', () => {
  it('setzt, ersetzt oder entfernt die Angabe', () => {
    expect(withImage('---\ntitle: A\nimage: alt.jpg\n---\n\nText', 'neu.jpg')).toBe('---\ntitle: A\nimage: "neu.jpg"\n---\n\nText');
    expect(withImage('---\ntitle: A\nimage: alt.jpg\n---\n\nText', undefined)).toBe('---\ntitle: A\n---\n\nText');
    expect(withImage('Text', 'neu.jpg')).toBe('---\nimage: "neu.jpg"\n---\n\nText');
    expect(withImage('Text', undefined)).toBe('Text');
  });
});
