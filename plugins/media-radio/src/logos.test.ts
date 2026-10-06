import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentTypeFor, extensionFor, LogoStore } from './logos.ts';

describe('extensionFor', () => {
  it('erkennt gängige Bildtypen, auch mit Zusatzangaben', () => {
    expect(extensionFor('image/png')).toBe('.png');
    expect(extensionFor('image/webp; charset=binary')).toBe('.webp');
    expect(extensionFor('IMAGE/SVG+XML')).toBe('.svg');
  });

  it('lehnt alles ab, was kein Bild ist', () => {
    expect(extensionFor('text/html')).toBeUndefined();
    expect(extensionFor(null)).toBeUndefined();
  });
});

describe('LogoStore', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'culinola-logos-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('findet das Logo eines Senders unabhängig von der Endung', () => {
    const store = new LogoStore(dir);
    writeFileSync(join(dir, 'logos', 'bayern2.webp'), 'x');
    expect(store.find('bayern2')?.contentType).toBe('image/webp');
    expect(store.find('bayern3')).toBeUndefined();
  });

  it('nimmt selbst abgelegte Dateien, aber nur aus dem eigenen Ordner', () => {
    const store = new LogoStore(dir);
    writeFileSync(join(dir, 'logos', 'rt1.png'), 'x');
    writeFileSync(join(dir, 'geheim.png'), 'x');
    expect(store.local('rt1.png')?.contentType).toBe('image/png');
    expect(store.local('../geheim.png')).toBeUndefined();
    expect(store.local('fehlt.png')).toBeUndefined();
  });

  it('liefert keine Datei mit fremder Endung aus', () => {
    const store = new LogoStore(dir);
    writeFileSync(join(dir, 'logos', 'rt1.txt'), 'x');
    expect(store.local('rt1.txt')).toBeUndefined();
    expect(contentTypeFor('rt1.txt')).toBeUndefined();
  });
});
