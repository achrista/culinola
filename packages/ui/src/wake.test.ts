import { describe, expect, it } from 'vitest';
import { afterWakeWord } from './wake.ts';

describe('Aktivierungswort', () => {
  it('findet das Wort und gibt zurück, was danach gesagt wurde', () => {
    expect(afterWakeWord('computer stell die eieruhr auf acht minuten', 'computer')).toEqual({ woke: true, command: 'stell die eieruhr auf acht minuten' });
    expect(afterWakeWord('na gut computer setz milch auf die einkaufsliste', 'Computer')).toEqual({ woke: true, command: 'setz milch auf die einkaufsliste' });
    expect(afterWakeWord('  Computer  ', 'computer')).toEqual({ woke: true, command: '' });
  });

  it('nimmt das letzte Vorkommen, wenn das Wort mehrmals fällt', () => {
    expect(afterWakeWord('computer ach nein computer radio aus', 'computer')).toEqual({ woke: true, command: 'radio aus' });
    expect(afterWakeWord('computer licht an computer', 'computer')).toEqual({ woke: true, command: '' });
  });

  it('versteht ein Aktivierungswort aus mehreren Wörtern', () => {
    expect(afterWakeWord('ach hallo küche spiel bayern zwei', 'Hallo Küche')).toEqual({ woke: true, command: 'spiel bayern zwei' });
    expect(afterWakeWord('hallo in der küche', 'hallo küche')).toEqual({ woke: false, command: '' });
  });

  it('nimmt Umlaute in beiden Schreibweisen und stört sich nicht an Satzzeichen', () => {
    expect(afterWakeWord('hallo küche stell die eieruhr auf fünf minuten', 'hallo kueche')).toEqual({ woke: true, command: 'stell die eieruhr auf fünf minuten' });
    expect(afterWakeWord('hallo kueche radio aus', 'Hallo Küche')).toEqual({ woke: true, command: 'radio aus' });
    expect(afterWakeWord('hallo küche', 'Hallo, Küche!')).toEqual({ woke: true, command: '' });
    expect(afterWakeWord('in der küche riecht es gut hallo ist da jemand', 'hallo kueche')).toEqual({ woke: false, command: '' });
  });

  it('springt nicht auf ähnliche Wörter an', () => {
    for (const text of ['die kommode steht im flur', 'der computerraum ist zu', 'wir kochen heute nudeln', '']) expect(afterWakeWord(text, 'computer'), text).toEqual({ woke: false, command: '' });
    expect(afterWakeWord('computer', '')).toEqual({ woke: false, command: '' });
  });
});
