import { describe, expect, it } from 'vitest';
import { itemFromTopic, parseState, toCommand } from './parse.ts';

describe('parseState', () => {
  it('trennt Zahl und Einheit', () => {
    expect(parseState('21.5 °C', 'Number:Temperature')).toEqual({ value: 21.5, unit: '°C', quality: 'good' });
    expect(parseState('2310 W', 'Number:Power')).toEqual({ value: 2310, unit: 'W', quality: 'good' });
  });

  it('liest Zahlen ohne Einheit, auch negative und mit Exponent', () => {
    expect(parseState('820', 'Number')).toEqual({ value: 820, quality: 'good' });
    expect(parseState('-3.2', 'Number')).toEqual({ value: -3.2, quality: 'good' });
    expect(parseState('1.5E3', 'Number')).toEqual({ value: 1500, quality: 'good' });
  });

  it('macht aus Schalterzuständen Wahrheitswerte', () => {
    expect(parseState('ON', 'Switch')).toEqual({ value: true, quality: 'good' });
    expect(parseState('OFF', 'Switch')).toEqual({ value: false, quality: 'good' });
  });

  it('meldet fehlende Zustände als veraltet', () => {
    expect(parseState('NULL', 'Number')).toEqual({ value: null, quality: 'stale' });
    expect(parseState('UNDEF', 'Switch')).toEqual({ value: null, quality: 'stale' });
  });

  it('lässt Text unverändert', () => {
    expect(parseState('partly-cloudy-day', 'String')).toEqual({ value: 'partly-cloudy-day', quality: 'good' });
    expect(parseState('ON', 'String')).toEqual({ value: 'ON', quality: 'good' });
  });
});

describe('toCommand', () => {
  it('übersetzt Wahrheitswerte und Zahlen', () => {
    expect(toCommand(true)).toBe('ON');
    expect(toCommand(false)).toBe('OFF');
    expect(toCommand(40)).toBe('40');
  });

  it('lehnt leere Werte ab', () => {
    expect(() => toCommand(null)).toThrow(/leerer Wert/);
  });
});

describe('itemFromTopic', () => {
  it('liest den Itemnamen', () => {
    expect(itemFromTopic('openhab/items/Licht_Treppe/statechanged')).toBe('Licht_Treppe');
  });

  it('übergeht Gruppenereignisse und Fremdes', () => {
    expect(itemFromTopic('openhab/items/Gruppe/Licht_Treppe/statechanged')).toBeUndefined();
    expect(itemFromTopic('openhab/things/abc/status')).toBeUndefined();
  });
});
