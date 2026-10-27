/** Ein Eintrag, wie ihn Merkio liefert – nur die Felder, die Culinola braucht. */
export interface MerkioItem {
  id: number;
  listId: number;
  name: string;
  category?: string | null;
  quantity?: string | null;
  unit?: string | null;
  /** Je nach Datenbanktreiber `true`/`false` oder `1`/`0`. */
  checked?: boolean | number | null;
  checkedAt?: string | null;
  position?: number | null;
  /** Bei Rezepten der Rest des Rezepts als JSON; die Datei dazu liefert `GET /items/:id/export.md`. */
  content?: string | null;
  updatedAt?: string | null;
}

/** Eine Liste in Merkio samt der Gruppe, zu der sie gehört. */
export interface ListInfo {
  id: number;
  name: string;
  /** `shopping`, `todo`, `reminder`, `notes` oder `recipes`. */
  type: string;
  group: string;
}

/** Welche Liste gemeint ist: ihr Name, auf Wunsch mit Gruppe, oder ihre Nummer in Merkio. */
export interface Wanted {
  name?: string;
  group?: string;
  id?: number;
}

/** Ein Eintrag für die Anzeige. */
export interface Entry {
  id: number;
  name: string;
  /** Menge und Einheit in einem Stück, etwa "2 kg". */
  amount?: string;
  category?: string;
  checked: boolean;
  checkedAt?: string;
}

/** Kennung einer Liste aus ihrem Namen: "Einkauf Wochenende" wird "einkauf-wochenende". */
export function listKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return key || 'liste';
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Sucht die gewünschten Listen unter den vorhandenen. Ohne Wunsch gelten alle Einkaufslisten.
 * Was sich nicht finden lässt, kommt als Beschreibung zurück, damit der Kern es melden kann – ebenso
 * ein Name, den es in mehreren Gruppen gibt.
 */
export function chooseLists(available: ListInfo[], wanted: Wanted[] | undefined): { chosen: ListInfo[]; missing: string[]; ambiguous: string[] } {
  if (!wanted) return { chosen: available.filter((list) => list.type === 'shopping'), missing: [], ambiguous: [] };
  const chosen: ListInfo[] = [];
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const find = (wish: Wanted) => available.filter((list) => (wish.id !== undefined ? list.id === wish.id : wish.name !== undefined && same(list.name, wish.name)) && (wish.group === undefined || same(list.group, wish.group)));
  for (const given of wanted) {
    let wish = given;
    let hits = find(wish);
    // Im Textfeld der Oberfläche steht die Gruppe in Klammern dahinter: "Rezepte (Christas)"
    const bracket = !hits.length && wish.group === undefined && wish.name !== undefined ? /^(.+?)\s*\(([^()]+)\)$/.exec(wish.name.trim()) : null;
    if (bracket) {
      wish = { name: bracket[1]!, group: bracket[2]! };
      hits = find(wish);
    }
    const described = wish.id !== undefined ? `Nr. ${wish.id}` : `"${wish.name ?? ''}"${wish.group ? ` in "${wish.group}"` : ''}`;
    if (!hits.length) missing.push(described);
    else if (!chosen.includes(hits[0]!)) chosen.push(hits[0]!);
    // Gleichnamige Listen in mehreren Gruppen: Die erste gilt, bis die Gruppe dazugeschrieben wird
    if (hits.length > 1) ambiguous.push(`"${hits[0]!.name}" gibt es in ${hits.map((list) => `"${list.group}"`).join(' und ')}; es gilt die in "${hits[0]!.group}". Für eine andere die Gruppe in Klammern dazuschreiben, etwa "${hits[0]!.name} (${hits[1]!.group})".`);
  }
  return { chosen, missing, ambiguous };
}

/** Vergibt jeder Liste eine eindeutige Kennung; gleichnamige bekommen eine Nummer. */
export function keyed(lists: ListInfo[]): Map<string, ListInfo> {
  const result = new Map<string, ListInfo>();
  for (const list of lists) {
    let key = listKey(list.name);
    for (let count = 2; result.has(key); count++) key = `${listKey(list.name)}-${count}`;
    result.set(key, list);
  }
  return result;
}

function word(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function toEntry(item: MerkioItem): Entry {
  const amount = [word(item.quantity), word(item.unit)].filter(Boolean).join(' ');
  const category = word(item.category);
  const checked = !!item.checked;
  return { id: item.id, name: item.name, ...(amount ? { amount } : {}), ...(category ? { category } : {}), checked, ...(checked && item.checkedAt ? { checkedAt: item.checkedAt } : {}) };
}

/** Offene Einträge in der Reihenfolge der Liste, danach die erledigten – zuletzt abgehakte zuerst. */
export function toEntries(items: MerkioItem[]): Entry[] {
  const open = items.filter((item) => !item.checked).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
  const done = items.filter((item) => !!item.checked).sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? '') || b.id - a.id);
  return [...open, ...done].map(toEntry);
}

/**
 * Führt eine Meldung aus Merkios Echtzeitkanal in der Liste nach. Unbekannte Meldungen
 * ergeben `undefined` – dann liest der Aufrufer die Liste neu.
 */
export function applyEvent(items: MerkioItem[], event: string, data: unknown): MerkioItem[] | undefined {
  const item = data as Partial<MerkioItem> | null;
  if (!item || typeof item.id !== 'number') return undefined;
  if (event === 'item_deleted') return items.filter((known) => known.id !== item.id);
  if ((event === 'item_created' || event === 'item_updated') && typeof item.name === 'string') {
    const full = item as MerkioItem;
    return items.some((known) => known.id === full.id) ? items.map((known) => (known.id === full.id ? full : known)) : [...items, full];
  }
  return undefined;
}

/** Zerlegt den Datenstrom des Echtzeitkanals (Server-Sent Events) in einzelne Meldungen. */
export class EventParser {
  private rest = '';

  push(chunk: string): { event: string; data: string }[] {
    this.rest += chunk;
    const found: { event: string; data: string }[] = [];
    for (;;) {
      const end = /\r?\n\r?\n/.exec(this.rest);
      if (!end) break;
      const block = this.rest.slice(0, end.index);
      this.rest = this.rest.slice(end.index + end[0].length);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        // Zeilen mit Doppelpunkt am Anfang sind Lebenszeichen
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) found.push({ event, data: data.join('\n') });
    }
    return found;
  }
}

const UNITS = 'g|kg|mg|ml|cl|l|liter|stk|stück|st|pck|pkg|packung|packungen|päckchen|dose|dosen|flasche|flaschen|glas|gläser|becher|bund|beutel|tüte|tüten|kiste|kisten|kasten|netz|tafel|tafeln|scheiben|x';
const AMOUNT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(?:(${UNITS})\\b\\.?)?\\s+(\\S.*)$`, 'i');

/**
 * Trennt eine Eingabe wie "2 kg Mehl" oder "3 Zitronen" in Menge, Einheit und Namen.
 * Was nicht mit einer Zahl beginnt, bleibt als Name stehen.
 */
export function splitEntry(text: string): { name: string; quantity?: string; unit?: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  const match = AMOUNT.exec(clean);
  if (!match) return { name: clean };
  const unit = match[2]?.toLowerCase() === 'x' ? undefined : match[2];
  return { name: match[3]!, quantity: match[1]!, ...(unit ? { unit } : {}) };
}
