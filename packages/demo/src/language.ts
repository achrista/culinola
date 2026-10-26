/**
 * Die Sprache der Demo – Oberfläche und Beispieldaten zugleich. Die Webseite nennt sie in der Adresse
 * (`?lang=en`); ohne Angabe entscheidet der Browser: Deutsch für deutschsprachige Besucher, sonst Englisch.
 */
export type Language = 'de' | 'en';

export const language: Language = (() => {
  const wanted = new URLSearchParams(location.search).get('lang');
  if (wanted === 'de' || wanted === 'en') return wanted;
  return (navigator.language ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
})();

/** Der Text in der Sprache der Demo. */
export function pick<T>(texts: Record<Language, T>): T {
  return texts[language];
}

/** Texte des Küchenlayouts auf Englisch; was hier nicht steht, bleibt, wie es ist (Namen, Kennungen). */
const LAYOUT_EN: Record<string, string> = {
  Haustür: 'Front door',
  'Garten / Süd': 'Garden / south',
  Wohnen: 'Living room',
  Schlafen: 'Bedroom',
  Außen: 'Outside',
  Temperatur: 'Temperature',
  'CO₂ Wohnen': 'CO₂ living room',
  Waschen: 'Washer',
  Spülen: 'Dishwasher',
  aus: 'off',
  läuft: 'running',
  fertig: 'done',
  Batterie: 'Battery',
  Strom: 'Power',
  'PV-Erzeugung': 'Solar',
  Verbrauch: 'Usage',
  Netz: 'Grid',
  Prognose: 'Forecast',
  Warmwasser: 'Hot water',
  Glastisch: 'Glass table',
  Esstisch: 'Dining table',
  Stehleuchte: 'Floor lamp',
  Couchlicht: 'Couch light',
  Terrasse: 'Patio',
  Markise: 'Awning',
  rein: 'in',
  raus: 'out',
  'Einkaufsliste Merkio': 'Shopping list',
  'hallo kueche': 'hello kitchen',
};

/** Englische Feeds, die der Browser direkt lesen darf, an Stelle der deutschen. */
const FEEDS_EN: Record<string, string> = { 'dw-de': 'dw-en', 'augsburger-allgemeine': 'dw-en', tagesschau: 'dw-germany' };

/** Das Layout in der Sprache der Demo: Beschriftungen übersetzt, Nachrichten aus englischen Feeds. */
export function localizeLayout<T>(layout: T): T {
  if (language === 'de') return layout;
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') return key === 'feeds' ? (FEEDS_EN[value] ?? value) : (LAYOUT_EN[value] ?? value);
    if (Array.isArray(value)) {
      const entries = value.map((entry) => walk(entry, key));
      return key === 'feeds' ? [...new Set(entries)] : entries;
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, walk(entry, name)]));
    return value;
  };
  return walk(layout) as T;
}
