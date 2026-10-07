import geo from 'libphonenumber-geo-carrier';
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** Bezeichnungen für Nummern, die zu keinem Ort gehören. */
const KINDS: Record<string, Record<string, string>> = {
  de: { MOBILE: 'Mobilfunk', TOLL_FREE: 'kostenlose Rufnummer', PREMIUM_RATE: 'Sonderrufnummer', SHARED_COST: 'Servicerufnummer', UAN: 'Servicerufnummer', VOIP: 'Internettelefonie', PERSONAL_NUMBER: 'persönliche Rufnummer' },
  en: { MOBILE: 'mobile', TOLL_FREE: 'toll-free number', PREMIUM_RATE: 'premium-rate number', SHARED_COST: 'service number', UAN: 'service number', VOIP: 'internet telephony', PERSONAL_NUMBER: 'personal number' },
};

const known = new Map<string, string>();

/**
 * Woher eine Rufnummer kommt: bei Nummern aus dem eigenen Land der Ort des Ortsnetzes
 * („Augsburg“), bei ausländischen Ort und Land („Wien, Österreich“). Gehört die Nummer zu
 * keinem Ort, steht dort, was für eine sie ist („Mobilfunk“). Leer, wenn sich nichts sagen lässt.
 *
 * @param country eigenes Land als Kürzel ("DE") – danach werden Nummern ohne Ländervorwahl gelesen
 * @param language Sprache der Ortsnamen ("de", "en")
 */
export async function placeOf(number: string, country: string, language: string): Promise<string> {
  const key = `${country}|${language}|${number}`;
  const cached = known.get(key);
  if (cached !== undefined) return cached;

  let place = '';
  try {
    const phone = parsePhoneNumberFromString(number, country.toUpperCase() as CountryCode);
    if (phone?.country && phone.isPossible()) {
      const land = new Intl.DisplayNames([language], { type: 'region' }).of(phone.country) ?? phone.country;
      const locale = language as Parameters<typeof geo.geocoder>[1];
      // Nicht jeder Ort hat einen Namen in jeder Sprache; dann gilt der englische
      let town = (await geo.geocoder(phone, locale).catch(() => null)) ?? (await geo.geocoder(phone, 'en').catch(() => null)) ?? '';
      // Manche Vorwahlen kennt das Verzeichnis nur als „Deutschland“ – das ist kein Ort
      if (town === land || town === new Intl.DisplayNames(['en'], { type: 'region' }).of(phone.country)) town = '';
      const kind = (KINDS[language] ?? KINDS.en!)[phone.getType() ?? ''] ?? '';
      const where = town || kind;
      place = phone.country === country.toUpperCase() ? where : [where, land].filter(Boolean).join(', ');
    }
  } catch {
    // Eine unlesbare Nummer hat keine Herkunft
  }
  known.set(key, place);
  return place;
}
