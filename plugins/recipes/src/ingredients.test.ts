import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidInput, type ActionDefinition, type ActionHandler, type PluginContext, type RouteHandler } from '@culinola/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import plugin from './index.ts';
import { amountText, ingredientsOf, parseAmount, toShoppingItems, yieldOf } from './ingredients.ts';

const RECIPE = `---
title: Ofenkartoffeln
servings: 4 Portionen
---

Ein Blech voll.

## Zutaten

### Für das Blech

| Menge   | Zutat |
|---------|-------|
| 800 g   | mittelgroße, festkochende Kartoffeln |
| 4 EL    | Olivenöl |
| 2       | Zwiebeln (mittel) |
| ½ TL    | Salz |
|         | Thymian |

### Für den Dip

| Menge       | Zutat |
|-------------|-------|
| 1,5 Becher  | Schmand |
| 1–2         | Knoblauchzehen |
| ca. 1 TL    | Salz |
| 40 g + 10 g | Butter \\| Margarine |

## Zubereitung

1. Kartoffeln waschen.

| Menge | Zutat |
|-------|-------|
| 1     | Tabelle außerhalb der Zutaten |
`;

describe('Mengenangaben', () => {
  it('trennt Menge, Einheit und Zusatz', () => {
    expect(parseAmount('800 g')).toEqual({ quantity: '800', unit: 'g', note: null });
    expect(parseAmount('2')).toEqual({ quantity: '2', unit: null, note: null });
    expect(parseAmount('½ TL')).toEqual({ quantity: '0.5', unit: 'TL', note: null });
    expect(parseAmount('1 ½')).toEqual({ quantity: '1.5', unit: null, note: null });
    expect(parseAmount('1,5 Becher')).toEqual({ quantity: '1.5', unit: 'Becher', note: null });
    expect(parseAmount('¾–1 l')).toEqual({ quantity: '0.75-1', unit: 'l', note: null });
    expect(parseAmount('1.200 g')).toEqual({ quantity: '1200', unit: 'g', note: null });
    expect(parseAmount('ca. 800 g')).toEqual({ quantity: '800', unit: 'g', note: 'ca.' });
    expect(parseAmount('200 g (½ Dose)')).toEqual({ quantity: '200', unit: 'g', note: '½ Dose' });
    expect(parseAmount('evtl.')).toEqual({ quantity: null, unit: null, note: 'evtl.' });
    expect(parseAmount('')).toEqual({ quantity: null, unit: null, note: null });
    // Verwickeltes bleibt stehen, wie es dasteht
    expect(parseAmount('40 g + 10 g')).toEqual({ quantity: '40 g + 10 g', unit: null, note: null });
    expect(parseAmount('\\[8–10 g\\]')).toEqual({ quantity: '[8–10 g]', unit: null, note: null });
  });

  it('schreibt sie wieder so, wie man sie liest', () => {
    expect(amountText({ quantity: '0.5', unit: 'TL' })).toBe('½ TL');
    expect(amountText({ quantity: '1.5', unit: 'kg' })).toBe('1,5 kg');
    expect(amountText({ quantity: '1-2', unit: null })).toBe('1–2');
    expect(amountText({ quantity: null, unit: null })).toBe('');
    expect(amountText({ quantity: '40 g + 10 g', unit: null })).toBe('40 g + 10 g');
    expect(amountText({ quantity: '1.5', unit: 'cups' }, '.')).toBe('1.5 cups');
  });

  it('liest, wofür ein Rezept reicht', () => {
    expect(yieldOf('4 Portionen')).toEqual({ amount: 4, unit: 'Portionen', counted: true });
    expect(yieldOf('4')).toEqual({ amount: 4, unit: '', counted: true });
    expect(yieldOf('1 Blech')).toEqual({ amount: 1, unit: 'Blech', counted: true });
    expect(yieldOf('ca. 12 Stück')).toEqual({ amount: 12, unit: 'Stück', counted: true });
    expect(yieldOf('4–6 Portionen')).toEqual({ amount: 4, unit: 'Portionen', counted: true });
    expect(yieldOf('eine Springform')).toEqual({ amount: 1, unit: '', counted: false });
    expect(yieldOf(undefined)).toEqual({ amount: 1, unit: '', counted: false });
  });
});

