import { describe, expect, it } from 'vitest';
import { volumeLevel } from './format.ts';

describe('Lautstärke in Prozent', () => {
  it('wird zum Faktor, begrenzt auf stumm bis doppelt', () => {
    expect(volumeLevel(100, 40)).toBe(1);
    expect(volumeLevel(30, 40)).toBe(0.3);
    expect(volumeLevel(0, 40)).toBe(0);
    expect(volumeLevel(-5, 40)).toBe(0);
    expect(volumeLevel(500, 40)).toBe(2);
  });

  it('nimmt die Vorgabe, wo nichts Brauchbares steht', () => {
    for (const value of [undefined, null, 'laut', Number.NaN]) expect(volumeLevel(value, 40)).toBe(0.4);
  });
});
