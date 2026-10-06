<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatValue } from '../format.ts';
import { region } from '../i18n.ts';
import { datapoints } from '../store.ts';
import { beaufort, compassPoint, isNight, toKmh, uvLevel, weatherIcon } from '../weather.ts';
import { weatherIconUrl } from '../weatherIcons.ts';

interface Day {
  /** Beschreibung der Wetterlage als Text. */
  condition?: string;
  /** Wetterkennzahl oder Symbolkennung von OpenWeatherMap; genauer als der Text. */
  code?: string;
  max?: string;
  min?: string;
}

/**
 * Wetter aus Datenpunkten: aktuelle Lage mit Symbol, Windrose mit Richtung und
 * Geschwindigkeit, UV-Index und die Vorhersage ab heute. Alle Angaben sind Kennungen
 * von Datenpunkten; was fehlt, wird weggelassen.
 */
const props = defineProps<{
  config: {
    temperature?: string;
    condition?: string;
    code?: string;
    wind?: {
      /** Richtung in Grad, aus der der Wind kommt. */
      direction?: string;
      speed?: string;
      /** Einheit der Geschwindigkeit, falls der Datenpunkt keine nennt: "km/h", "m/s", "mph", "kn". */
      unit?: string;
    };
    uv?: string;
    /** Für das Nachtsymbol; ohne die Angaben gilt immer der Tag. */
    sunrise?: string;
    sunset?: string;
    /** Vorhersage, der erste Eintrag ist heute. */
    days?: Day[];
  };
}>();

const { t } = useI18n();
const now = ref(Date.now());
let ticker: number | undefined;
onMounted(() => (ticker = window.setInterval(() => (now.value = Date.now()), 60_000)));
onUnmounted(() => window.clearInterval(ticker));

const read = (id: string | undefined) => (id ? datapoints.get(id) : undefined);
const number = (id: string | undefined) => {
  const value = read(id)?.value;
  return typeof value === 'number' ? value : undefined;
};
const degrees = (value: number | undefined) => (value === undefined ? '–' : `${formatValue(Math.round(value), 0)}°`);

const night = computed(() => isNight(now.value, read(props.config.sunrise)?.value, read(props.config.sunset)?.value));
const current = computed(() => {
  const text = read(props.config.condition)?.value;
  return {
    icon: weatherIconUrl(weatherIcon(read(props.config.code)?.value, text, night.value)),
    text: typeof text === 'string' && text !== 'NULL' && text !== 'UNDEF' ? text : '',
    temperature: number(props.config.temperature),
  };
});

const wind = computed(() => {
  if (!props.config.wind) return undefined;
  const direction = number(props.config.wind.direction);
  const speed = read(props.config.wind.speed);
  const kmh = typeof speed?.value === 'number' ? toKmh(speed.value, props.config.wind.unit ?? speed.unit) : undefined;
  const points = t('weather.points').split(',');
  return {
    direction,
    point: direction === undefined ? '' : (points[compassPoint(direction)] ?? ''),
    kmh,
    force: kmh === undefined ? undefined : beaufort(kmh),
    // Bei Windstille gibt es keine Richtung zu zeigen
    calm: kmh !== undefined && kmh < 1,
  };
});

const uv = computed(() => {
  const index = number(props.config.uv);
  return index === undefined ? undefined : { index: Math.round(index), level: uvLevel(index) };
});

const days = computed(() =>
  (props.config.days ?? []).map((day, offset) => {
    const date = new Date(now.value);
    date.setDate(date.getDate() + offset);
    return {
      label: offset === 0 ? t('weather.today') : new Intl.DateTimeFormat(region.value, { weekday: 'short' }).format(date),
      // Die Vorhersage gilt dem Tag, also immer das Tagsymbol
      icon: weatherIconUrl(weatherIcon(read(day.code)?.value, read(day.condition)?.value)),
      text: String(read(day.condition)?.value ?? ''),
      max: number(day.max),
      min: number(day.min),
    };
  }),
);
</script>

