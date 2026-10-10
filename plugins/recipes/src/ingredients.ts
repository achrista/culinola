/** Eine Zutat, wie sie in der Zutatentabelle eines Rezepts steht. */
export interface Ingredient {
  /** Menge als Zahl mit Punkt ("250", "0.5") oder Spanne ("1-2"); was sich nicht als Zahl lesen lässt, bleibt als Text stehen. */
  quantity: string | null;
  unit: string | null;
  name: string;
  /** Zusatz zur Zutat, etwa "mittel" oder "ca.". */
  note: string | null;
}

export interface IngredientGroup {
  /** Überschrift eines Abschnitts wie "Für den Teig"; null, wenn das Rezept die Zutaten nicht gliedert. */
  title: string | null;
  items: Ingredient[];
}

/** Ein Eintrag für die Einkaufsliste. */
export interface ShoppingItem {
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 0.33,
  '⅔': 0.67,
  '⅛': 0.125,
};
const SHOWN_FRACTIONS: Record<string, string> = {
  '0.5': '½',
  '0.25': '¼',
  '0.75': '¾',
  '0.33': '⅓',
  '0.67': '⅔',
  '0.125': '⅛',
};
const NUMBER = '(?:\\d+(?:[.,]\\d+)?(?:\\s*[½¼¾⅓⅔⅛])?|[½¼¾⅓⅔⅛])';
// Zahl oder Bruch, auch als Spanne ("¾–1"), dahinter höchstens eine kurze Einheit
const SIMPLE_AMOUNT = new RegExp(`^(${NUMBER})(?:\\s*[–-]\\s*(${NUMBER}))?(?:\\s+([^\\d()+]{1,20}))?$`);
const AMOUNT_PREFIX = /^(ca\.|circa|etwa|evtl\.|ggf\.|max\.|mind\.)\s+/i;

