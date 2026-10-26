import type { DatapointValue, PluginContext, SeriesPoint } from '@culinola/sdk';
import { pick } from '../language.ts';
import { hourOf, wobble } from './curves.ts';

/**
 * Das Haus der Demo an Stelle von openHAB: dieselben Items wie in der Küche, mit erfundenen, aber stimmigen
 * Werten. Messwerte folgen dem Tagesgang – dieselbe Formel liefert Live-Wert und Verlauf –, Lichter lassen
 * sich schalten und die Markise fährt.
 */

const sunUp = (hour: number) => Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI));
const solar = (hour: number, time: number) => (hour < 7 || hour > 19 ? 0 : Math.round(sunUp(hour) * 5200 * (0.82 + wobble(time, 0.12))));
const consumption = (hour: number, time: number) => Math.round(380 + (hour >= 11.5 && hour < 13 ? 1400 : 0) + (hour >= 18 && hour < 20.5 ? 900 : 0) + wobble(time, 110) + 60);
/** Die Batterie lädt tagsüber bis voll und versorgt abends das Haus, bis sie am Morgen fast leer ist. */
const battery = (hour: number) => Math.round(hour < 8 ? 38 - hour * 3 : hour < 16 ? Math.min(100, 14 + (hour - 8) * 14) : Math.max(38, 100 - (hour - 16) * 8));

/** Zahlenwerte mit Tagesgang: Kennung, Einheit, Bezeichnung in openHAB, Verlauf. */
const CURVES: Record<string, { unit?: string; label: string; at(hour: number, time: number): number; digits?: number }> = {
  Mess_TWohnen: { unit: '°C', label: pick({ de: 'Temperatur Wohnen', en: 'Living room temperature' }), at: (h, t) => 21.4 + 0.8 * Math.sin(((h - 10) / 24) * 2 * Math.PI) + wobble(t, 0.12) },
  Mess_RWohnen: { label: pick({ de: 'Feuchte Wohnen', en: 'Living room humidity' }), at: (h, t) => 0.47 - 0.03 * Math.sin(((h - 10) / 24) * 2 * Math.PI) + wobble(t, 0.005), digits: 3 },
  Mess_TSchlafen: { unit: '°C', label: pick({ de: 'Temperatur Schlafen', en: 'Bedroom temperature' }), at: (h, t) => 18.6 + 0.6 * Math.sin(((h - 15) / 24) * 2 * Math.PI) + wobble(t, 0.1) },
  Mess_RSchlafen: { label: pick({ de: 'Feuchte Schlafen', en: 'Bedroom humidity' }), at: (h, t) => 0.53 + 0.04 * Math.sin(((h - 3) / 24) * 2 * Math.PI) + wobble(t, 0.005), digits: 3 },
  Mess_TGarage: { unit: '°C', label: pick({ de: 'Temperatur Garage', en: 'Garage temperature' }), at: (h, t) => 12.5 + 2.2 * Math.sin(((h - 11) / 24) * 2 * Math.PI) + wobble(t, 0.15) },
  Mess_RGarage: { label: pick({ de: 'Feuchte Garage', en: 'Garage humidity' }), at: (h, t) => 0.66 - 0.06 * Math.sin(((h - 11) / 24) * 2 * Math.PI) + wobble(t, 0.006), digits: 3 },
  WS_Temperature: { unit: '°C', label: pick({ de: 'Außentemperatur', en: 'Outside temperature' }), at: (h, t) => 9.5 + 5.5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + wobble(t, 0.25) },
  WS_Humidity: { label: pick({ de: 'Außenfeuchte', en: 'Outside humidity' }), at: (h, t) => 0.74 - 0.14 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + wobble(t, 0.01), digits: 3 },
  MultiPPM: { unit: 'ppm', label: pick({ de: 'CO₂ Wohnen', en: 'CO₂ living room' }), at: (h, t) => 560 + (h >= 7 && h < 9 ? 380 : 0) + (h >= 17.5 && h < 22.5 ? 520 : 0) + wobble(t, 30), digits: 0 },
  SenecEnergyProduction: { unit: 'W', label: pick({ de: 'PV-Erzeugung', en: 'Solar production' }), at: solar, digits: 0 },
  SenecHouseConsumption: { unit: 'W', label: pick({ de: 'Hausverbrauch', en: 'House consumption' }), at: consumption, digits: 0 },
  SenecGridPower: { unit: 'W', label: pick({ de: 'Netzbezug', en: 'Grid power' }), at: (h, t) => (battery(h) >= 100 || battery(h) <= 12 ? consumption(h, t) - solar(h, t) : Math.max(0, consumption(h, t) - solar(h, t) - 2500)), digits: 0 },
  SenecBatteryFuelCharge: { unit: '%', label: pick({ de: 'Batterie', en: 'Battery' }), at: battery, digits: 0 },
};