<template>
  <section class="weather">
    <div class="now">
      <img :src="current.icon" :alt="current.text" />
      <div class="reading">
        <span class="temperature">{{ degrees(current.temperature) }}</span>
        <span class="condition">{{ current.text }}</span>
      </div>
    </div>

    <div v-if="wind || uv" class="air">
      <svg v-if="wind" class="rose" viewBox="0 0 100 100" role="img" :aria-label="wind.kmh === undefined ? t('weather.wind') : t('weather.windFrom', { point: wind.point, speed: formatValue(wind.kmh, 0), force: wind.force })">
        <circle cx="50" cy="50" r="38" class="ring" />
        <g class="ticks">
          <line v-for="index in 8" :key="index" x1="50" :y1="index % 2 ? 12 : 14" x2="50" :y2="index % 2 ? 18 : 17" :transform="`rotate(${(index - 1) * 45} 50 50)`" />
        </g>
        <text x="50" y="9.5" class="north">{{ t('weather.points').split(',')[0] }}</text>
        <!-- Der Zeiger sitzt dort, wo der Wind herkommt, und weist in die Richtung, in die er weht -->
        <path v-if="wind.direction !== undefined && !wind.calm" class="pointer" d="M50 32 L43 15 L50 19 L57 15 Z" :transform="`rotate(${wind.direction} 50 50)`" />
        <text x="50" y="54" class="speed">{{ wind.kmh === undefined ? '–' : formatValue(wind.kmh, 0) }}</text>
        <text x="50" y="68" class="unit">km/h</text>
      </svg>
      <div class="facts">
        <span v-if="wind && wind.point && !wind.calm" class="point">{{ wind.point }}</span>
        <span v-if="uv" class="uv" :class="uv.level" :title="t(`weather.uvLevel.${uv.level}`)">
          <i aria-hidden="true" />
          {{ t('weather.uv', { index: uv.index }) }}
        </span>
      </div>
    </div>

    <ol v-if="days.length" class="days">
      <li v-for="(day, index) in days" :key="index">
        <span class="label">{{ day.label }}</span>
        <img :src="day.icon" :alt="day.text" :title="day.text" />
        <span class="range">
          <b>{{ degrees(day.max) }}</b>
          {{ degrees(day.min) }}
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.weather {
  container-type: size;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  padding: 4px 10px;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  align-items: center;
  gap: 12px;
  overflow: hidden;
}
.now {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
.now img {
  height: clamp(48px, 76cqh, 128px);
  aspect-ratio: 1;
}
.reading {
  display: flex;
  flex-direction: column;
  max-width: clamp(90px, 22cqw, 220px);
}
.temperature {
  font-family: var(--font-num);
  font-weight: var(--num-weight);
  font-size: clamp(30px, 46cqh, 88px);
  line-height: 1;
}
.condition {
  color: var(--mute);
  font-size: clamp(13px, 12cqh, 18px);
  line-height: 1.15;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.air {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.rose {
  height: clamp(56px, 70cqh, 150px);
  aspect-ratio: 1;
}
.ring {
  fill: none;
  stroke: var(--line);
  stroke-width: 2;
}
.ticks line {
  stroke: var(--none);
  stroke-width: 1.5;
}
.rose text {
  text-anchor: middle;
  fill: var(--ink);
}
.north {
  font-size: 11px;
  font-weight: 600;
  fill: var(--mute) !important;
}
.pointer {
  fill: var(--accent);
}
.speed {
  font-family: var(--font-num);
  font-size: 30px;
  font-weight: 400;
}
.unit {
  font-size: 11px;
  fill: var(--mute) !important;
}
.facts {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: clamp(12px, 11cqh, 16px);
  white-space: nowrap;
}
.point {
  font-weight: 600;
}
.uv {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.uv i {
  width: 0.7em;
  height: 0.7em;
  border-radius: 50%;
  background: var(--none);
}
.uv.low i {
  background: var(--ok);
}
.uv.moderate i {
  background: var(--warn);
}
.uv.high i {
  background: #e06c00;
}
.uv.veryHigh i {
  background: var(--alarm);
}
.uv.extreme i {
  background: #8a4fc7;
}

/* Die Vorhersage nimmt den Rest der Breite; Tage, die nicht mehr passen, rutschen in eine zweite, unsichtbare Zeile. */
.days {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-around;
  align-content: flex-start;
  overflow: hidden;
}
.days li {
  flex: none;
  height: 100%;
  min-width: clamp(50px, 9cqw, 84px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.label {
  color: var(--mute);
  font-size: clamp(12px, 12cqh, 17px);
}
.days img {
  height: clamp(30px, 40cqh, 72px);
  aspect-ratio: 1;
}
.range {
  color: var(--mute);
  font-size: clamp(13px, 13cqh, 18px);
  white-space: nowrap;
}
.range b {
  color: var(--ink);
  font-weight: 600;
}
</style>
