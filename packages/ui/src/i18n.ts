import { THEME_NAME } from '@culinola/sdk';
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
/** Was die Konfiguration für alle Anzeigen nennt und was das gezeigte Layout selbst nennt – das Layout geht vor. */
type Pair = { day?: string | undefined; night?: string | undefined };
const configured: { site: Pair; layout: Pair } = { site: {}, layout: {} };
let daylight = true;
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

/** Stellt das Farbschema ein, das für alle Anzeigen gilt. */
export function applyTheme(theme: string | undefined, night?: string): void {
  configured.site = { day: theme, night };
  resolveTheme();
}

/** Stellt das Farbschema ein, das das gezeigte Layout selbst nennt – etwa ein wohnlicheres für die Küche als für den Flur. */
export function applyLayoutTheme(theme: string | undefined, night: string | undefined): void {
  configured.layout = { day: theme, night };
  resolveTheme();
}

/**
 * Welches Schema gilt: Der Adresszusatz ?theme=name geht vor – so lässt sich ein Schema an einer Anzeige ausprobieren,
 * ohne etwas umzustellen –, dann das Layout, dann die Einstellung für alle. Ob gerade Tag oder Nacht ist, bleibt dabei.
 */
function resolveTheme(): void {
  const query = new URLSearchParams(location.search);
  const valid = (name: string | null | undefined) => (name && THEME_NAME.test(name) ? name : undefined);
  themes.day = valid(query.get('theme') ?? configured.layout.day ?? configured.site.day);
  // Mit ?night=name wechselt diese Anzeige nachts das Schema, auch wenn die Konfiguration keines nennt
  themes.night = valid(query.get('night') ?? configured.layout.night ?? configured.site.night);
  nightTheme.value = themes.night;
  setDaylight(daylight);
}

/** Stellt das Schema für Tag oder Nacht ein. Ohne eigenes Schema für die Nacht bleibt es beim Tag. */
export function setDaylight(day: boolean): void {
  daylight = day;
  const wanted = day ? themes.day : (themes.night ?? themes.day);
  if (wanted) document.documentElement.dataset['theme'] = wanted;
  else delete document.documentElement.dataset['theme'];
}
