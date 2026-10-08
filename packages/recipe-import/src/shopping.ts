import type { Recipe, ShoppingIconKey } from './types.ts';

/** Ein Eintrag, wie ihn Merkio unter POST /lists/:id/items annimmt. */
export interface ShoppingItem {
  name: string;
  quantity: string | null;
  unit: string | null;
  iconKey: ShoppingIconKey;
}

/** Ganze Zahlen ab 10, darunter eine Nachkommastelle – so rundet auch Merkios Rezept-Import. */
function round(value: number): string {
  return String(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
}

function scale(quantity: string, factor: number): string {
  if (factor === 1) return quantity;
  const parts = quantity.split('-').map((part) => Number(part));
  return parts.some((part) => !Number.isFinite(part)) ? quantity : parts.map((part) => round(part * factor)).join('-');
}

/**
 * Die Zutaten eines Rezepts als Einträge für die Merkio-Einkaufsliste, auf Wunsch umgerechnet
 * auf eine andere Portionenzahl. Gleiche Zutaten aus mehreren Abschnitten werden zusammengefasst.
 */
export function toShoppingItems(recipe: Recipe, portions?: number): ShoppingItem[] {
  const factor = portions && recipe.portions ? portions / recipe.portions : 1;
  const byName = new Map<string, ShoppingItem>();
  for (const ingredient of recipe.ingredients.flatMap((group) => group.items)) {
    // Auf die Spaltenbreiten von list_items gekürzt: name 255, quantity 50, unit 20
    const item: ShoppingItem = {
      name: ingredient.name.slice(0, 255),
      quantity: ingredient.quantity ? scale(ingredient.quantity, factor).slice(0, 50) : null,
      unit: ingredient.unit ? ingredient.unit.slice(0, 20) : null,
      iconKey: ingredient.iconKey,
    };
    const known = byName.get(item.name.toLowerCase());
    if (!known) {
      byName.set(item.name.toLowerCase(), item);
      continue;
    }
    const sum = Number(known.quantity) + Number(item.quantity);
    const sameUnit = (known.unit ?? '').toLowerCase() === (item.unit ?? '').toLowerCase();
    if (sameUnit && known.quantity && item.quantity && Number.isFinite(sum)) known.quantity = String(Math.round(sum * 100) / 100);
  }
  return [...byName.values()];
}
