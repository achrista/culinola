import type Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sources } from './cli.ts';
import { convertMaterial, type ConvertOptions } from './convert.ts';
import { fileName, saveRecipe } from './save.ts';
import { readSource } from './source.ts';
import type { SourceMaterial } from './types.ts';

const jpeg = (bytes: number, fill = 7) => Uint8Array.from({ length: bytes }, (_, index) => (index === 0 ? 0xff : index === 1 ? 0xd8 : index === 2 ? 0xff : fill));
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const extracted = {
  title: 'Apfelkuchen',
  description: null,
  category: 'Kuchen & Torten',
  tags: [],
  time: null,
  servings: null,
  portions: null,
  ingredients: [{ title: null, items: [{ quantity: '3', unit: null, name: 'Äpfel', note: null, iconKey: 'produce' }] }],
  steps: [{ title: null, steps: ['Backen.'] }],
  notes: [],
  sourceUrl: null,
  dishPhoto: null as number | null,
};

function fake(recipes: unknown[]): ConvertOptions & { blocks: () => Anthropic.ContentBlockParam[] } {
  let seen: Anthropic.ContentBlockParam[] = [];
  const messages = {
    parse: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      seen = params.messages[0]!.content as Anthropic.ContentBlockParam[];
      return { stop_reason: 'end_turn', parsed_output: { recipes }, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
  return { client: { messages } as unknown as Pick<Anthropic, 'messages'>, blocks: () => seen };
}

const material = (extra: Partial<SourceMaterial> = {}): SourceMaterial => ({ name: 'Apfelkuchen.pdf', text: 'Apfelkuchen …', images: [], warnings: [], ...extra });
const image = (name: string, data = jpeg(10)) => ({ name, mediaType: 'image/jpeg' as const, data });

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'rezept-foto-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

describe('Foto neben der Vorlage', () => {
  it('nimmt ein Bild gleichen Namens als Foto des Gerichts', async () => {
    writeFileSync(join(dir, 'Apfelkuchen.txt'), 'Apfelkuchen\n3 Äpfel');
    writeFileSync(join(dir, 'Apfelkuchen.jpg'), jpeg(2000));
    writeFileSync(join(dir, 'Birnenkuchen.txt'), 'Birnenkuchen\n3 Birnen');
    expect((await readSource({ file: join(dir, 'Apfelkuchen.txt') })).cover).toMatchObject({ name: 'Apfelkuchen.jpg', mediaType: 'image/jpeg' });
    expect((await readSource({ file: join(dir, 'Birnenkuchen.txt') })).cover).toBeUndefined();
    // Ein Bild als Vorlage ist das abfotografierte Rezept selbst
    expect((await readSource({ file: join(dir, 'Apfelkuchen.jpg') })).cover).toBeUndefined();
  });

  it('liest im Ordnerlauf das Foto nicht noch einmal als eigene Vorlage', () => {
    writeFileSync(join(dir, 'Zettel.png'), png);
    expect(sources(dir, false).map((file) => basename(file))).toEqual(['Apfelkuchen.txt', 'Birnenkuchen.txt', 'Zettel.png']);
  });

  it('übernimmt ein mitgegebenes Foto beim Hochladen und weist anderes ab', async () => {
    const text = Buffer.from('Apfelkuchen\n3 Äpfel');
    expect((await readSource({ data: text, name: 'a.txt', photo: { data: png, name: 'C:\\Bilder\\foto.png' } })).cover).toMatchObject({ name: 'foto.png', mediaType: 'image/png' });
    const refused = await readSource({ data: text, name: 'a.txt', photo: { data: Buffer.from('kein Bild'), name: 'foto.jpg' } });
    expect(refused.cover).toBeUndefined();
    expect(refused.warnings).toHaveLength(1);
  });
});

describe('Titelbild einer Webseite', () => {
  const page = '<html><head><meta property="og:image" content="/bilder/kuchen.jpg"></head><body><h1>Apfelkuchen</h1><p>3 Äpfel schälen und backen.</p></body></html>';
  const answer = (body: string | Uint8Array<ArrayBuffer>, type: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': type } });

  it('wird geholt und dem Rezept als Foto mitgegeben', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url);
      return url.endsWith('.jpg') ? answer(jpeg(3000), 'image/jpeg') : answer(page, 'text/html; charset=utf-8');
    });
    const source = await readSource({ url: 'https://93.184.216.34/rezepte/apfelkuchen' });
    expect(asked).toEqual(['https://93.184.216.34/rezepte/apfelkuchen', 'https://93.184.216.34/bilder/kuchen.jpg']);
    expect(source.cover).toMatchObject({ name: 'kuchen.jpg', mediaType: 'image/jpeg' });
    expect(source.cover!.data).toHaveLength(3000);
    expect(source.warnings).toEqual([]);
  });

  it('fehlt mit Hinweis, wenn es sich nicht holen lässt – das Rezept kommt trotzdem', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('.jpg') ? answer('weg', 'text/plain', 404) : answer(page, 'text/html')));
    const source = await readSource({ url: 'https://93.184.216.34/rezepte/apfelkuchen' });
    expect(source.text).toContain('Apfelkuchen');
    expect(source.cover).toBeUndefined();
    expect(source.imageUrl).toBe('https://93.184.216.34/bilder/kuchen.jpg');
    expect(source.warnings[0]).toMatch(/Titelbild/);
  });
});

