import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface RecipeInfo {
  title: string;
  category?: string;
  tags: string[];
  /** Zubereitungszeit, so wie sie im Rezept steht, etwa "45 min". */
  time?: string;
  /** Portionen, so wie sie im Rezept stehen, etwa "4" oder "1 Blech". */
  servings?: string;
}

export interface Recipe extends RecipeInfo {
  /** Der Rezepttext ohne Kopfdaten und ohne die Überschrift, die schon als Titel dient. */
  markdown: string;
  /** Hinweis, wenn sich die Kopfdaten nicht lesen ließen. */
  problem?: string;
}

const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FIRST_HEADING = /^\s*#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/;

/** Angaben aus den Kopfdaten; deutsche Feldnamen gelten genauso wie englische. */
function field(data: Record<string, unknown>, ...names: string[]): unknown {
  const wanted = new Set(names);
  for (const [key, value] of Object.entries(data)) {
    if (wanted.has(key.toLowerCase()) && value !== null && value !== '') return value;
  }
  return undefined;
}

function word(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() || undefined : undefined;
}

function words(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list.map(word).filter((entry): entry is string => !!entry);
}

/**
 * Liest ein Rezept. Kopfdaten zwischen zwei Zeilen aus `---` sind freiwillig; fehlt
 * der Titel dort, gilt die erste Überschrift, und fehlt auch die, der Dateiname.
 */
export function parseRecipe(fileName: string, text: string): Recipe {
  let data: Record<string, unknown> = {};
  let problem: string | undefined;
  let markdown = text.replace(/^﻿/, '');

  const front = FRONT_MATTER.exec(text);
  if (front) {
    markdown = text.slice(front[0].length);
    try {
      const parsed: unknown = parseYaml(front[1]!);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch (error) {
      problem = `Kopfdaten nicht lesbar: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
    }
  }

  let title = word(field(data, 'title', 'titel'));
  const heading = FIRST_HEADING.exec(markdown);
  if (heading && (!title || heading[1] === title)) {
    title ??= heading[1]!;
    markdown = markdown.slice(heading[0].length);
  }
  title ??= basename(fileName, extname(fileName)).replace(/[-_]+/g, ' ');

  const category = word(field(data, 'category', 'kategorie'));
  const time = word(field(data, 'time', 'zeit', 'dauer'));
  const servings = word(field(data, 'servings', 'portionen'));
  return {
    title,
    ...(category ? { category } : {}),
    tags: words(field(data, 'tags', 'stichworte')),
    ...(time ? { time } : {}),
    ...(servings ? { servings } : {}),
    markdown: markdown.trim(),
    ...(problem ? { problem } : {}),
  };
}

/** Kennung eines Rezepts aus seinem Pfad im Rezeptordner: "Kuchen/Omas Käsekuchen.md" wird "kuchen-omas-kaesekuchen". */
export function recipeId(relativePath: string): string {
  return relativePath
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Der volle Pfad einer Datei unterhalb eines Ordners – oder nichts, wenn die Angabe aus dem Ordner hinausführt. */
export function inside(root: string, ...parts: string[]): string | undefined {
  const target = resolve(root, ...parts);
  const way = relative(resolve(root), target);
  return way && !way.startsWith('..') && !isAbsolute(way) ? target : undefined;
}
