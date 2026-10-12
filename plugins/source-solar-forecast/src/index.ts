import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { definePlugin, explain } from '@culinola/sdk';
import { dayOf, estimateUrl, merge, parseEstimate, powerAt, slice, type Forecast, type Plant } from './forecast.ts';

interface Config extends Plant {
  /** Abstand der Abfragen. Der freie Zugang von forecast.solar erlaubt zwölf in der Stunde. */
  refreshMinutes: number;
  /** Adresse des Dienstes – für einen eigenen Zugang oder zum Testen. */
  url: string;
}

const TICK_MS = 60_000;
const RETRY_MS = 15 * 60_000;
const TIMEOUT_MS = 20_000;

/**
 * Ertragsprognose für die Solaranlage, unabhängig vom Smart-Home-System: forecast.solar rechnet aus
 * Standort, Neigung, Ausrichtung und Leistung die erwartete Leistung für heute und morgen. Das
 * Stromdiagramm zeichnet sie als gestrichelte Linie neben die tatsächliche Erzeugung.
 */
export default definePlugin<Config>({
  id: 'source-solar-forecast',
  name: { de: 'Solarprognose', en: 'Solar forecast' },
  text: { de: 'Ertragsprognose einer Solaranlage von forecast.solar.', en: 'Yield forecast of a solar plant from forecast.solar.' },
  help: { de: 'Die Prognose kommt von https://api.forecast.solar; die Adresse ist fest eingestellt. Der freie Zugang braucht keinen Schlüssel. Neigung und Ausrichtung der Module und die Leistung der Anlage stehen in den Unterlagen der Solaranlage.', en: 'The forecast comes from https://api.forecast.solar; the address is fixed. The free access needs no key. Tilt and orientation of the modules and the power of the plant are found in the documents of the solar plant.' },
  settings: [
    { key: 'latitude', type: 'number', label: { de: 'Breitengrad', en: 'Latitude' }, min: -90, max: 90 },
    { key: 'longitude', type: 'number', label: { de: 'Längengrad', en: 'Longitude' }, min: -180, max: 180 },
    { key: 'declination', type: 'number', label: { de: 'Neigung der Module (Grad)', en: 'Tilt of the modules (degrees)' }, hint: { de: '0 liegt flach, 90 steht senkrecht.', en: '0 is flat, 90 is vertical.' }, min: 0, max: 90 },
    { key: 'azimuth', type: 'number', label: { de: 'Ausrichtung (Grad)', en: 'Orientation (degrees)' }, hint: { de: '0 ist Süden, -90 Osten, 90 Westen.', en: '0 is south, -90 east, 90 west.' }, min: -180, max: 180 },
    { key: 'kwp', type: 'number', label: { de: 'Leistung (kWp)', en: 'Power (kWp)' }, min: 0.1, max: 1000 },
    { key: 'refreshMinutes', type: 'number', label: { de: 'Abruf alle … Minuten', en: 'Fetch every … minutes' }, min: 15, max: 1440, placeholder: 180 },
  ],
  secrets: [
    { key: 'apiKey', label: { de: 'Schlüssel', en: 'API key' }, hint: { de: 'Nur für einen eigenen Zugang; der freie kommt ohne aus.', en: 'Only for a paid account; the free one needs none.' } },
  ],

  parseConfig(raw) {
    const config = raw as Record<string, unknown>;
    const number = (name: string, min: number, max: number, fallback?: number): number => {
      const value = config[name] ?? fallback;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`"${name}" muss eine Zahl von ${min} bis ${max} sein.`);
      return value;
    };
    const url = config['url'] ?? 'https://api.forecast.solar';
    if (typeof url !== 'string' || !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('"url" muss die Adresse des Prognosedienstes sein.');
    return {
      latitude: number('latitude', -90, 90),
      longitude: number('longitude', -180, 180),
      declination: number('declination', 0, 90),
      azimuth: number('azimuth', -180, 180),
      kwp: number('kwp', 0.1, 1000),
      refreshMinutes: number('refreshMinutes', 15, 1440, 180),
      url,
    };
  },

  start(context) {
    const { log, config } = context;
    const file = join(context.storageDir, 'forecast.json');
    let forecast: Forecast | undefined;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Forecast;
      if (Array.isArray(saved.points) && typeof saved.fetched === 'number') forecast = saved;
    } catch {
      // Beim ersten Start gibt es noch keine gespeicherte Prognose.
    }

    const publish = () => {
      const now = Date.now();
      const points = forecast?.points ?? [];
      const kwh = (day: string) => (forecast?.days[day] === undefined ? null : Math.round(forecast.days[day]! / 100) / 10);
      context.datapoints.set({ id: 'power', value: forecast ? powerAt(points, now) : null, unit: 'W', label: 'Solar-Prognose: Leistung jetzt', quality: forecast ? 'good' : 'error' });
      context.datapoints.set({ id: 'today', value: kwh(dayOf(now)), unit: 'kWh', label: 'Solar-Prognose: Ertrag heute' });
      context.datapoints.set({ id: 'tomorrow', value: kwh(dayOf(now + 86_400_000)), unit: 'kWh', label: 'Solar-Prognose: Ertrag morgen' });
    };

    // Ohne eigenen Schlüssel gilt der freie Zugang des Dienstes; mit ihm die Grenzen des gebuchten Tarifs
    const apiKey = context.secrets.get('apiKey');
    if (apiKey && !/^[A-Za-z0-9]{16}$/.test(apiKey)) log.warn('Der Schlüssel für forecast.solar hat nicht die erwartete Form (16 Buchstaben und Ziffern).');
    let trouble = '';
    const load = async (): Promise<boolean> => {
      try {
        const response = await fetch(estimateUrl(config, config.url, apiKey), { headers: { Accept: 'application/json' }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
        if (response.status === 429) throw new Error('forecast.solar nimmt gerade keine weiteren Abfragen an.');
        if (!response.ok) throw new Error(`forecast.solar antwortet mit Fehler ${response.status}.`);
        forecast = merge(forecast, parseEstimate(await response.json(), Date.now()));
        try {
          mkdirSync(context.storageDir, { recursive: true });
          writeFileSync(file, JSON.stringify(forecast));
        } catch {
          // Ohne gespeicherte Prognose wird sie nach einem Neustart eben neu geholt.
        }
        if (trouble) log.info('Solar-Prognose wieder abrufbar.');
        trouble = '';
        context.datapoints.set({ id: 'updated', value: new Date(forecast.fetched).toISOString(), label: 'Solar-Prognose: letzter Abruf' });
        publish();
        return true;
      } catch (error) {
        if (context.signal.aborted) return false;
        const message = explain(error);
        if (message !== trouble) log.warn(`Solar-Prognose nicht abrufbar: ${message}`);
        trouble = message;
        return false;
      }
    };

    publish();
    let timer: NodeJS.Timeout | undefined;
    const cycle = async () => {
      // Eine frische Prognose aus dem Speicher wird nach einem Neustart nicht gleich neu geholt
      const age = forecast ? Date.now() - forecast.fetched : Infinity;
      const due = config.refreshMinutes * 60_000;
      const ok = age < due ? true : await load();
      if (!context.signal.aborted) timer = setTimeout(() => void cycle(), ok ? Math.max(TICK_MS, due - (forecast ? Date.now() - forecast.fetched : 0)) : RETRY_MS);
    };
    void cycle().then(() => {
      if (forecast) log.info(`Solar-Prognose: heute ${Math.round((forecast.days[dayOf(Date.now())] ?? 0) / 100) / 10} kWh erwartet.`);
    });
    // Der Wert „jetzt“ wandert mit der Uhr an der Kurve entlang
    const tick = setInterval(publish, TICK_MS);
    context.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      clearInterval(tick);
    });

    context.provideHistory((id, from, to) => Promise.resolve(id === 'power' && forecast ? slice(forecast.points, from.getTime(), to.getTime()) : []));
  },
});
