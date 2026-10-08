import type Anthropic from '@anthropic-ai/sdk';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { fileName, slug } from './cli.ts';
import { convertMaterial, convertRecipe, normalizeQuantity, type ConvertOptions } from './convert.ts';
import { formatQuantity, renderMarkdown } from './markdown.ts';
import { toShoppingItems } from './shopping.ts';
import type { Recipe, SourceMaterial } from './types.ts';

const item = (quantity: string | null, unit: string | null, name: string, note: string | null = null, iconKey = 'other') => ({ quantity, unit, name, note, iconKey });

const extracted = {
  title: ' Pfannkuchen ',
  description: 'Ein Grundrezept, das süß wie herzhaft geht.',
  category: 'Hauptgericht',
  tags: ['vegetarisch', 'Grundrezept', 'Vegetarisch'],
  time: '25 min',
  servings: '4',
  portions: 4,
  ingredients: [
    { title: null, items: [item('250', 'g', 'Mehl', null, 'bakery'), item('½', 'l', 'Milch', null, 'dairy'), item('3', null, 'Eier', 'Größe M', 'dairy'), item('1', 'Prise', 'Salz'), item(null, null, 'Butter', 'zum Backen', 'dairy'), item('1', 'g', '  ')] },
    { title: 'Füllung', items: [] },
  ],
  steps: [{ title: null, steps: ['1. Mehl und Salz mischen,\n   Milch einrühren.', 'Den Teig *15 Minuten* ruhen lassen.', ' '] }],
  notes: ['Dazu passt Apfelmus.'],
  sourceUrl: 'https://www.instagram.com/reel/ABC123',
  dishPhoto: 2,
};

interface Call {
  params: Anthropic.MessageCreateParamsNonStreaming;
}

function fake(recipes: unknown[], stopReason = 'end_turn'): { options: ConvertOptions; calls: Call[] } {
  const calls: Call[] = [];
  const messages = {
    parse: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      calls.push({ params });
      return { stop_reason: stopReason, parsed_output: stopReason === 'end_turn' ? { recipes } : null, usage: { input_tokens: 1200, output_tokens: 300 } };
    },
  };
  return { options: { client: { messages } as unknown as Pick<Anthropic, 'messages'> }, calls };
}

const photo = (name: string) => ({ name, mediaType: 'image/jpeg' as const, data: Uint8Array.from([0xff, 0xd8, 0xff]) });
const material = (extra: Partial<SourceMaterial> = {}): SourceMaterial => ({ name: 'Pfannkuchen.docx', text: 'Pfannkuchen …', images: [], warnings: [], ...extra });

