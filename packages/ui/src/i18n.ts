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
}

/**
 * Stellt Sprache und Region ein. Ohne Vorgabe gilt die Sprache des Browsers;
 * eine nicht mitgelieferte Sprache fällt auf Englisch zurück.
 */
export function applySite(site: SiteSettings): void {
  const wanted = (site.language ?? navigator.language ?? FALLBACK).toLowerCase().split('-')[0]!;
  const language: Language = wanted in messages ? (wanted as Language) : FALLBACK;
  i18n.global.locale.value = language;
  region.value = site.region ?? (site.language ? site.language : navigator.language) ?? language;
  document.documentElement.lang = language;
}
