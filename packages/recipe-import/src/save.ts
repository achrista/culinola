import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConvertedRecipe } from './convert.ts';
import { renderMarkdown } from './markdown.ts';

const PHOTO_ENDINGS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

/** Dateiendung für ein Foto der angegebenen Art. */
export function photoEnding(mediaType: string): string {
  return PHOTO_ENDINGS[mediaType] ?? '.jpg';
}

/** Dateiname aus einem Titel: Umlaute bleiben, was Dateisysteme nicht mögen, fällt weg. */
export function fileName(title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return name || 'Rezept';
}

export interface SavedRecipe {
  title: string;
  /** Pfad der Rezeptdatei, relativ zum Rezeptordner, mit Schrägstrichen. */
  file: string;
  /** Pfad des Fotos, wenn die Vorlage eines hergab. */
  photo?: string;
}

/**
 * Legt ein umgewandeltes Rezept in einen Rezeptordner von Culinola: als
 * `<Kategorie>/<Titel>.md`, das Foto des Gerichts daneben. Vorhandene Dateien bleiben
 * unberührt – ein zweites Rezept gleichen Namens bekommt eine Nummer.
 */
export function saveRecipe(folder: string, converted: ConvertedRecipe, language = 'de'): SavedRecipe {
  const { photo } = converted;
  const category = fileName(converted.recipe.category ?? 'Sonstiges');
  const directory = join(folder, category);
  mkdirSync(directory, { recursive: true });

  const ending = photo ? photoEnding(photo.mediaType) : '';
  const base = fileName(converted.recipe.title);
  let name = base;
  // Rezept und Foto tragen denselben Namen; frei ist er erst, wenn es beide noch nicht gibt
  for (let count = 2; existsSync(join(directory, `${name}.md`)) || (photo && existsSync(join(directory, name + ending))); count++) name = `${base} (${count})`;

  // Ein Foto aus der Vorlage liegt neben dem Rezept; eine Webadresse bleibt nur stehen, wenn sich das Bild nicht holen ließ
  const recipe = photo ? { ...converted.recipe, image: name + ending } : converted.recipe;
  if (photo) writeFileSync(join(directory, name + ending), photo.data);
  writeFileSync(join(directory, `${name}.md`), renderMarkdown(recipe, language));
  return { title: recipe.title, file: `${category}/${name}.md`, ...(photo ? { photo: `${category}/${name}${ending}` } : {}) };
}
