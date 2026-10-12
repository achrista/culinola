import { describe, expect, it } from 'vitest';
import { conditionValue, toEntries, toEvents } from './events.ts';

const problems = { noName: 'Name fehlt', twice: (name: string) => `${name} doppelt` };
const events = {
  hausglocke: { text: 'Jemand klingelt!', sound: 'bell', speak: true, video: 'haustuer', eigenes: 'bleibt' },
  'waschen-fertig': { text: 'Die Waschmaschine ist fertig.', when: { datapoint: 'openhab:Waschmaschine_An', equals: 3 } },
  'monitor-aus': { text: '', show: false },
  warm: { text: 'Warm.', when: { datapoint: 'demo:temp', above: 28.5 } },
  offen: { text: 'Offen.', when: { datapoint: 'demo:tuer', equals: true } },
  zustand: { text: 'Fertig.', when: { datapoint: 'timer:state', equals: 'done' } },
};

describe('Meldungen im Formular', () => {
  it('kommen unverändert zurück, wenn nichts geändert wird', () => {
    expect(toEvents(toEntries(events), problems)).toEqual(events);
    expect(toEvents(toEntries({}), problems)).toEqual({});
  });

  it('zeigen den Namen als Feld, ein reines Signal als Schalter und die Bedingung mit Art und Wert', () => {
    const entries = toEntries(events);
    expect(entries[0]).toEqual({ name: 'hausglocke', text: 'Jemand klingelt!', sound: 'bell', speak: true, video: 'haustuer', eigenes: 'bleibt' });
    expect(entries[1]!['when']).toEqual({ datapoint: 'openhab:Waschmaschine_An', test: 'equals', value: '3' });
    expect(entries[2]).toEqual({ name: 'monitor-aus', text: '', signal: true });
    expect(entries[3]!['when']).toEqual({ datapoint: 'demo:temp', test: 'above', value: '28.5' });
  });

  it('lassen eine Bedingung ohne Datenpunkt weg', () => {
    expect(toEvents([{ name: 'neu', text: 'Neu.', when: { test: 'equals', value: '1' } }], problems)).toEqual({ neu: { text: 'Neu.' } });
  });

  it('verlangen einen Namen je Meldung, und jeden nur einmal', () => {
    expect(() => toEvents([{ text: 'ohne' }], problems)).toThrow('Name fehlt');
    expect(() => toEvents([{ name: '  ', text: 'ohne' }], problems)).toThrow('Name fehlt');
    expect(() => toEvents([{ name: 'a', text: '1' }, { name: 'a', text: '2' }], problems)).toThrow('a doppelt');
    expect(() => toEvents([{ name: '__proto__', text: '1' }], problems)).not.toThrow();
  });
});

describe('conditionValue', () => {
  it('liest für „genau“ wahr und falsch, Zahlen und sonst den Text', () => {
    expect(conditionValue('equals', 'true')).toBe(true);
    expect(conditionValue('equals', ' false ')).toBe(false);
    expect(conditionValue('equals', '3')).toBe(3);
    expect(conditionValue('equals', '21,5')).toBe(21.5);
    expect(conditionValue('equals', 'done')).toBe('done');
    expect(conditionValue('equals', '')).toBe('');
  });

  it('liest für „über“ und „unter“ eine Zahl – was keine ist, lehnt der Kern ab', () => {
    expect(conditionValue('above', '30')).toBe(30);
    expect(conditionValue('below', '-2,5')).toBe(-2.5);
    expect(Number.isNaN(conditionValue('above', 'warm'))).toBe(true);
  });
});
