import { describe, expect, it } from 'vitest';
import { isOn } from './state.ts';

describe('isOn', () => {
  it('liest Schalter', () => {
    expect(isOn(true)).toBe(true);
    expect(isOn(false)).toBe(false);
  });

  it('liest Dimmer über die Helligkeit', () => {
    expect(isOn(40)).toBe(true);
    expect(isOn(0)).toBe(false);
  });

  it('liest Farblampen über den Helligkeitsanteil', () => {
    expect(isOn('120,100,50')).toBe(true);
    expect(isOn('120,100,0')).toBe(false);
  });

  it('wertet Fehlendes und Fremdes als aus', () => {
    expect(isOn(null)).toBe(false);
    expect(isOn(undefined)).toBe(false);
    expect(isOn('ON')).toBe(false);
  });
});
