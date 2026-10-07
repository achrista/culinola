/** Abschnitte einer RTF-Datei, die keinen lesbaren Text enthalten: Schriften, Farben, Bilder, Kopfdaten. */
const SILENT = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'listtable', 'listoverridetable', 'rsidtbl', 'xmlnstbl', 'fldinst', 'filetbl', 'revtbl']);

/** Steuerwörter, die für ein Zeichen stehen. */
const SIGNS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n',
  page: '\n',
  row: '\n',
  tab: '\t',
  cell: '\t',
  emdash: '—',
  endash: '–',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  bullet: '•',
  emspace: ' ',
  enspace: ' ',
};

const western = new TextDecoder('windows-1252');

/**
 * Liest den Text aus einer Nachricht im Rich-Text-Format. Übrig bleibt der reine Text mit
 * seinen Absätzen; Schriftarten, Farben und Bilder fallen weg.
 */
export function rtfToText(rtf: string): string {
  let out = '';
  // Je geschweifter Klammer eine Ebene: ob sie stumm ist und wie viele Ersatzzeichen einem Unicode-Zeichen folgen
  const levels: { silent: boolean; fallback: number }[] = [{ silent: false, fallback: 1 }];
  let skip = 0;
  const top = () => levels[levels.length - 1]!;
  const emit = (text: string) => {
    if (skip > 0) skip--;
    else if (!top().silent) out += text;
  };

  for (let at = 0; at < rtf.length; at++) {
    const char = rtf[at]!;
    if (char === '{') {
      levels.push({ ...top() });
    } else if (char === '}') {
      if (levels.length > 1) levels.pop();
    } else if (char === '\r' || char === '\n') {
      // Zeilenumbrüche der Datei selbst bedeuten nichts; Absätze stehen als Steuerwort da
    } else if (char !== '\\') {
      emit(char);
    } else {
      const next = rtf[++at] ?? '';
      if (next === '\\' || next === '{' || next === '}') emit(next);
      else if (next === '~') emit(' ');
      else if (next === '_') emit('-');
      else if (next === '-' || next === '|' || next === ':') continue;
      else if (next === '*') top().silent = true;
      else if (next === "'") {
        emit(western.decode(new Uint8Array([Number.parseInt(rtf.slice(at + 1, at + 3), 16) || 63])));
        at += 2;
      } else if (/[a-z]/i.test(next)) {
        const word = /^([a-z]+)(-?\d+)?[ ]?/i.exec(rtf.slice(at))!;
        at += word[0].length - 1;
        const name = word[1]!;
        const value = word[2] === undefined ? undefined : Number(word[2]);
        if (SILENT.has(name)) top().silent = true;
        else if (name === 'uc') top().fallback = value ?? 1;
        else if (name === 'u' && value !== undefined) {
          // Ein Unicode-Zeichen; danach folgen Ersatzzeichen für alte Programme, die übersprungen werden
          if (!top().silent) out += String.fromCharCode(value < 0 ? value + 65536 : value);
          skip = top().fallback;
        } else if (name === 'bin' && value) at += value;
        else if (SIGNS[name]) emit(SIGNS[name]);
      }
    }
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
