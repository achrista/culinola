import { describe, expect, it } from 'vitest';
import { icyFilter, parseTitle } from './icy.ts';

/** Baut einen Strom nach dem Senderschema: `interval` Bytes Ton, dann Längenbyte und Text. */
function stream(interval: number, parts: { audio: number[]; title?: string }[]): Uint8Array {
  const bytes: number[] = [];
  for (const part of parts) {
    if (part.audio.length !== interval) throw new Error('Testdaten: Tonblock hat die falsche Länge');
    bytes.push(...part.audio);
    if (part.title === undefined) {
      bytes.push(0);
    } else {
      const text = new TextEncoder().encode(`StreamTitle='${part.title}';`);
      const blocks = Math.ceil(text.length / 16);
      bytes.push(blocks, ...text, ...new Array<number>(blocks * 16 - text.length).fill(0));
    }
  }
  return new Uint8Array(bytes);
}

async function run(interval: number, input: Uint8Array, chunkSize: number): Promise<{ audio: number[]; titles: string[] }> {
  const titles: string[] = [];
  const filter = icyFilter(interval, (title) => titles.push(title));
  const writer = filter.writable.getWriter();
  const reader = filter.readable.getReader();
  const audio: number[] = [];
  const reading = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      audio.push(...value);
    }
  })();
  for (let start = 0; start < input.length; start += chunkSize) await writer.write(input.subarray(start, start + chunkSize));
  await writer.close();
  await reading;
  return { audio, titles };
}

describe('icyFilter', () => {
  const input = stream(4, [
    { audio: [1, 2, 3, 4], title: 'Interpret - Lied' },
    { audio: [5, 6, 7, 8] },
    { audio: [9, 10, 11, 12], title: 'Interpret - Lied' },
    { audio: [13, 14, 15, 16], title: 'Nachrichten' },
  ]);
  const expectedAudio = Array.from({ length: 16 }, (_, index) => index + 1);

  it('reicht nur den Ton weiter und meldet jeden neuen Titel einmal', async () => {
    const result = await run(4, input, input.length);
    expect(result.audio).toEqual(expectedAudio);
    expect(result.titles).toEqual(['Interpret - Lied', 'Nachrichten']);
  });

  it('arbeitet unabhängig davon, wie der Strom gestückelt ankommt', async () => {
    for (const chunkSize of [1, 3, 7, 16]) {
      const result = await run(4, input, chunkSize);
      expect(result.audio).toEqual(expectedAudio);
      expect(result.titles).toEqual(['Interpret - Lied', 'Nachrichten']);
    }
  });
});

describe('parseTitle', () => {
  it('liest den Titel und lässt weitere Angaben weg', () => {
    expect(parseTitle("StreamTitle='Bayern 2 - radioWelt';StreamUrl='';")).toBe('Bayern 2 - radioWelt');
  });

  it('verträgt Apostrophe im Titel', () => {
    expect(parseTitle("StreamTitle='Don't Stop';")).toBe("Don't Stop");
  });

  it('liefert nichts, wenn kein Titel enthalten ist', () => {
    expect(parseTitle("StreamUrl='x';")).toBeUndefined();
  });
});