/** Wetterlage der nächsten fünf Tage: Text, Höchst- und Tiefstwert. */
const FORECAST: [string, number, number][] = [
  [pick({ de: 'Überwiegend bewölkt', en: 'Mostly cloudy' }), 15, 5],
  [pick({ de: 'Leichter Regen', en: 'Light rain' }), 12, 6],
  [pick({ de: 'Klarer Himmel', en: 'Clear sky' }), 14, 2],
  [pick({ de: 'Mäßig bewölkt', en: 'Partly cloudy' }), 13, 4],
  [pick({ de: 'Regenschauer', en: 'Showers' }), 11, 5],
];

const SWITCHES: Record<string, [label: string, on: boolean]> = {
  Sonst_Umwaelzpumpe: [pick({ de: 'Warmwasser-Umwälzpumpe', en: 'Hot water circulation pump' }), false],
  Licht_Couchtisch: [pick({ de: 'Licht Couchtisch', en: 'Coffee table light' }), false],
  Licht_Esstisch: [pick({ de: 'Licht Esstisch', en: 'Dining table light' }), true],
  Licht_CouchRechts: [pick({ de: 'Stehleuchte', en: 'Floor lamp' }), true],
  OsramCouch: [pick({ de: 'Couchlicht', en: 'Couch light' }), false],
  Licht_TerrasseSued: [pick({ de: 'Licht Terrasse Süd', en: 'Patio light' }), false],
};

/** Waschmaschine und Spülmaschine: aus (0), läuft (1), fertig (3). Die Waschmaschine wird ein paar Minuten nach dem Öffnen fertig. */
const WASH_MINUTES = 4;

