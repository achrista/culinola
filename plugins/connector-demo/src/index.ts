import { definePlugin, type DatapointValue, type SeriesPoint } from '@culinola/sdk';

const TICK_MS = 5000;

/** Tagesgang als Funktion der Uhrzeit – dieselbe Formel liefert Live-Wert und Verlauf. */
const CURVES: Record<string, { unit: string; label: string; at(hour: number, time: number): number }> = {
  temp_wohnen: { unit: '°C', label: 'Wohnen', at: (h, t) => 21 + 1.2 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + wobble(t, 0.15) },
  feuchte_wohnen: { unit: '%', label: 'Feuchte Wohnen', at: (h, t) => 48 - 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + wobble(t, 0.5) },
  temp_bad: { unit: '°C', label: 'Bad', at: (h, t) => 22.5 + (h >= 6.5 && h < 8 ? 3.5 : 0) + wobble(t, 0.2) },
  temp_aussen: { unit: '°C', label: 'Außen', at: (h, t) => 11 + 5 * Math.sin(((h - 10) / 24) * 2 * Math.PI) + wobble(t, 0.3) },
  co2: { unit: 'ppm', label: 'CO₂', at: (h, t) => 600 + (h >= 18 && h < 23 ? 500 : 0) + wobble(t, 25) },
  verbrauch: { unit: 'W', label: 'Verbrauch', at: (h, t) => 480 + (h >= 18 && h < 21 ? 1100 : 0) + (h >= 12 && h < 13 ? 900 : 0) + wobble(t, 90) },
  solar: { unit: 'W', label: 'Solar', at: (h, t) => (h < 7 || h > 18 ? 0 : Math.max(0, Math.sin(((h - 7) / 11) * Math.PI) * 4200 * (0.85 + wobble(t, 0.1)))) },
  batterie: { unit: '%', label: 'Batterie', at: (h) => Math.round(Math.min(100, Math.max(15, 20 + (h < 7 ? 0 : (h - 7) * 9) - (h > 17 ? (h - 17) * 12 : 0)))) },
};

/** Gleichmäßiges, wiederholbares Rauschen statt Zufall – so passen Verlauf und Live-Wert zusammen. */
function wobble(time: number, amplitude: number): number {
  return amplitude * (Math.sin(time / 97_000) + 0.5 * Math.sin(time / 31_000));
}

function hourOf(time: number): number {
  const date = new Date(time);
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export default definePlugin({
  id: 'connector-demo',

  start(context) {
    const switches = new Map<string, boolean>([
      ['licht_esstisch', true],
      ['licht_vitrine', true],
      ['licht_treppe', false],
      ['licht_terrasse', false],
    ]);

    const publish = () => {
      const now = Date.now();
      for (const [id, curve] of Object.entries(CURVES)) {
        context.datapoints.set({ id, value: Math.round(curve.at(hourOf(now), now) * 10) / 10, unit: curve.unit, label: curve.label });
      }
      context.datapoints.set({ id: 'waschen', value: 'läuft', label: 'Waschmaschine' });
      for (const [id, on] of switches) context.datapoints.set({ id, value: on, writable: true });
    };

    publish();
    const timer = setInterval(publish, TICK_MS);
    context.signal.addEventListener('abort', () => clearInterval(timer));

    context.onCommand((id: string, value: DatapointValue) => {
      if (!switches.has(id)) return Promise.reject(new Error(`"${id}" ist kein Schalter.`));
      switches.set(id, value === true);
      context.datapoints.set({ id, value: value === true, writable: true });
      return Promise.resolve();
    });

    context.provideHistory((id, from, to) => {
      const curve = CURVES[id];
      const points: SeriesPoint[] = [];
      if (curve) {
        const step = Math.max(60_000, Math.round((to.getTime() - from.getTime()) / 600));
        for (let time = from.getTime(); time <= to.getTime(); time += step) points.push([time, Math.round(curve.at(hourOf(time), time) * 10) / 10]);
      }
      return Promise.resolve(points);
    });

    context.log.info(`Beispielwerte laufen (${Object.keys(CURVES).length} Messwerte, ${switches.size} Schalter).`);
  },
});
