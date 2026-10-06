/**
 * Radiosender betten den laufenden Titel in den Tonstrom ein: Nach jeweils
 * `interval` Bytes Ton folgt ein Längenbyte und so viele 16-Byte-Blöcke Text.
 * Dieser Filter nimmt die Textblöcke heraus, reicht den reinen Ton weiter und
 * meldet jeden neuen Titel.
 */
export function icyFilter(interval: number, onTitle: (title: string) => void): TransformStream<Uint8Array, Uint8Array> {
  let mode: 'audio' | 'length' | 'meta' = 'audio';
  let audioLeft = interval;
  let metaLeft = 0;
  let meta: number[] = [];
  let last = '';

  return new TransformStream({
    transform(chunk, controller) {
      let index = 0;
      while (index < chunk.length) {
        if (mode === 'audio') {
          const count = Math.min(audioLeft, chunk.length - index);
          controller.enqueue(chunk.subarray(index, index + count));
          index += count;
          audioLeft -= count;
          if (audioLeft === 0) mode = 'length';
        } else if (mode === 'length') {
          metaLeft = chunk[index]! * 16;
          index += 1;
          meta = [];
          if (metaLeft === 0) {
            mode = 'audio';
            audioLeft = interval;
          } else {
            mode = 'meta';
          }
        } else {
          const count = Math.min(metaLeft, chunk.length - index);
          for (let offset = 0; offset < count; offset++) meta.push(chunk[index + offset]!);
          index += count;
          metaLeft -= count;
          if (metaLeft === 0) {
            const title = parseTitle(new TextDecoder().decode(new Uint8Array(meta)));
            if (title !== undefined && title !== last) {
              last = title;
              onTitle(title);
            }
            mode = 'audio';
            audioLeft = interval;
          }
        }
      }
    },
  });
}

/** Liest den Titel aus einem Textblock der Form `StreamTitle='Interpret - Titel';…`. */
export function parseTitle(meta: string): string | undefined {
  const match = /StreamTitle='(.*?)';/s.exec(meta);
  return match ? match[1]!.trim() : undefined;
}