export function startHouse(context: PluginContext<unknown>): void {
  const opened = Date.now();
  const switches = new Map(Object.entries(SWITCHES).map(([id, [, on]]) => [id, on]));
  const awning = { position: 100, target: 100 };
  const set = (id: string, value: DatapointValue, label?: string, unit?: string, writable?: boolean) =>
    context.datapoints.set({ id, value, ...(label ? { label } : {}), ...(unit ? { unit } : {}), ...(writable ? { writable } : {}) });

  const publishAwning = () => set('Terrassendach', awning.position, pick({ de: 'Markise Terrassendach', en: 'Patio awning' }), '%', true);
  const drive = setInterval(() => {
    if (awning.position === awning.target) return;
    awning.position += Math.sign(awning.target - awning.position) * Math.min(5, Math.abs(awning.target - awning.position));
    publishAwning();
  }, 400);

  const publishWeather = (now: number) => {
    const hour = hourOf(now);
    const day = (offset: number, time: string) => {
      const date = new Date(now + offset * 86_400_000);
      const [hours, minutes] = time.split(':').map(Number);
      date.setHours(hours!, minutes!, 0, 0);
      return date.toISOString();
    };
    set('Weather_Temperature', Math.round((9.5 + 5.5 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + wobble(now, 0.2)) * 10) / 10, pick({ de: 'Temperatur', en: 'Temperature' }), '°C');
    set('Condition', FORECAST[0]![0], pick({ de: 'Wetterlage', en: 'Weather' }));
    set('Weather_OWM_ConditionId', 803, pick({ de: 'Wetterkennzahl', en: 'Weather code' }));
    set('Wind_Degree', Math.round(235 + 25 * Math.sin(now / 600_000)), pick({ de: 'Windrichtung', en: 'Wind direction' }), '°');
    set('Weather_OWM_Wind_Speed', Math.round((11 + 5 * Math.sin(now / 300_000)) * 10) / 10, pick({ de: 'Windgeschwindigkeit', en: 'Wind speed' }), 'km/h');
    set('UVIndex', Math.max(0, Math.round(3 * Math.sin(((hour - 8) / 10) * Math.PI))), pick({ de: 'UV-Index', en: 'UV index' }));
    set('sunrise', day(0, '07:02'), pick({ de: 'Sonnenaufgang', en: 'Sunrise' }));
    set('sunset', day(0, '16:51'), pick({ de: 'Sonnenuntergang', en: 'Sunset' }));
    FORECAST.forEach(([text, max, min], index) => {
      set(`Condition_${index}`, text, pick({ de: `Wetterlage Tag ${index}`, en: `Weather day ${index}` }));
      set(index === 0 ? 'Weather_Temp_Max' : `Temp_Max_${index}`, max, pick({ de: `Höchstwert Tag ${index}`, en: `High day ${index}` }), '°C');
      set(index === 0 ? 'Weather_Temp_Min' : `Temp_Min_${index}`, min, pick({ de: `Tiefstwert Tag ${index}`, en: `Low day ${index}` }), '°C');
    });
  };

  const publish = () => {
    const now = Date.now();
    for (const [id, curve] of Object.entries(CURVES)) {
      const factor = 10 ** (curve.digits ?? 1);
      set(id, Math.round(curve.at(hourOf(now), now) * factor) / factor, curve.label, curve.unit);
    }
    set('Waschmaschine_An', now - opened < WASH_MINUTES * 60_000 ? 1 : 3, pick({ de: 'Waschmaschine', en: 'Washing machine' }));
    set('Spuele_An', hourOf(now) >= 19.5 && hourOf(now) < 21.5 ? 1 : 0, pick({ de: 'Spülmaschine', en: 'Dishwasher' }));
    publishWeather(now);
  };

  publish();
  for (const [id, on] of switches) set(id, on, SWITCHES[id]![0], undefined, true);
  publishAwning();
  const timer = setInterval(publish, 5000);
  context.signal.addEventListener('abort', () => {
    clearInterval(timer);
    clearInterval(drive);
  });

  context.onCommand((id, value) => {
    if (id === 'Terrassendach') {
      if (value !== 'up' && value !== 'down' && value !== 'stop') throw new Error('Die Markise versteht nur up, down und stop.');
      awning.target = value === 'up' ? 0 : value === 'down' ? 100 : awning.position;
      return Promise.resolve();
    }
    if (!switches.has(id)) return Promise.reject(new Error(`"${id}" lässt sich nicht schalten.`));
    switches.set(id, value === true);
    set(id, value === true, SWITCHES[id]![0], undefined, true);
    return Promise.resolve();
  });

  context.provideHistory((id, from, to) => {
    const curve = CURVES[id];
    const points: SeriesPoint[] = [];
    if (curve) {
      const factor = 10 ** (curve.digits ?? 1);
      const step = Math.max(60_000, Math.round((to.getTime() - from.getTime()) / 600));
      for (let time = from.getTime(); time <= to.getTime(); time += step) points.push([time, Math.round(curve.at(hourOf(time), time) * factor) / factor]);
    }
    return Promise.resolve(points);
  });

  context.log.info(`Verbunden mit openHAB: ${Object.keys(CURVES).length + Object.keys(SWITCHES).length + 30} Items.`);
}

/** Die Solar-Prognose der Demo: die Erzeugung eines sonnigen Tages, etwas großzügiger als die Messung. */
export function startForecast(context: PluginContext<unknown>): void {
  const at = (time: number) => Math.round(sunUp(hourOf(time)) * 5600);
  const publish = () => {
    const now = Date.now();
    context.datapoints.set({ id: 'power', value: at(now), unit: 'W', label: 'Solar-Prognose: Leistung jetzt' });
    context.datapoints.set({ id: 'today', value: 31.4, unit: 'kWh', label: 'Solar-Prognose: Ertrag heute' });
    context.datapoints.set({ id: 'tomorrow', value: 18.9, unit: 'kWh', label: 'Solar-Prognose: Ertrag morgen' });
  };
  publish();
  const timer = setInterval(publish, 60_000);
  context.signal.addEventListener('abort', () => clearInterval(timer));
  context.provideHistory((id, from, to) => {
    const points: SeriesPoint[] = [];
    if (id === 'power') for (let time = from.getTime(); time <= to.getTime() + 86_400_000; time += 900_000) points.push([time, at(time)]);
    return Promise.resolve(points);
  });
}
