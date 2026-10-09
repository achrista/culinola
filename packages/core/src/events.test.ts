import type { Logger } from '@culinola/sdk';
import { describe, expect, it } from 'vitest';
import { EventHub, holds, parseEvents, UnknownEvent, type Raised } from './events.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('Meldungen in der Konfiguration', () => {
  it('liest eine Meldung mit allen Angaben', () => {
    const events = parseEvents({
      hausglocke: { text: ' Jemand klingelt! ', sound: 'bell', speak: true, video: 'kamera3', videoSource: 'kameras', seconds: 60 },
      'waschen-fertig': { text: 'Die Waschmaschine ist fertig.', when: { datapoint: 'openhab:Waschmaschine_An', equals: 3 } },
    });
    expect(events).toEqual({
      hausglocke: { text: 'Jemand klingelt!', sound: 'bell', speak: true, video: 'kamera3', videoSource: 'kameras', seconds: 60 },
      'waschen-fertig': { text: 'Die Waschmaschine ist fertig.', when: { datapoint: 'openhab:Waschmaschine_An', equals: 3 } },
    });
    expect(parseEvents(undefined)).toEqual({});
    // Ein reines Signal: ohne Text, ohne Anzeige
    expect(parseEvents({ 'monitor-aus': { show: false } })).toEqual({ 'monitor-aus': { text: '', show: false } });
  });

  it('sagt bei Fehlern, welche Meldung gemeint ist und was fehlt', () => {
    const bad: [unknown, RegExp][] = [
      [[], /Verzeichnis von Meldungen/],
      [{ Hausglocke: { text: 'x' } }, /"Hausglocke": Der Name/],
      [{ a: {} }, /"a": "text" fehlt/],
      [{ a: { text: 'x', sound: 'gong' } }, /"sound" muss einer von bell, chime, beep, none/],
      [{ a: { text: 'x', seconds: 0 } }, /"seconds"/],
      [{ a: { text: 'x', speak: 'ja' } }, /"speak"/],
      [{ a: { text: 'x', show: 'nein' } }, /"show"/],
      [{ a: { show: true } }, /"text" fehlt/],
      [{ a: { text: 'x', video: 3 } }, /"video"/],
      [{ a: { text: 'x', when: { datapoint: 'ohne-quelle', equals: 1 } } }, /"when" braucht einen Datenpunkt/],
      [{ a: { text: 'x', when: { datapoint: 'q:x' } } }, /genau eine der Angaben/],
      [{ a: { text: 'x', when: { datapoint: 'q:x', above: 1, below: 2 } } }, /genau eine der Angaben/],
      [{ a: { text: 'x', when: { datapoint: 'q:x', above: 'viel' } } }, /"above" muss eine Zahl/],
      [{ a: { text: 'x', when: { datapoint: 'q:x', equals: null } } }, /genau eine der Angaben|"equals"/],
    ];
    for (const [raw, message] of bad) expect(() => parseEvents(raw), JSON.stringify(raw)).toThrow(message);
  });
});

describe('Bedingungen', () => {
  it('vergleicht genau oder nach Größe', () => {
    expect(holds({ datapoint: 'q:x', equals: true }, true)).toBe(true);
    expect(holds({ datapoint: 'q:x', equals: 3 }, 3)).toBe(true);
    expect(holds({ datapoint: 'q:x', equals: 3 }, '3')).toBe(false);
    expect(holds({ datapoint: 'q:x', equals: 'fertig' }, 'fertig')).toBe(true);
    expect(holds({ datapoint: 'q:x', above: 1000 }, 1000.5)).toBe(true);
    expect(holds({ datapoint: 'q:x', above: 1000 }, 1000)).toBe(false);
    expect(holds({ datapoint: 'q:x', below: 5 }, 4)).toBe(true);
    for (const value of [undefined, null, 'viel', true]) expect(holds({ datapoint: 'q:x', above: 0 }, value), String(value)).toBe(false);
  });
});

