import { describe, expect, it } from 'vitest';
import { applyEvent, chooseLists, EventParser, keyed, listKey, splitEntry, toEntries, type ListInfo, type MerkioItem } from './merkio.ts';

const lists: ListInfo[] = [
  { id: 11, name: 'Einkauf', type: 'shopping', group: 'Familie' },
  { id: 12, name: 'Aufgaben', type: 'todo', group: 'Familie' },
  { id: 13, name: 'Baumarkt', type: 'shopping', group: 'Familie' },
  { id: 21, name: 'Einkauf', type: 'shopping', group: 'Verein' },
];
const item = (id: number, name: string, extra: Partial<MerkioItem> = {}): MerkioItem => ({ id, listId: 11, name, ...extra });

describe('Wahl der Listen', () => {
  it('nimmt ohne Angabe alle Einkaufslisten', () => {
    expect(chooseLists(lists, undefined).chosen.map((list) => list.id)).toEqual([11, 13, 21]);
  });

  it('findet Listen nach Name, Gruppe oder Nummer und meldet, was fehlt', () => {
    const { chosen, missing } = chooseLists(lists, [{ name: ' einkauf ', group: 'verein' }, { name: 'AUFGABEN' }, { id: 13 }, { name: 'Urlaub' }, { name: 'Baumarkt', group: 'Verein' }, { id: 99 }]);
    expect(chosen.map((list) => list.id)).toEqual([21, 12, 13]);
    expect(missing).toEqual(['"Urlaub"', '"Baumarkt" in "Verein"', 'Nr. 99']);
  });

  it('nimmt bei gleichem Namen die erste Liste und nennt keine doppelt', () => {
    expect(chooseLists(lists, [{ name: 'Einkauf' }, { id: 11 }]).chosen.map((list) => list.id)).toEqual([11]);
    expect(chooseLists(lists, []).chosen).toEqual([]);
  });

  it('bildet eindeutige Kennungen', () => {
    expect(listKey('Einkauf Wochenende!')).toBe('einkauf-wochenende');
    expect(listKey('Getränke & Süßes')).toBe('getraenke-suesses');
    expect(listKey('???')).toBe('liste');
    expect([...keyed([lists[0]!, lists[3]!, lists[2]!]).keys()]).toEqual(['einkauf', 'einkauf-2', 'baumarkt']);
  });
});

describe('Einträge für die Anzeige', () => {
  it('stellt offene in der Reihenfolge der Liste voran und erledigte dahinter, zuletzt abgehakte zuerst', () => {
    const entries = toEntries([
      item(1, 'Kaffee', { checked: 1, checkedAt: '2026-10-09T08:00:00.000Z' }),
      item(2, 'Milch', { position: 5, quantity: '2', unit: 'l', category: 'dairy' }),
      item(3, 'Butter', { position: 0, quantity: ' ', unit: null }),
      item(4, 'Tee', { checked: true, checkedAt: '2026-10-09T09:00:00.000Z' }),
      item(5, 'Eier', { position: 0, quantity: '10' }),
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(['Butter', 'Eier', 'Milch', 'Tee', 'Kaffee']);
    expect(entries[2]).toEqual({ id: 2, name: 'Milch', amount: '2 l', category: 'dairy', checked: false });
    expect(entries[0]).toEqual({ id: 3, name: 'Butter', checked: false });
    expect(entries[3]).toEqual({ id: 4, name: 'Tee', checked: true, checkedAt: '2026-10-09T09:00:00.000Z' });
  });

  it('führt Meldungen des Echtzeitkanals nach', () => {
    const before = [item(1, 'Milch'), item(2, 'Butter')];
    expect(applyEvent(before, 'item_created', item(3, 'Eier'))!.map((entry) => entry.id)).toEqual([1, 2, 3]);
    // Dieselbe Meldung ein zweites Mal – etwa als Antwort und über den Kanal – ändert nichts
    expect(applyEvent(before, 'item_created', item(2, 'Butter'))).toHaveLength(2);
    expect(applyEvent(before, 'item_updated', item(2, 'Butter', { checked: 1 }))![1]!.checked).toBe(1);
    expect(applyEvent(before, 'item_deleted', { id: 1 })!.map((entry) => entry.id)).toEqual([2]);
    expect(before).toHaveLength(2);
  });

  it('erkennt, was es nicht versteht', () => {
    for (const [event, data] of [['list_renamed', { id: 1 }], ['item_updated', { id: 1 }], ['item_created', null], ['item_deleted', {}], ['item_updated', 'x']] as const) {
      expect(applyEvent([item(1, 'Milch')], event, data), event).toBeUndefined();
    }
  });
});

describe('Echtzeitkanal', () => {
  it('setzt Meldungen aus Bruchstücken zusammen und übergeht Lebenszeichen', () => {
    const parser = new EventParser();
    expect(parser.push(':ping\n\nevent: item_cre')).toEqual([]);
    expect(parser.push('ated\ndata: {"id":3}\n\nevent: item_deleted\r\ndata: {"id":')).toEqual([{ event: 'item_created', data: '{"id":3}' }]);
    expect(parser.push('1}\r\n\r\n')).toEqual([{ event: 'item_deleted', data: '{"id":1}' }]);
    expect(parser.push('data: a\ndata: b\n\n')).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});

describe('Eingabe eines Eintrags', () => {
  it('trennt Menge und Einheit vom Namen', () => {
    expect(splitEntry('2 kg Mehl')).toEqual({ name: 'Mehl', quantity: '2', unit: 'kg' });
    expect(splitEntry('  500g   Tomaten, gehackt ')).toEqual({ name: 'Tomaten, gehackt', quantity: '500', unit: 'g' });
    expect(splitEntry('1,5 l Milch')).toEqual({ name: 'Milch', quantity: '1,5', unit: 'l' });
    expect(splitEntry('3 Zitronen')).toEqual({ name: 'Zitronen', quantity: '3' });
    expect(splitEntry('2 Flaschen Apfelsaft')).toEqual({ name: 'Apfelsaft', quantity: '2', unit: 'Flaschen' });
    expect(splitEntry('2x Hefe')).toEqual({ name: 'Hefe', quantity: '2' });
    expect(splitEntry('1 Pck. Backpulver')).toEqual({ name: 'Backpulver', quantity: '1', unit: 'Pck' });
  });

  it('lässt stehen, was keine Menge ist', () => {
    for (const text of ['Butter', '7 Zwerge', 'Dübel 8 mm', '100']) {
      const entry = splitEntry(text);
      if (text === '7 Zwerge') expect(entry).toEqual({ name: 'Zwerge', quantity: '7' });
      else expect(entry, text).toEqual({ name: text });
    }
    // Eine Einheit ohne Namen dahinter ist selbst der Name
    expect(splitEntry('2 Gläser')).toEqual({ name: 'Gläser', quantity: '2' });
    expect(splitEntry('   ')).toEqual({ name: '' });
  });
});