describe('Umwandlung', () => {
  it('räumt die Antwort des Modells auf und schreibt Markdown wie im Culinola-Beispiel', async () => {
    const { options, calls } = fake([extracted]);
    const result = await convertMaterial(material({ images: [photo('a.jpg'), photo('b.jpg')] }), { ...options, label: 'Familienrezept' });

    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    const [converted] = result.recipes;
    expect(converted!.photo?.name).toBe('b.jpg');
    expect(converted!.recipe).toMatchObject({
      title: 'Pfannkuchen',
      tags: ['vegetarisch', 'Grundrezept', 'Familienrezept'],
      portions: 4,
      source: { label: 'Familienrezept', url: 'https://www.instagram.com/reel/ABC123', file: 'Pfannkuchen.docx' },
    });
    expect(converted!.recipe.ingredients).toHaveLength(1);
    expect(converted!.recipe.ingredients[0]!.items.map((entry) => entry.quantity)).toEqual(['250', '0.5', '3', '1', null]);
    expect(converted!.markdown).toBe(`---
title: Pfannkuchen
category: Hauptgericht
tags: [vegetarisch, Grundrezept, Familienrezept]
time: 25 min
servings: 4
---

Ein Grundrezept, das süß wie herzhaft geht.

## Zutaten

| Menge   | Zutat |
|---------|-------|
| 250 g   | Mehl |
| ½ l     | Milch |
| 3       | Eier (Größe M) |
| 1 Prise | Salz |
|         | Butter (zum Backen) |

## Zubereitung

1. Mehl und Salz mischen, Milch einrühren.
2. Den Teig \\*15 Minuten\\* ruhen lassen.

## Tipps

- Dazu passt Apfelmus.

Quelle: [Familienrezept](<https://www.instagram.com/reel/ABC123>)
`);

    const { params } = calls[0]!;
    expect(params.model).toBe('claude-haiku-5-5');
    expect(params.output_config?.format?.type).toBe('json_schema');
    const blocks = params.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(blocks.map((block) => block.type)).toEqual(['image', 'image', 'text']);
  });

  it('schickt ein PDF als Dokument vor dem Text', async () => {
    const { options, calls } = fake([]);
    const result = await convertRecipe({ data: Buffer.from('%PDF-1.4\n%%EOF'), name: 'Scan.pdf' }, options);
    expect(result.recipes).toEqual([]);
    const blocks = calls[0]!.params.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(blocks[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') } });
  });

  it('lässt leere Vorlagen weg und nimmt nur gültige Webadressen als Quelle', async () => {
    const { options } = fake([
      { ...extracted, title: 'Leere Vorlage', ingredients: [], steps: [{ title: null, steps: [''] }] },
      { ...extracted, sourceUrl: 'javascript:alert(1)', dishPhoto: 7, portions: 0 },
    ]);
    const result = await convertMaterial(material({ url: 'https://example.org/pfannkuchen', imageUrl: 'https://example.org/bild.jpg' }), options);
    expect(result.recipes).toHaveLength(1);
    const { recipe, photo: found } = result.recipes[0]!;
    expect(found).toBeUndefined();
    expect(recipe.portions).toBeNull();
    expect(recipe.source).toEqual({ url: 'https://example.org/pfannkuchen' });
    expect(recipe.image).toBe('https://example.org/bild.jpg');
  });

  it('meldet Ablehnung und abgeschnittene Antworten als Fehler', async () => {
    await expect(convertMaterial(material(), fake([], 'refusal').options)).rejects.toThrow(/abgelehnt/);
    await expect(convertMaterial(material(), fake([], 'max_tokens').options)).rejects.toThrow(/abgeschnitten/);
  });

  it('vereinheitlicht Mengen', () => {
    expect(['1,5', '½', '1½', '1 1/2', '3/4', '1 – 2', '2 bis 3', ' 250 ', '', null].map(normalizeQuantity)).toEqual(['1.5', '0.5', '1.5', '1.5', '0.75', '1-2', '2-3', '250', null, null]);
    expect(['0.5', '1.5', '1-2', '0.25-0.5', '250'].map((quantity) => formatQuantity(quantity))).toEqual(['½', '1,5', '1–2', '¼–½', '250']);
  });
});

const recipe: Recipe = {
  title: 'Kässpätzle: "die besten"',
  description: null,
  category: null,
  tags: [],
  time: null,
  servings: '1 Blech',
  portions: 2,
  ingredients: [
    { title: 'Teig', items: [item('250', 'g', 'Mehl', null, 'bakery'), item('3', null, 'Eier', null, 'dairy'), item('1-2', 'EL', 'Öl')] as Recipe['ingredients'][number]['items'] },
    { title: 'Belag', items: [item('250', 'g', 'Bergkäse | gerieben', null, 'dairy'), item('1', 'TL', 'Öl'), item('50', 'g', 'mehl', null, 'bakery')] as Recipe['ingredients'][number]['items'] },
  ],
  steps: [
    { title: 'Teig', steps: ['Alles verrühren.'] },
    { title: 'Fertigstellen', steps: ['Schichten.', 'Überbacken.'] },
  ],
  notes: [],
  source: { url: 'https://www.example.org/a b' },
  image: 'Kässpätzle.jpg',
};

describe('Ausgabe', () => {
  it('schreibt Kopfdaten, die sich wieder lesen lassen, und gliedert nach Abschnitten', () => {
    const markdown = renderMarkdown(recipe);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
    expect(parseYaml(front![1]!)).toEqual({ title: 'Kässpätzle: "die besten"', servings: '1 Blech', image: 'Kässpätzle.jpg' });
    expect(markdown).toContain('### Teig\n\n| Menge  | Zutat |');
    expect(markdown).toContain('| 250 g | Bergkäse \\| gerieben |');
    expect(markdown).toContain('### Fertigstellen\n\n1. Schichten.\n2. Überbacken.');
    expect(markdown).toContain('Quelle: [example.org](<https://www.example.org/ab>)');
  });

  it('rechnet Zutaten für die Einkaufsliste um und fasst gleiche zusammen', () => {
    expect(toShoppingItems(recipe)).toEqual([
      { name: 'Mehl', quantity: '300', unit: 'g', iconKey: 'bakery' },
      { name: 'Eier', quantity: '3', unit: null, iconKey: 'dairy' },
      { name: 'Öl', quantity: '1-2', unit: 'EL', iconKey: 'other' },
      { name: 'Bergkäse | gerieben', quantity: '250', unit: 'g', iconKey: 'dairy' },
    ]);
    expect(toShoppingItems(recipe, 4).map((entry) => entry.quantity)).toEqual(['600', '6', '2-4', '500']);
    expect(toShoppingItems({ ...recipe, portions: null }, 4)[0]!.quantity).toBe('300');
  });

  it('bildet Dateinamen und Kennungen aus Titeln', () => {
    expect(fileName('Kässpätzle: "die besten"?')).toBe('Kässpätzle die besten');
    expect(fileName(' ... ')).toBe('Rezept');
    expect(slug('Omas Käsekuchen (26 cm)')).toBe('omas-kaesekuchen-26-cm');
  });
});