describe('Zutaten eines Rezepts', () => {
  const groups = ingredientsOf(RECIPE);

  it('liest die Tabellen unter "Zutaten" samt ihrer Gliederung', () => {
    expect(groups.map((group) => [group.title, group.items.length])).toEqual([
      ['Für das Blech', 5],
      ['Für den Dip', 4],
    ]);
    expect(groups[0]!.items[2]).toEqual({ quantity: '2', unit: null, name: 'Zwiebeln', note: 'mittel' });
    expect(groups[0]!.items[4]).toEqual({ quantity: null, unit: null, name: 'Thymian', note: null });
    expect(groups[1]!.items[3]).toEqual({ quantity: '40 g + 10 g', unit: null, name: 'Butter | Margarine', note: null });
    expect(ingredientsOf('# Nur Text\n\nOhne Tabelle.')).toEqual([]);
    expect(ingredientsOf('## Ingredients\n\n| Amount | Ingredient |\n|---|---|\n| 2 cups | flour |')[0]).toEqual({ title: null, items: [{ quantity: '2', unit: 'cups', name: 'flour', note: null }] });
  });

  it('macht daraus Einträge für die Einkaufsliste und fasst Gleiches zusammen', () => {
    expect(toShoppingItems(groups).map((item) => [amountText(item), item.name])).toEqual([
      ['800 g', 'mittelgroße, festkochende Kartoffeln'],
      ['4 EL', 'Olivenöl'],
      ['2', 'Zwiebeln'],
      // ½ TL für das Blech und 1 TL für den Dip
      ['1,5 TL', 'Salz'],
      ['', 'Thymian'],
      ['1,5 Becher', 'Schmand'],
      ['1–2', 'Knoblauchzehen'],
      ['40 g + 10 g', 'Butter | Margarine'],
    ]);
    // Für sechs statt vier: alles mal anderthalb, nur das Verwickelte bleibt
    expect(toShoppingItems(groups, 1.5).map((item) => amountText(item))).toEqual(['1200 g', '6 EL', '3', '2,3 TL', '', '2,3 Becher', '1,5–3', '40 g + 10 g']);
  });
});

