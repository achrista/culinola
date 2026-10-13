/** Klein geschrieben und ohne Akzente: aus „Käse“ wird „kase“, aus „Crème“ wird „creme“. */
function plain(text: string): string {
  return text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');
}

/** Wie `plain`, aber mit ausgeschriebenen Umlauten: aus „Käse“ wird „kaese“. */
function spelledOut(text: string): string {
  return plain(text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'));
}

/**
 * Passt die Suche zu einem der Texte? Jedes Wort der Suche muss vorkommen, gleich in welchem Text und an welcher
 * Stelle. Groß- und Kleinschreibung und Akzente zählen nicht, Umlaute dürfen ausgeschrieben sein oder fehlen –
 * eine Bildschirmtastatur hat sie nicht immer zur Hand.
 */
export function matches(query: string, texts: readonly (string | undefined)[]): boolean {
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const given = texts.filter((text): text is string => !!text).join(' ');
  const hay = `${plain(given)} ${spelledOut(given)}`;
  return words.every((word) => hay.includes(plain(word)) || hay.includes(spelledOut(word)));
}
