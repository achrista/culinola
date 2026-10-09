import { Document, isSeq } from 'yaml';
import type { Ingredient, Recipe } from './types.ts';

interface Words {
  ingredients: string;
  amount: string;
  ingredient: string;
  preparation: string;
  tips: string;
  source: string;
  decimal: string;
}

const WORDS: Record<string, Words> = {
  de: { ingredients: 'Zutaten', amount: 'Menge', ingredient: 'Zutat', preparation: 'Zubereitung', tips: 'Tipps', source: 'Quelle', decimal: ',' },
  en: { ingredients: 'Ingredients', amount: 'Amount', ingredient: 'Ingredient', preparation: 'Preparation', tips: 'Tips', source: 'Source', decimal: '.' },
  fr: { ingredients: 'Ingrédients', amount: 'Quantité', ingredient: 'Ingrédient', preparation: 'Préparation', tips: 'Conseils', source: 'Source', decimal: ',' },
};

const FRACTIONS: Record<string, string> = { '0.5': '½', '0.25': '¼', '0.75': '¾', '0.33': '⅓', '0.333': '⅓', '0.66': '⅔', '0.67': '⅔', '0.125': '⅛' };

/** Menge, wie man sie im Rezept liest: "0.5" wird "½", "1.5" wird "1,5", "1-2" wird "1–2". */
export function formatQuantity(quantity: string, decimal = ','): string {
  return quantity
    .split('-')
    .map((part) => FRACTIONS[part.trim()] ?? part.trim().replace('.', decimal))
    .join('–');
}

/** Nimmt Text die Wirkung als Markdown – Rezepte aus dem Netz sollen nichts einschleusen. */
function escape(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]<>|])/g, '\\$1');
}

function amount(ingredient: Ingredient, decimal: string): string {
  return [ingredient.quantity ? formatQuantity(ingredient.quantity, decimal) : '', ingredient.unit ?? ''].filter(Boolean).join(' ');
}

function table(items: Ingredient[], words: Words): string[] {
  const rows = items.map((item) => [escape(amount(item, words.decimal)), escape(item.note ? `${item.name} (${item.note})` : item.name)] as const);
  const width = Math.max(words.amount.length, ...rows.map(([left]) => left.length));
  return [`| ${words.amount.padEnd(width)} | ${words.ingredient} |`, `|${'-'.repeat(width + 2)}|${'-'.repeat(words.ingredient.length + 2)}|`, ...rows.map(([left, right]) => `| ${left.padEnd(width)} | ${right} |`)];
}

function frontMatter(recipe: Recipe): string {
  const data: Record<string, unknown> = { title: recipe.title };
  if (recipe.category) data['category'] = recipe.category;
  if (recipe.tags.length) data['tags'] = recipe.tags;
  if (recipe.time) data['time'] = recipe.time;
  if (recipe.servings) data['servings'] = /^\d+$/.test(recipe.servings) ? Number(recipe.servings) : recipe.servings;
  // Der Vermerk zur Herkunft steht in den Kopfdaten, damit ihn die Rezeptliste auch ohne Webadresse zeigen kann
  if (recipe.source.label) data['source'] = recipe.source.label;
  if (recipe.image) data['image'] = recipe.image;
  const document = new Document(data);
  const tags = document.get('tags', true);
  if (isSeq(tags)) tags.flow = true;
  return document.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/**
 * Schreibt ein Rezept so, wie Culinola es liest: Kopfdaten zwischen zwei Zeilen aus drei
 * Strichen, darunter gewöhnliches Markdown – Vorbild ist plugins/recipes/examples/pfannkuchen.md.
 */
export function renderMarkdown(recipe: Recipe, language = 'de'): string {
  const words = WORDS[language] ?? WORDS['de']!;
  const lines: string[] = ['---', frontMatter(recipe).trimEnd(), '---', ''];
  if (recipe.description) lines.push(escape(recipe.description), '');

  if (recipe.ingredients.length) {
    lines.push(`## ${words.ingredients}`, '');
    for (const group of recipe.ingredients) {
      if (group.title) lines.push(`### ${escape(group.title)}`, '');
      lines.push(...table(group.items, words), '');
    }
  }

  if (recipe.steps.length) {
    lines.push(`## ${words.preparation}`, '');
    for (const group of recipe.steps) {
      if (group.title) lines.push(`### ${escape(group.title)}`, '');
      lines.push(...group.steps.map((step, index) => `${index + 1}. ${escape(step)}`), '');
    }
  }

  if (recipe.notes.length) lines.push(`## ${words.tips}`, '', ...recipe.notes.map((note) => `- ${escape(note)}`), '');

  const { label, url } = recipe.source;
  if (url) lines.push(`${words.source}: [${escape(label ?? new URL(url).hostname.replace(/^www\./, ''))}](<${url.replace(/[<>\s]/g, '')}>)`, '');
  return lines.join('\n');
}