describe('Wahl des Fotos', () => {
  it('zeigt dem Modell das beiliegende Foto nicht und nimmt es, wenn die Vorlage keines hergibt', async () => {
    const options = fake([extracted]);
    const result = await convertMaterial(material({ cover: image('titel.jpg') }), options);
    expect(result.recipes[0]!.photo?.name).toBe('titel.jpg');
    expect(options.blocks().some((block) => block.type === 'image')).toBe(false);
  });

  it('zieht das Foto vor, das das Modell in der Vorlage erkennt, und zählt dabei ab 1', async () => {
    const images = [image('eins.jpg'), image('zwei.jpg')];
    const first = await convertMaterial(material({ images, cover: image('titel.jpg') }), fake([{ ...extracted, dishPhoto: 1 }]));
    expect(first.recipes[0]!.photo?.name).toBe('eins.jpg');
    for (const dishPhoto of [0, 3, 1.5, -1]) {
      const other = await convertMaterial(material({ images, cover: image('titel.jpg') }), fake([{ ...extracted, dishPhoto }]));
      expect(other.recipes[0]!.photo?.name, String(dishPhoto)).toBe('titel.jpg');
    }
  });
});

describe('Ablage im Rezeptordner', () => {
  it('legt Rezept und Foto unter der Kategorie ab und überschreibt nichts', async () => {
    const folder = join(dir, 'rezepte');
    const { recipes } = await convertMaterial(material({ url: 'https://example.org/apfelkuchen', imageUrl: 'https://example.org/bild.jpg', cover: image('bild.jpg', jpeg(500, 1)) }), fake([extracted]));
    const first = saveRecipe(folder, recipes[0]!);
    expect(first).toEqual({ title: 'Apfelkuchen', file: 'Kuchen & Torten/Apfelkuchen.md', photo: 'Kuchen & Torten/Apfelkuchen.jpg' });
    // Im Rezept steht das abgelegte Foto, nicht die Adresse, von der es kam
    expect(readFileSync(join(folder, first.file), 'utf8')).toMatch(/^image: Apfelkuchen\.jpg$/m);
    expect(readFileSync(join(folder, first.photo!))).toHaveLength(500);

    const second = saveRecipe(folder, { ...recipes[0]!, photo: image('anders.jpg', jpeg(700, 2)) });
    expect(second.file).toBe('Kuchen & Torten/Apfelkuchen (2).md');
    expect(readFileSync(join(folder, second.file), 'utf8')).toMatch(/^image: Apfelkuchen \(2\)\.jpg$/m);
    expect(readFileSync(join(folder, first.photo!))).toHaveLength(500);
    expect(readdirSync(join(folder, 'Kuchen & Torten')).sort()).toEqual(['Apfelkuchen (2).jpg', 'Apfelkuchen (2).md', 'Apfelkuchen.jpg', 'Apfelkuchen.md']);
  });

  it('kommt ohne Foto und ohne Kategorie aus', async () => {
    const folder = join(dir, 'ohne');
    const { recipes } = await convertMaterial(material(), fake([{ ...extracted, title: 'Tee: "heiß" / kalt?', category: null }]));
    const saved = saveRecipe(folder, recipes[0]!);
    expect(saved).toEqual({ title: 'Tee: "heiß" / kalt?', file: `Sonstiges/${fileName('Tee: "heiß" / kalt?')}.md` });
    expect(existsSync(join(folder, saved.file))).toBe(true);
    expect(readFileSync(join(folder, saved.file), 'utf8')).not.toMatch(/^image:/m);
  });
});
