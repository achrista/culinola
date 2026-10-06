import { describe, expect, it } from 'vitest';
import { definePlugin } from './index.ts';

describe('definePlugin', () => {
  it('gibt eine gültige Definition unverändert zurück', () => {
    const definition = { id: 'media-radio', actions: [{ name: 'radio.play', description: 'Sender abspielen' }] };
    expect(definePlugin(definition)).toBe(definition);
  });

  it('lehnt eine Kennung mit Großbuchstaben ab', () => {
    expect(() => definePlugin({ id: 'MediaRadio' })).toThrow(/Ungültige Plugin-Kennung/);
  });

  it('lehnt eine Aktion ohne Bereich ab', () => {
    expect(() => definePlugin({ id: 'media-radio', actions: [{ name: 'play', description: 'Abspielen' }] })).toThrow(/bereich\.name/);
  });
});