describe('Meldungen auslösen', () => {
  const hub = () => {
    const events = new EventHub(
      parseEvents({
        hausglocke: { text: 'Jemand klingelt!', sound: 'bell', speak: true, video: 'kamera3' },
        fertig: { text: 'Die Waschmaschine ist fertig.', when: { datapoint: 'oh:Waschen', equals: 3 } },
        warm: { text: 'Es ist warm.', seconds: 5, sound: 'none', when: { datapoint: 'oh:Temp', above: 25 } },
      }),
      quiet,
    );
    const seen: Raised[] = [];
    const stop = events.onRaised((raised) => seen.push(raised));
    return { events, seen, stop };
  };

  it('gibt die Meldung mit ihren Vorgaben an alle weiter, die zuhören', () => {
    const { events, seen, stop } = hub();
    const raised = events.raise('hausglocke');
    expect(raised).toMatchObject({ id: 1, name: 'hausglocke', text: 'Jemand klingelt!', sound: 'bell', speak: true, seconds: 90, video: { source: 'video', stream: 'kamera3' } });
    expect(Date.parse(raised.at)).toBeGreaterThan(0);
    // Ohne eigene Angaben: ein leiser Ton, zehn Sekunden, kein Vorlesen; ein mitgegebener Text ersetzt den eingerichteten
    expect(events.raise('fertig', ' Die Wäsche wartet. ')).toMatchObject({ id: 2, text: 'Die Wäsche wartet.', sound: 'chime', speak: false, seconds: 10 });
    expect(events.raise('fertig', '   ').text).toBe('Die Waschmaschine ist fertig.');
    expect(seen.map((entry) => entry.id)).toEqual([1, 2, 3]);
    stop();
    events.raise('warm');
    expect(seen).toHaveLength(3);
    expect(() => events.raise('gibt-es-nicht')).toThrow(UnknownEvent);
    expect(events.list()).toEqual([
      { name: 'hausglocke', text: 'Jemand klingelt!' },
      { name: 'fertig', text: 'Die Waschmaschine ist fertig.', trigger: 'oh:Waschen' },
      { name: 'warm', text: 'Es ist warm.', trigger: 'oh:Temp' },
    ]);
  });

  it('gibt reine Signale weiter, ohne dass die Anzeigen etwas zeigen oder tönen', () => {
    const events = new EventHub(parseEvents({ 'monitor-aus': { show: false, sound: 'bell', speak: true } }), quiet);
    expect(events.raise('monitor-aus')).toMatchObject({ name: 'monitor-aus', show: false, text: '', sound: 'none', speak: false });
    expect(new EventHub(parseEvents({ a: { text: 'x' } }), quiet).raise('a').show).toBe(true);
  });

  it('feuert, wenn ein Datenpunkt die Bedingung neu erfüllt – nicht beim Start und nicht dauernd', () => {
    const { events, seen } = hub();
    // Der erste Wert nach dem Start: Die Maschine war schon fertig, als der Kern anlief
    events.observe({ id: 'oh:Waschen', value: 3 });
    expect(seen).toHaveLength(0);
    events.observe({ id: 'oh:Waschen', value: 0 });
    events.observe({ id: 'oh:Waschen', value: 1 });
    events.observe({ id: 'oh:Waschen', value: 3 });
    events.observe({ id: 'oh:Waschen', value: 3 });
    expect(seen.map((entry) => entry.name)).toEqual(['fertig']);
    events.observe({ id: 'oh:Waschen', value: 0 });
    events.observe({ id: 'oh:Waschen', value: 3 });
    expect(seen).toHaveLength(2);

    events.observe({ id: 'oh:Temp', value: 24 });
    events.observe({ id: 'oh:Temp', value: 26 });
    events.observe({ id: 'oh:Temp', value: 27 });
    events.observe({ id: 'oh:Anderes', value: 99 });
    expect(seen.map((entry) => entry.name)).toEqual(['fertig', 'fertig', 'warm']);
  });
});
