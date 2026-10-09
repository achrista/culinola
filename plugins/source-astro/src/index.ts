import { definePlugin } from '@culinola/sdk';
import { isNight, moon, moonPhaseName, sunPosition, sunTimes } from './astro.ts';

interface Config {
  latitude: number;
  longitude: number;
  /**
   * So viele Minuten nach Sonnenuntergang beginnt für die Anzeige die Nacht, und so viele vor Sonnenaufgang
   * endet sie – daran hängt der Wechsel auf das Nachtschema. Negative Werte ziehen ihn in den Tag hinein.
   */
  nightOffsetMinutes: number;
}

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Sonne und Mond für den eigenen Standort, gerechnet im Kern – ohne Dienst von außen. Die Kachel
 * `sun-moon` zeichnet daraus den Tageslauf; der Datenpunkt `night` lässt die Anzeige abends auf ein
 * dunkles Farbschema wechseln.
 */
export default definePlugin<Config>({
  id: 'source-astro',

  parseConfig(raw) {
    const config = raw as { latitude?: unknown; longitude?: unknown; nightOffsetMinutes?: unknown };
    const offset = config.nightOffsetMinutes ?? 30;
    if (typeof offset !== 'number' || !Number.isFinite(offset) || Math.abs(offset) > 180) throw new Error('"nightOffsetMinutes" muss eine Zahl von -180 bis 180 sein.');
    const number = (name: 'latitude' | 'longitude', limit: number): number => {
      const value = config[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) throw new Error(`"${name}" muss eine Zahl von ${-limit} bis ${limit} sein.`);
      return value;
    };
    return { latitude: number('latitude', 90), longitude: number('longitude', 180), nightOffsetMinutes: offset };
  },

  start(context) {
    const { latitude, longitude } = context.config;
    const iso = (time: number | undefined) => (time === undefined ? '' : new Date(time).toISOString());

    const publish = () => {
      const now = Date.now();
      const today = sunTimes(now, latitude, longitude);
      const position = sunPosition(now, latitude, longitude);
      const set = (id: string, value: string | number | boolean, label: string, unit?: string) => context.datapoints.set({ id, value, label, ...(unit ? { unit } : {}) });

      // Tag ist, solange die Sonne über dem Horizont steht – auch dort, wo sie nicht auf- oder untergeht
      set('day', position.altitude > -0.833, 'Es ist Tag');
      // Nacht für die Anzeige: um den eingestellten Abstand später als der Untergang, früher als der Aufgang
      set('night', isNight(now, today, context.config.nightOffsetMinutes, position.altitude), 'Nacht für die Anzeige (Nachtschema)');
      set('sunrise', iso(today.sunrise), 'Sonnenaufgang');
      set('sunset', iso(today.sunset), 'Sonnenuntergang');
      set('dawn', iso(today.dawn), 'Beginn der Dämmerung');
      set('dusk', iso(today.dusk), 'Ende der Dämmerung');
      set('noon', iso(today.noon), 'Sonnenhöchststand');
      // Für die Nacht: der Aufgang des nächsten und der Untergang des vorigen Tages
      set('nextSunrise', iso(sunTimes(now + DAY_MS, latitude, longitude).sunrise), 'Sonnenaufgang morgen');
      set('previousSunset', iso(sunTimes(now - DAY_MS, latitude, longitude).sunset), 'Sonnenuntergang gestern');
      set('dayLength', today.sunrise !== undefined && today.sunset !== undefined ? Math.round((today.sunset - today.sunrise) / 60_000) : position.altitude > 0 ? 1440 : 0, 'Tageslänge', 'min');
      set('sunAltitude', Math.round(position.altitude * 10) / 10, 'Sonnenhöhe', '°');
      set('sunAzimuth', Math.round(position.azimuth), 'Sonnenrichtung', '°');

      const lunar = moon(now);
      set('moonPhase', Math.round(lunar.phase * 1000) / 1000, 'Mondphase (0 Neumond, 0,5 Vollmond)');
      set('moonIllumination', Math.round(lunar.illumination * 100), 'Mond: beleuchteter Anteil', '%');
      set('moonName', moonPhaseName(lunar.phase), 'Mondphase');
    };

    publish();
    const timer = setInterval(publish, TICK_MS);
    context.signal.addEventListener('abort', () => clearInterval(timer));
  },
});
