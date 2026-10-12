import { describe, expect, it } from 'vitest';
import de from '../locales/de.json' with { type: 'json' };
import en from '../locales/en.json' with { type: 'json' };
import { catalog } from './catalog.ts';
import { type Field, blankEntry, initialValues, datapointIn, editable, settings, shifted, tagsOf, withDatapoint, withValue } from './settings.ts';

type Texts = Record<string, Record<string, unknown>>;

/** Alle Einstellungen einer Kachelart, auch die in Gruppen und Listen. */
function flat(fields: readonly Field[]): Field[] {
  return fields.flatMap((field) => (field.type === 'group' || field.type === 'list' ? [field, ...flat(field.fields)] : [field]));
}

describe('Einstellungen der Kacheln', () => {
  it('sind für jede Kachelart beschrieben – und für keine, die es nicht gibt', () => {
    expect(Object.keys(settings).sort()).toEqual(Object.keys(catalog).sort());
  });

  it('haben in beiden Sprachen eine Bezeichnung, Auswahlwerte auch', () => {
    for (const [language, messages] of Object.entries({ de, en })) {
      const texts = messages.fields as Texts;
      for (const [type, fields] of Object.entries(settings)) {
        for (const field of flat(fields)) {
          expect(texts[type]?.[field.key] ?? texts['common']![field.key], `${language}: ${type}.${field.key}`).toBeTypeOf('string');
          if (field.type === 'select') for (const option of field.options) expect((texts['options'] as Texts)[field.key]?.[option], `${language}: ${field.key}.${option}`).toBeTypeOf('string');
        }
      }
    }
  });

  it('nennen jede Einstellung nur einmal und die Quelle so, wie die Beschreibung der Kachel sie nennt', () => {
    for (const [type, fields] of Object.entries(settings)) {
      const keys = fields.map((field) => field.key);
      expect(new Set(keys).size, type).toBe(keys.length);
      const wanted = catalog[type]!.source;
      if (wanted) expect(fields.find((field) => field.key === wanted.key), type).toMatchObject({ type: 'source', plugin: wanted.plugin });
    }
  });

  it('decken die Vorgaben einer neuen Kachel ab', () => {
    for (const [type, info] of Object.entries(catalog)) {
      for (const key of Object.keys(info.defaults ?? {})) expect(settings[type]!.some((field) => field.key === key), `${type}.${key}`).toBe(true);
    }
  });
});

describe('withValue', () => {
  const config = { datapoint: 'demo:temp', eigenes: { bleibt: true }, decimals: 1 };

  it('setzt eine Angabe und lässt alles andere stehen – auch, was das Formular nicht kennt', () => {
    expect(withValue(config, 'label', 'Bad')).toEqual({ ...config, label: 'Bad' });
    expect(withValue(config, 'decimals', 0)).toEqual({ ...config, decimals: 0 });
    expect(withValue(config, 'interactive', false)).toEqual({ ...config, interactive: false });
    expect(config).toEqual({ datapoint: 'demo:temp', eigenes: { bleibt: true }, decimals: 1 });
  });

  it('nimmt eine Angabe heraus, wenn das Feld geleert wird', () => {
    for (const empty of ['', undefined, null, Number.NaN]) expect(withValue(config, 'decimals', empty)).toEqual({ datapoint: 'demo:temp', eigenes: { bleibt: true } });
  });
});

describe('Datenpunkt in einer Angabe', () => {
  it('liest ihn als Text oder aus einem Objekt', () => {
    expect(datapointIn('demo:feuchte', 'datapoint')).toBe('demo:feuchte');
    expect(datapointIn({ datapoint: 'demo:feuchte', decimals: 0 }, 'datapoint')).toBe('demo:feuchte');
    expect(datapointIn({ datapoint: 'demo:feuchte' })).toBe('');
    expect(datapointIn(undefined, 'datapoint')).toBe('');
  });

  it('trägt ihn ein und behält die übrigen Angaben eines Objekts', () => {
    expect(withDatapoint('demo:alt', 'demo:neu', 'datapoint')).toBe('demo:neu');
    expect(withDatapoint({ datapoint: 'demo:alt', decimals: 0 }, 'demo:neu', 'datapoint')).toEqual({ datapoint: 'demo:neu', decimals: 0 });
    expect(withDatapoint({ datapoint: 'demo:alt', decimals: 0 }, '', 'datapoint')).toBeUndefined();
    expect(withDatapoint('demo:alt', '')).toBeUndefined();
  });
});

describe('Listen', () => {
  it('liest Texte mit Kommas', () => {
    expect(tagsOf(' home, daheim ,, zu Hause ')).toEqual(['home', 'daheim', 'zu Hause']);
    expect(tagsOf(' , ')).toBeUndefined();
  });

  it('versetzt einen Eintrag um einen Platz', () => {
    expect(shifted(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(shifted(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(shifted(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(shifted(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('Angaben, die das Formular nicht anfasst', () => {
  const list: Field = { key: 'feeds', type: 'list', fields: [{ key: 'id', type: 'text' }] };
  const tags: Field = { key: 'lists', type: 'tags' };

  it('bearbeitet Listen aus Objekten und Texte mit Komma', () => {
    expect(editable(list, [{ id: 'a' }, {}])).toBe(true);
    expect(editable(tags, ['Einkauf', 'Aufgaben'])).toBe(true);
    expect(editable(list, undefined)).toBe(true);
    expect(editable({ key: 'url', type: 'text' }, 7)).toBe(true);
  });

  it('lässt stehen, was es verstümmeln würde', () => {
    expect(editable(list, ['dw-de', { id: 'a' }])).toBe(false);
    expect(editable(list, 'kein Feld')).toBe(false);
    expect(editable(tags, ['Einkauf', { name: 'Aufgaben', group: 'Familie' }])).toBe(false);
    expect(editable(tags, [3])).toBe(false);
  });

  it('trägt in eine neue Quelle ein, was ihr Plugin als Vorgabe nennt', () => {
    expect(initialValues([{ key: 'url', type: 'text', initial: 'https://api.merkio.de' }, { key: 'refreshMinutes', type: 'number', placeholder: 5 }, { key: 'days', type: 'number', initial: 14 }, { key: 'lists', type: 'tags' }])).toEqual({ url: 'https://api.merkio.de', days: 14 });
    expect(initialValues([])).toEqual({});
  });

  it('gibt einem neuen Eintrag mit, was das Plugin immer verlangt', () => {
    expect(blankEntry([{ key: 'name', type: 'text' }, { key: 'kind', type: 'select', options: ['audio', 'video'], explicit: true }, { key: 'mode', type: 'select', options: ['', 'hls'] }])).toEqual({ kind: 'audio' });
  });
});