describe('Zutaten auf die Einkaufsliste', () => {
  let dir: string;
  const stop = new AbortController();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'culinola-zutaten-'));
  });
  afterAll(() => {
    stop.abort();
    rmSync(dir, { recursive: true, force: true });
  });

  function start(name: string, options: { lists?: boolean; config?: Record<string, unknown> } = {}) {
    const folder = join(dir, name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'ofenkartoffeln.md'), RECIPE);
    writeFileSync(join(folder, 'ohne.md'), '# Ohne Zutaten\n\nNur Text.');
    const routes = new Map<string, RouteHandler>();
    const actions = new Map<string, ActionHandler>();
    const added: Record<string, unknown>[] = [];
    const listsAdd: ActionDefinition = { name: 'lists.add', description: 'Setzt einen Eintrag auf die Liste.' };
    const context: PluginContext<ReturnType<NonNullable<typeof plugin.parseConfig>>> = {
      instanceId: 'recipes',
      config: plugin.parseConfig!(options.config ?? {}),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      secrets: { get: () => undefined },
      storageDir: folder,
      datapoints: { set: () => undefined, list: () => [], shown: () => [] },
      actions: {
        register: (definition, handler) => void actions.set(definition.name, handler),
        list: () => (options.lists === false ? [] : [listsAdd]),
        run: async (action, params) => {
          if (action !== 'lists.add') throw new Error(`unerwartet: ${action}`);
          if (params?.['list'] === 'Urlaub') throw new InvalidInput('Die Liste "Urlaub" wird nicht gezeigt.');
          if (params?.['text'] === 'Olivenöl') throw new Error('Merkio nicht erreichbar');
          added.push(params ?? {});
          return { added: params?.['text'] !== 'Thymian' };
        },
      },
      resources: { set: () => undefined },
      routes: { get: (path, handler) => void routes.set(`GET ${path}`, handler), post: (path, handler) => void routes.set(`POST ${path}`, handler) },
      onCommand: () => undefined,
      provideHistory: () => undefined,
      signal: stop.signal,
    };
    void plugin.start!(context);
    const call = async (key: string, id: string, extra: { query?: Record<string, string>; body?: unknown } = {}) => {
      const response = await routes.get(key)!({ params: { id }, query: extra.query ?? {}, body: extra.body, signal: stop.signal });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    return { call, added, run: (action: string, params: Record<string, string | number | boolean> = {}) => actions.get(action)!(params) };
  }

  it('zeigt, was auf die Liste käme – auch umgerechnet', async () => {
    const recipes = start('zeigen');
    const shown = await recipes.call('GET /shopping/:id', 'ofenkartoffeln');
    expect(shown.body).toMatchObject({ id: 'ofenkartoffeln', title: 'Ofenkartoffeln', ready: true, base: 4, amount: 4, unit: 'Portionen', counted: true });
    expect((shown.body['items'] as { name: string; amount: string }[]).slice(0, 3)).toMatchObject([
      { name: 'mittelgroße, festkochende Kartoffeln', amount: '800 g' },
      { name: 'Olivenöl', amount: '4 EL' },
      { name: 'Zwiebeln', amount: '2', note: 'mittel' },
    ]);
    const more = await recipes.call('GET /shopping/:id', 'ofenkartoffeln', { query: { amount: '6' } });
    expect([more.body['amount'], (more.body['items'] as { amount: string }[])[0]!.amount]).toEqual([6, '1200 g']);
    expect((await recipes.call('GET /shopping/:id', 'gibt-es-nicht')).status).toBe(404);
    expect((await start('ohne-liste', { lists: false }).call('GET /shopping/:id', 'ofenkartoffeln')).body['ready']).toBe(false);
  });

  it('setzt die gewählten Zutaten mit Menge und Einheit auf die Liste', async () => {
    const recipes = start('setzen');
    const result = await recipes.call('POST /shopping/:id', 'ofenkartoffeln', { body: { amount: 8, names: ['Zwiebeln', 'salz', 'Thymian', 'Olivenöl', 'Gibt es nicht'] } });
    // Thymian stand schon da, beim Öl war die Liste nicht erreichbar
    expect(result).toEqual({ status: 200, body: { recipe: 'Ofenkartoffeln', added: 2, known: 1, failed: ['Olivenöl'] } });
    expect(recipes.added).toEqual([{ text: 'Zwiebeln', quantity: '4' }, { text: 'Salz', quantity: '3', unit: 'TL' }, { text: 'Thymian' }]);
  });

  it('nimmt per Sprache alle Zutaten – vom genannten Rezept oder von dem, das gekocht wird', async () => {
    const recipes = start('sprache', { config: { shoppingList: 'Einkaufen' } });
    await expect(async () => recipes.run('recipes.shop')).rejects.toBeInstanceOf(InvalidInput);
    await recipes.run('recipes.cook', { recipe: 'ofenkartoffeln' });
    expect(await recipes.run('recipes.shop')).toMatchObject({ recipe: 'Ofenkartoffeln', added: 6, known: 1, failed: ['Olivenöl'] });
    expect(recipes.added[0]).toEqual({ text: 'mittelgroße, festkochende Kartoffeln', quantity: '800', unit: 'g', list: 'Einkaufen' });
    expect(await recipes.run('recipes.shop', { recipe: 'Ofenkart', amount: 2 })).toMatchObject({ added: 6 });
    expect(recipes.added.at(-7)).toMatchObject({ text: 'mittelgroße, festkochende Kartoffeln', quantity: '400' });
  });

  it('sagt, wenn es nichts zu setzen gibt', async () => {
    const recipes = start('nichts');
    expect(await recipes.call('POST /shopping/:id', 'ofenkartoffeln', { body: { names: [] } })).toEqual({ status: 400, body: { error: 'Es ist keine Zutat ausgewählt.' } });
    expect((await recipes.call('POST /shopping/:id', 'ohne')).body['error']).toMatch(/keine lesbaren Zutaten/);
    expect((await start('keine-liste', { lists: false }).call('POST /shopping/:id', 'ofenkartoffeln')).body['error']).toBe('Es ist keine Einkaufsliste eingerichtet.');
    // Eine Liste, die es nicht gibt, ist ein Fehler der Einrichtung – nicht acht gescheiterte Zutaten
    expect((await start('falsche-liste', { config: { shoppingList: 'Urlaub' } }).call('POST /shopping/:id', 'ofenkartoffeln')).body['error']).toMatch(/Urlaub/);
  });
});
