import { ref } from 'vue';
import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';

/** Mitgelieferte Sprachen der Oberfläche. Eine weitere Sprache ist eine weitere Datei in `locales/`. */
const messages = { de, en };
export type Language = keyof typeof messages;
const FALLBACK: Language = 'en';

export const i18n = createI18n({ legacy: false, locale: 'de', fallbackLocale: FALLBACK, messages });

/**
 * Region für Zahlen, Datum und Uhrzeit, z. B. "de-DE" oder "en-GB". Sie ist von der
 * Sprache getrennt: Englische Texte mit deutschem Datumsformat sind eine gültige Wahl.
 */
export const region = ref(navigator.language || 'de-DE');

export interface SiteSettings {
  language?: string;
  region?: string;
  /** Farbschema der Anzeige, etwa "glut"; ohne Angabe „Klar“. */
  theme?: string;
  /** Farbschema für die Nacht: Geht die Sonne unter, wechselt die Anzeige dorthin – und am Morgen zurück. */
  nightTheme?: string;
  /** Die Quelle, die sagt, ob Tag ist; ohne Angabe "astro". */
  astro?: string;
}

/**
 * Stellt Sprache und Region ein. Ohne Vorgabe gilt die Sprache des Browsers;
 * eine nicht mitgelieferte Sprache fällt auf Englisch zurück.
 */
const themes: { day?: string | undefined; night?: string | undefined } = {};
/** Das Schema für die Nacht, wenn eines gewählt ist – dann beobachtet die Anzeige den Sonnenstand. */
export const nightTheme = ref<string | undefined>();
export const astroSource = ref('astro');

export function applySite(site: SiteSettings): void {
  const wanted = (site.language ?? navigator.language ?? FALLBACK).toLowerCase().split('-')[0]!;
  const language: Language = wanted in messages ? (wanted as Language) : FALLBACK;
  i18n.global.locale.value = language;
  region.value = site.region ?? (site.language ? site.language : navigator.language) ?? language;
  document.documentElement.lang = language;
  applyTheme(site.theme, site.nightTheme);
  astroSource.value = site.astro ?? 'astro';
}

/**
 * Stellt das Farbschema ein. Der Adresszusatz ?theme=name geht der Konfiguration vor –
 * so lässt sich ein Schema an einer Anzeige ausprobieren, ohne etwas umzustellen.
 */
export function applyTheme(configured: string | undefined, configuredNight?: string): void {
  const query = new URLSearchParams(location.search);
  const valid = (name: string | null | undefined) => (name && /^[a-z][a-z0-9-]*$/.test(name) ? name : undefined);
  themes.day = valid(query.get('theme') ?? configured);
  // Mit ?night=name wechselt diese Anzeige nachts das Schema, auch wenn die Konfiguration keines nennt
  themes.night = valid(query.get('night') ?? configuredNight);
  nightTheme.value = themes.night;
  setDaylight(true);
}

/** Stellt das Schema für Tag oder Nacht ein. Ohne eigenes Schema für die Nacht bleibt es beim Tag. */
export function setDaylight(day: boolean): void {
  const wanted = day ? themes.day : (themes.night ?? themes.day);
  if (wanted) document.documentElement.dataset['theme'] = wanted;
  else delete document.documentElement.dataset['theme'];
}
