import { describe, expect, it } from 'vitest';
import { explain } from '@culinola/sdk';
import { installedPlugins, loadPlugin, matchRoute } from './plugins.ts';

describe('matchRoute', () => {
  it('nimmt feste Teile, benannte Teile und den Rest', () => {
    expect(matchRoute('/import', '/import')).toEqual({});
    expect(matchRoute('/text/:id', '/text/kuchen')).toEqual({ id: 'kuchen' });
    expect(matchRoute('/message/:account/:uid', '/message/privat/17')).toEqual({ account: 'privat', uid: '17' });
    expect(matchRoute('/file/:id/*', '/file/kuchen/bilder/eins.png')).toEqual({ id: 'kuchen', '*': 'bilder/eins.png' });
  });

  it('entschlüsselt die Teile – auch, was nach einem Ausbruch aus dem Ordner aussieht; das prüft das Plugin', () => {
    expect(matchRoute('/text/:id', '/text/K%C3%A4sekuchen')).toEqual({ id: 'Käsekuchen' });
    expect(matchRoute('/file/:id/*', '/file/kuchen/..%2F..%2Fgeheim.png')).toEqual({ id: 'kuchen', '*': '../../geheim.png' });
  });

  it('weist ab, was nicht passt', () => {
    for (const [pattern, path] of [['/text/:id', '/text'], ['/text/:id', '/text/'], ['/text/:id', '/text/a/b'], ['/import', '/import/x'], ['/text/:id', '/texte/a'], ['/text/:id', '/text/%E0%A4%A']] as const) {
      expect(matchRoute(pattern, path), `${pattern} ${path}`).toBeUndefined();
    }
  });
});

describe('Plugins laden', () => {
  it('findet die installierten Plugins', () => {
    expect(installedPlugins()).toEqual(expect.arrayContaining(['connector-demo', 'connector-openhab', 'media-radio', 'recipes', 'timer']));
    expect(installedPlugins().every((name) => /^[a-z0-9-]+$/.test(name))).toBe(true);
  });

  it('sagt, wenn ein Plugin fehlt, und lädt nichts, was kein Name eines Plugins ist', async () => {
    await expect(loadPlugin('gibt-es-nicht')).rejects.toThrow('Das Plugin "gibt-es-nicht" ist nicht installiert.');
    for (const name of ['../../../boese', 'Timer', 'timer/../recipes', '', 'a b']) await expect(loadPlugin(name), name).rejects.toThrow(/kein Name eines Plugins/);
    expect((await loadPlugin('timer')).id).toBe('timer');
  });
});

describe('Beschreibungen der Plugins', () => {
  type Described = { key: string; label?: Record<string, string>; hint?: Record<string, string>; fields?: readonly Described[] };
  const flat = (fields: readonly Described[]): Described[] => fields.flatMap((field) => [field, ...flat(field.fields ?? [])]);

  it('nennen Namen, Beschreibung und jede Einstellung in beiden Sprachen', async () => {
    for (const name of installedPlugins()) {
      const plugin = await loadPlugin(name);
      for (const language of ['de', 'en']) {
        expect(plugin.name?.[language] && plugin.text?.[language], `${name} ${language}`).toBeTruthy();
        if (plugin.help) expect(plugin.help[language], `${name} Hilfe ${language}`).toBeTruthy();
        // Wer Zugangsdaten verlangt, sagt auch, woher man sie bekommt
        if (plugin.secrets?.length) expect(plugin.help?.[language], `${name} Hilfe ${language}`).toBeTruthy();
        for (const field of [...flat((plugin.settings ?? []) as readonly Described[]), ...((plugin.secrets ?? []) as readonly Described[])]) {
          expect(field.label?.[language], `${name}.${field.key} ${language}`).toBeTruthy();
          if (field.hint) expect(field.hint[language], `${name}.${field.key} Hinweis ${language}`).toBeTruthy();
        }
      }
      const keys = (plugin.settings ?? []).map((field) => field.key);
      expect(new Set(keys).size, name).toBe(keys.length);
    }
  });
});

describe('explain', () => {
  it('nennt die Ursache hinter einem gescheiterten Netzaufruf', () => {
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', address: '192.168.178.9', port: 2001 } });
    expect(explain(refused)).toBe('fetch failed: Verbindung abgelehnt (192.168.178.9:2001) – unter dieser Adresse und diesem Port antwortet nichts.');
    expect(explain(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', hostname: 'openhab' } }))).toMatch(/Der Name ist unbekannt \(openhab\)/);
    expect(explain(Object.assign(new TypeError('fetch failed'), { cause: new Error('unbekannter Grund') }))).toBe('fetch failed: unbekannter Grund');
  });

  it('lässt andere Fehler, wie sie sind', () => {
    expect(explain(new Error('"url" fehlt.'))).toBe('"url" fehlt.');
    expect(explain('nur Text')).toBe('nur Text');
    expect(explain(undefined)).toBe('undefined');
  });
});
