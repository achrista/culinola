/** Name eines Wettersymbols aus dem mitgelieferten Satz. */
export type WeatherIcon =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'overcast'
  | 'drizzle'
  | 'rain'
  | 'sleet'
  | 'snow'
  | 'thunderstorms-rain'
  | 'fog'
  | 'mist'
  | 'not-available';

const byTime = (night: boolean, day: WeatherIcon, atNight: WeatherIcon): WeatherIcon => (night ? atNight : day);

/** Symbol zu einer Wetterkennzahl von OpenWeatherMap (200–804). */
function fromNumber(code: number, night: boolean): WeatherIcon | undefined {
  if (code >= 200 && code < 300) return 'thunderstorms-rain';
  if (code >= 300 && code < 400) return 'drizzle';
  if (code === 511 || (code >= 611 && code <= 616)) return 'sleet';
  if (code >= 500 && code < 600) return 'rain';
  if (code >= 600 && code < 700) return 'snow';
  if (code === 741) return 'fog';
  if (code >= 700 && code < 800) return 'mist';
  if (code === 800) return byTime(night, 'clear-day', 'clear-night');
  if (code === 801 || code === 802) return byTime(night, 'partly-cloudy-day', 'partly-cloudy-night');
  if (code === 803) return 'cloudy';
  if (code === 804) return 'overcast';
  return undefined;
}

/** Symbol zu einer Symbolkennung von OpenWeatherMap ("01d" … "50n"); sie nennt die Tageszeit selbst. */
function fromIconId(id: string): WeatherIcon | undefined {
  const night = id.endsWith('n');
  switch (id.slice(0, 2)) {
    case '01':
      return byTime(night, 'clear-day', 'clear-night');
    case '02':
      return byTime(night, 'partly-cloudy-day', 'partly-cloudy-night');
    case '03':
      return 'cloudy';
    case '04':
      return 'overcast';
    case '09':
    case '10':
      return 'rain';
    case '11':
      return 'thunderstorms-rain';
    case '13':
      return 'snow';
    case '50':
      return 'mist';
    default:
      return undefined;
  }
}

/** Stichwörter in deutschen und englischen Wetterbeschreibungen; die Reihenfolge entscheidet bei Mischformen. */
const WORDS: [RegExp, WeatherIcon | 'clear' | 'partly'][] = [
  [/gewitter|thunder/, 'thunderstorms-rain'],
  [/schneeregen|graupel|eisregen|sleet|freezing/, 'sleet'],
  [/schnee|snow/, 'snow'],
  [/niesel|sprüh|drizzle/, 'drizzle'],
  [/regen|schauer|rain|shower/, 'rain'],
  [/nebel|fog/, 'fog'],
  [/dunst|trüb|mist|haze|smoke|rauch/, 'mist'],
  [/bedeckt|overcast/, 'overcast'],
  [/überwiegend bewölkt|stark bewölkt|broken clouds|mostly cloudy/, 'cloudy'],
  [/ein paar wolken|leicht bewölkt|mäßig bewölkt|aufgelockert|wolkig|heiter|few clouds|scattered|partly/, 'partly'],
  [/bewölkt|wolken|cloud/, 'cloudy'],
  [/klar|sonnig|clear|sunny|fair/, 'clear'],
];

function fromText(text: string, night: boolean): WeatherIcon | undefined {
  const lower = text.toLowerCase();
  const hit = WORDS.find(([pattern]) => pattern.test(lower))?.[1];
  if (hit === 'clear') return byTime(night, 'clear-day', 'clear-night');
  if (hit === 'partly') return byTime(night, 'partly-cloudy-day', 'partly-cloudy-night');
  return hit;
}

/**
 * Wählt das Symbol für eine Wetterlage. Eine Kennzahl oder Symbolkennung von
 * OpenWeatherMap gilt vor dem Beschreibungstext, weil sie eindeutig ist.
 */
export function weatherIcon(code: unknown, text: unknown, night = false): WeatherIcon {
  const key = typeof code === 'number' ? String(code) : typeof code === 'string' ? code.trim() : '';
  const known = /^\d\d[dn]$/.test(key) ? fromIconId(key) : /^\d{3}$/.test(key) ? fromNumber(Number(key), night) : undefined;
  return known ?? (typeof text === 'string' && text ? fromText(text, night) : undefined) ?? 'not-available';
}

/** Ob es zu einem Zeitpunkt Nacht ist – nach Sonnenauf- und -untergang desselben Tages. */
export function isNight(now: number, sunrise: unknown, sunset: unknown): boolean {
  const rise = typeof sunrise === 'string' ? Date.parse(sunrise) : Number.NaN;
  const set = typeof sunset === 'string' ? Date.parse(sunset) : Number.NaN;
  if (Number.isNaN(rise) || Number.isNaN(set)) return false;
  // Die Quelle nennt die Zeiten eines Tages; verglichen wird nur die Uhrzeit, damit ein veralteter Wert nicht stört.
  const minutes = (time: number) => new Date(time).getHours() * 60 + new Date(time).getMinutes();
  return minutes(now) < minutes(rise) || minutes(now) >= minutes(set);
}

/** Nummer der Himmelsrichtung, aus der der Wind kommt: 0 = Nord, 1 = Nordost … 7 = Nordwest. */
export function compassPoint(degrees: number): number {
  return Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
}

/** Windstärke nach Beaufort aus der Geschwindigkeit in km/h. */
export function beaufort(kmh: number): number {
  const LIMITS = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  const index = LIMITS.findIndex((limit) => kmh < limit);
  return index < 0 ? 12 : index;
}

/** Rechnet eine Windgeschwindigkeit in km/h um; ohne bekannte Einheit gilt sie schon als km/h. */
export function toKmh(value: number, unit: string | undefined): number {
  switch ((unit ?? '').toLowerCase().replace(/\s/g, '')) {
    case 'm/s':
      return value * 3.6;
    case 'mph':
      return value * 1.609344;
    case 'kn':
    case 'kt':
      return value * 1.852;
    default:
      return value;
  }
}

export type UvLevel = 'low' | 'moderate' | 'high' | 'veryHigh' | 'extreme';

/** Gefahrenstufe des UV-Index nach der Einteilung der Weltgesundheitsorganisation. */
export function uvLevel(index: number): UvLevel {
  const rounded = Math.round(index);
  if (rounded <= 2) return 'low';
  if (rounded <= 5) return 'moderate';
  if (rounded <= 7) return 'high';
  if (rounded <= 10) return 'veryHigh';
  return 'extreme';
}