/** Nimmt Text die Maskierung, mit der Rezepte geschrieben werden ("\\[8–10 g\\]"). */
function plain(text: string): string {
  return text
    .replace(/\\([\\`*_[\]<>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1,5" wird "1.5", "½" wird "0.5", "1 ½" wird "1.5". */
function number(text: string): string {
  const fraction = /[½¼¾⅓⅔⅛]/.exec(text)?.[0];
  const whole = text
    .replace(/[½¼¾⅓⅔⅛]/, '')
    .trim()
    .replace(',', '.');
  if (!fraction) return whole;
  return String(Math.round(((whole ? Number(whole) : 0) + FRACTIONS[fraction]!) * 1000) / 1000);
}

function simpleAmount(text: string): { quantity: string; unit: string | null } | undefined {
  // "1.200 g": Der Punkt ist hier der Tausenderpunkt – Dezimalzahlen stehen im Rezept mit Komma
  const simple = SIMPLE_AMOUNT.exec(text.replace(/^(\d{1,3})\.(\d{3})(?=\s|$)/, '$1$2'));
  if (!simple) return undefined;
  return {
    quantity: simple[2] ? `${number(simple[1]!)}-${number(simple[2])}` : number(simple[1]!),
    unit: simple[3]?.trim() || null,
  };
}

/**
 * Liest die Mengenangabe einer Zutat. "250 g" wird Menge und Einheit – nur damit lässt sich auf eine andere
 * Menge umrechnen. Ein Vorwort ("ca. 800 g") und eine Angabe in Klammern ("200 g (½ Dose)") wandern in den
 * Zusatz. Verwickelteres ("40 g + 10 g") bleibt unverändert als Text stehen.
 */
export function parseAmount(cell: string): Pick<Ingredient, 'quantity' | 'unit' | 'note'> {
  const text = plain(cell);
  if (!text) return { quantity: null, unit: null, note: null };
  // Nur ein Vorwort ("evtl."): keine Menge, der Hinweis bleibt als Zusatz
  if (AMOUNT_PREFIX.test(`${text} `) && !text.includes(' ')) return { quantity: null, unit: null, note: text };
  const prefix = AMOUNT_PREFIX.exec(text);
  const rest = prefix ? text.slice(prefix[0].length) : text;
  const bracket = /^(.+?)\s*\(([^()]+)\)$/.exec(rest);
  const direct = simpleAmount(rest);
  const before = !direct && bracket ? simpleAmount(bracket[1]!) : undefined;
  const found = direct ?? before;
  if (!found) return { quantity: text.slice(0, 50), unit: null, note: null };
  return {
    ...found,
    note: [prefix?.[1], before ? bracket![2] : undefined].filter(Boolean).join(', ') || null,
  };
}

/**
 * Liest die Zutaten aus dem Text eines Rezepts: die Tabellen unter der Überschrift "Zutaten", gegliedert nach
 * den Zwischenüberschriften darunter. Rezepte ohne solche Tabelle haben keine lesbaren Zutaten.
 */
export function ingredientsOf(markdown: string): IngredientGroup[] {
  const groups: IngredientGroup[] = [];
  let inside = false;
  let group: IngredientGroup | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading && heading[1]!.length <= 2) {
      inside = /zutat|ingredi/i.test(heading[2]!);
      group = undefined;
      continue;
    }
    if (!inside) continue;
    if (heading) {
      group = { title: plain(heading[2]!), items: [] };
      groups.push(group);
      continue;
    }
    if (!line.startsWith('|')) continue;
    // Zellen an unmaskierten Strichen trennen
    const cells = line
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim());
    if (cells.length < 2 || /^:?-+:?$/.test(cells[0]!.replace(/\s/g, '')) || /^(menge|amount|quantité)$/i.test(cells[0]!)) continue;
    const text = plain(cells.slice(1).join(' | '));
    if (!text) continue;
    // Ein Zusatz in Klammern am Ende gehört nicht zum Namen: "Zwiebeln (mittel)"
    const noted = /^(.+?)\s*\(([^()]+)\)$/.exec(text);
    const amount = parseAmount(cells[0]!);
    const note = [amount.note, noted?.[2]].filter(Boolean).join(', ') || null;
    if (!group) {
      group = { title: null, items: [] };
      groups.push(group);
    }
    group.items.push({
      quantity: amount.quantity,
      unit: amount.unit,
      name: noted ? noted[1]! : text,
      note,
    });
  }
  return groups.filter((entry) => entry.items.length);
}

/**
 * Wofür die Mengen eines Rezepts gelten: "4 Portionen" ergibt 4 und "Portionen", "1 Blech" ergibt 1 und "Blech".
 * Eine bloße Zahl meint Portionen (`counted`, ohne Einheit). Ohne Zahl am Anfang gilt das einfache Rezept.
 */
export function yieldOf(servings: string | undefined): { amount: number; unit: string; counted: boolean } {
  const match = /^\s*(?:ca\.?\s*|etwa\s+)?(\d+(?:[.,]\d+)?)(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(.*)$/i.exec(servings ?? '');
  const amount = match ? Number(match[1]!.replace(',', '.')) : 0;
  return amount > 0 && amount <= 1000 ? { amount, unit: match![2]!.trim(), counted: true } : { amount: 1, unit: '', counted: false };
}

/** Ganze Zahlen ab 10, darunter eine Nachkommastelle – so rundet auch Merkio. */
function round(value: number): string {
  return String(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
}

function scale(quantity: string, factor: number): string {
  if (factor === 1) return quantity;
  const parts = quantity.split('-').map(Number);
  return parts.some((part) => !Number.isFinite(part)) ? quantity : parts.map((part) => round(part * factor)).join('-');
}

/**
 * Die Zutaten als Einträge für die Einkaufsliste, umgerechnet mit `factor`. Gleiche Zutaten aus mehreren
 * Abschnitten werden zusammengefasst – ihre Mengen addiert, wenn die Einheit dieselbe ist.
 */
export function toShoppingItems(groups: IngredientGroup[], factor = 1): ShoppingItem[] {
  const byName = new Map<string, ShoppingItem>();
  for (const ingredient of groups.flatMap((group) => group.items)) {
    // Auf die Breiten gekürzt, die Merkio für einen Eintrag vorsieht: Name 255, Menge 50, Einheit 20
    const item: ShoppingItem = {
      name: ingredient.name.slice(0, 255),
      quantity: ingredient.quantity ? scale(ingredient.quantity, factor).slice(0, 50) : null,
      unit: ingredient.unit ? ingredient.unit.slice(0, 20) : null,
      note: ingredient.note,
    };
    const key = item.name.toLowerCase();
    const known = byName.get(key);
    if (!known) {
      byName.set(key, item);
      continue;
    }
    const sum = Number(known.quantity) + Number(item.quantity);
    const sameUnit = (known.unit ?? '').toLowerCase() === (item.unit ?? '').toLowerCase();
    if (sameUnit && known.quantity && item.quantity && Number.isFinite(sum)) known.quantity = String(Math.round(sum * 100) / 100);
  }
  return [...byName.values()];
}

/** Menge und Einheit, wie man sie liest: "0.5 TL" wird "½ TL", "1.5 kg" wird "1,5 kg", "1-2" wird "1–2". */
export function amountText(item: Pick<ShoppingItem, 'quantity' | 'unit'>, decimal = ','): string {
  const quantity = (item.quantity ?? '')
    .split('-')
    .map((part) => SHOWN_FRACTIONS[part.trim()] ?? (/^[\d.]+$/.test(part.trim()) ? part.trim().replace('.', decimal) : part.trim()))
    .join('–');
  return [quantity, item.unit ?? ''].filter(Boolean).join(' ');
}
