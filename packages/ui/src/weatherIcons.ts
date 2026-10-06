import clearDay from '@bybas/weather-icons/production/fill/all/clear-day.svg?raw';
import clearNight from '@bybas/weather-icons/production/fill/all/clear-night.svg?raw';
import cloudy from '@bybas/weather-icons/production/fill/all/cloudy.svg?raw';
import drizzle from '@bybas/weather-icons/production/fill/all/drizzle.svg?raw';
import fog from '@bybas/weather-icons/production/fill/all/fog.svg?raw';
import mist from '@bybas/weather-icons/production/fill/all/mist.svg?raw';
import notAvailable from '@bybas/weather-icons/production/fill/all/not-available.svg?raw';
import overcast from '@bybas/weather-icons/production/fill/all/overcast.svg?raw';
import partlyCloudyDay from '@bybas/weather-icons/production/fill/all/partly-cloudy-day.svg?raw';
import partlyCloudyNight from '@bybas/weather-icons/production/fill/all/partly-cloudy-night.svg?raw';
import rain from '@bybas/weather-icons/production/fill/all/rain.svg?raw';
import sleet from '@bybas/weather-icons/production/fill/all/sleet.svg?raw';
import snow from '@bybas/weather-icons/production/fill/all/snow.svg?raw';
import thunderstormsRain from '@bybas/weather-icons/production/fill/all/thunderstorms-rain.svg?raw';
import type { WeatherIcon } from './weather.ts';

/** Die Wettersymbole stammen aus dem Satz Meteocons von Bas Milius (MIT). */
const SOURCES: Record<WeatherIcon, string> = {
  'clear-day': clearDay,
  'clear-night': clearNight,
  'partly-cloudy-day': partlyCloudyDay,
  'partly-cloudy-night': partlyCloudyNight,
  cloudy,
  overcast,
  drizzle,
  rain,
  sleet,
  snow,
  'thunderstorms-rain': thunderstormsRain,
  fog,
  mist,
  'not-available': notAvailable,
};

const urls = new Map<WeatherIcon, string>();

/**
 * Adresse eines Wettersymbols für ein Bildelement. Die Symbole des Satzes bewegen sich;
 * für eine ruhige Anzeige – und einen ruhigen Rechner – werden die Bewegungen entfernt.
 */
export function weatherIconUrl(name: WeatherIcon): string {
  let url = urls.get(name);
  if (!url) {
    const still = SOURCES[name].replace(/<animate(?:Transform|Motion)?\b[^>]*\/>/g, '');
    url = `data:image/svg+xml,${encodeURIComponent(still)}`;
    urls.set(name, url);
  }
  return url;
}
