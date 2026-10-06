import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, loadSecrets } from './config.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'culinola-'));
  process.env.CULINOLA_DATA = dir;
});
afterEach(() => {
  delete process.env.CULINOLA_DATA;
  rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('fällt ohne config.json auf die Beispielwerte zurück', () => {
    const loaded = loadConfig();
    expect(loaded.demo).toBe(true);
    expect(loaded.config.sources[0]?.plugin).toBe('connector-demo');
  });

  it('liest eine eigene Konfiguration und ergänzt den Port', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ sources: [], layouts: {} }));
    const loaded = loadConfig();
    expect(loaded.demo).toBe(false);
    expect(loaded.config.port).toBe(8090);
  });

  it('nennt die Datei, wenn "sources" fehlt', () => {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ layouts: {} }));
    expect(() => loadConfig()).toThrow(/config\.json: "sources" fehlt/);
  });
});

describe('loadSecrets', () => {
  it('liefert ohne Datei eine leere Sammlung', () => {
    expect(loadSecrets(dir)).toEqual({});
  });

  it('meldet einen Zeilenumbruch im Wert mit Dateiname und Hinweis', () => {
    // So sieht die Datei aus, wenn ein Token samt Zeilenumbruch eingefügt wurde.
    writeFileSync(join(dir, 'secrets.json'), '{\n  "openhab": {\n    "token": "abc\n"\n  }\n}\n');
    expect(() => loadSecrets(dir)).toThrow(/secrets\.json lässt sich nicht lesen.*Zeilenumbruch/s);
  });
});
