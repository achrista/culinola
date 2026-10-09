<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { region } from '../i18n.ts';
import { datapoints } from '../store.ts';

/**
 * Sonne und Mond: Die Sonne wandert im Lauf des Tages über einen Bogen von ihrem Aufgang links zu
 * ihrem Untergang rechts; nachts zieht dort der Mond in seiner heutigen Gestalt. Der Himmel dahinter
 * wechselt mit Tag, Dämmerung und Nacht.
 */
const props = defineProps<{ config: { source?: string } }>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'astro');
const now = ref(Date.now());
let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => (now.value = Date.now()), 30_000);
});
onUnmounted(() => window.clearInterval(timer));

const value = (id: string) => datapoints.get(`${source.value}:${id}`)?.value;
const time = (id: string) => {
  const text = value(id);
  const parsed = typeof text === 'string' && text ? Date.parse(text) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};
const sunrise = computed(() => time('sunrise'));
const sunset = computed(() => time('sunset'));
const known = computed(() => value('day') !== undefined);
const isDay = computed(() => value('day') === true);

/** Tag, Dämmerung oder Nacht – danach richtet sich der Himmel. */
const sky = computed(() => {
  if (isDay.value) return 'day';
  const dawn = time('dawn');
  const dusk = time('dusk');
  const twilight = (dawn !== undefined && sunrise.value !== undefined && now.value >= dawn && now.value < sunrise.value) || (dusk !== undefined && sunset.value !== undefined && now.value >= sunset.value && now.value < dusk);
  return twilight ? 'twilight' : 'night';
});

/** Wie weit der Lauf über den Bogen gediehen ist: 0 beim Aufgang links, 1 beim Untergang rechts. */
const progress = computed(() => {
  const share = (from: number | undefined, to: number | undefined) => (from === undefined || to === undefined || to <= from ? 0.5 : Math.min(1, Math.max(0, (now.value - from) / (to - from))));
  if (isDay.value) return share(sunrise.value, sunset.value);
  // Nachts wandert der Mond: vom Untergang der Sonne bis zu ihrem nächsten Aufgang
  if (sunset.value !== undefined && now.value >= sunset.value) return share(sunset.value, time('nextSunrise'));
  return share(time('previousSunset'), sunrise.value);
});
// Der Bogen ist eine halbe Ellipse über dem Horizont
const position = computed(() => ({ x: 100 - 80 * Math.cos(Math.PI * progress.value), y: 78 - 56 * Math.sin(Math.PI * progress.value) }));

const phase = computed(() => (typeof value('moonPhase') === 'number' ? (value('moonPhase') as number) : 0));
/** Der beleuchtete Teil der Mondscheibe als Pfad; abnehmend ist er gespiegelt. */
function moonShape(radius: number): { path: string; flip: boolean } {
  const flip = phase.value > 0.5;
  const part = flip ? 1 - phase.value : phase.value;
  // Die Lichtgrenze ist eine halbe Ellipse: schmal bei Halbmond, breit bei Sichel und fast vollem Mond
  const bulge = Math.abs(Math.cos(2 * Math.PI * part)) * radius;
  const towardsDark = part > 0.25 ? 1 : 0;
  return { path: `M0 ${-radius}A${radius} ${radius} 0 0 1 0 ${radius}A${bulge.toFixed(2)} ${radius} 0 0 ${towardsDark} 0 ${-radius}Z`, flip };
}
const bigMoon = computed(() => moonShape(8));
const smallMoon = computed(() => moonShape(5));

const clock = (at: number | undefined) => (at === undefined ? '–' : new Intl.DateTimeFormat(region.value, { hour: '2-digit', minute: '2-digit' }).format(at));
const span = (minutes: number) => t('sun.span', { h: Math.floor(minutes / 60), min: String(Math.round(minutes % 60)).padStart(2, '0') });
const dayLength = computed(() => (typeof value('dayLength') === 'number' ? span(value('dayLength') as number) : ''));
/** Was als Nächstes geschieht – und in wie langer Zeit. */
const next = computed(() => {
  const target = isDay.value ? sunset.value : sunset.value !== undefined && now.value >= sunset.value ? time('nextSunrise') : sunrise.value;
  if (target === undefined || target <= now.value) return '';
  return t(isDay.value ? 'sun.setsIn' : 'sun.risesIn', { time: span((target - now.value) / 60_000) });
});
const moonName = computed(() => (typeof value('moonName') === 'string' ? t(`sun.moon.${value('moonName')}`) : ''));

// Sterne an festen Plätzen; jeder funkelt in seinem eigenen Takt
const STARS = [
  [22, 14, 0.9], [41, 30, 0.6], [58, 10, 0.7], [77, 22, 1], [96, 8, 0.6], [113, 26, 0.8], [131, 12, 1], [149, 31, 0.6], [166, 16, 0.9], [184, 28, 0.7], [34, 46, 0.5], [171, 44, 0.5],
] as const;
</script>

<template>
  <section class="sun-moon" :class="[sky, { unknown: !known }]">
    <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g class="stars">
        <circle v-for="([x, y, size], index) in STARS" :key="index" :cx="x" :cy="y" :r="size" :style="{ animationDelay: `${(index * 0.7) % 4}s` }" />
      </g>
      <path class="arc" d="M20 78A80 56 0 0 1 180 78" />
      <path class="horizon" d="M8 78H192" />
      <!-- Der Weg, der schon zurückgelegt ist -->
      <path v-if="known" class="done" :d="`M20 78A80 56 0 0 1 ${position.x.toFixed(1)} ${position.y.toFixed(1)}`" />
      <g v-if="known" class="body" :style="{ transform: `translate(${position.x.toFixed(1)}px, ${position.y.toFixed(1)}px)` }">
        <template v-if="isDay">
          <circle class="glow" r="13" />
          <g class="rays">
            <path v-for="ray in 8" :key="ray" d="M0 -11.5V-15" :transform="`rotate(${ray * 45})`" />
          </g>
          <circle class="sun" r="7.5" />
        </template>
        <template v-else>
          <circle class="glow moonlight" r="12" />
          <circle class="moon-dark" r="8" />
          <path class="moon-lit" :d="bigMoon.path" :transform="bigMoon.flip ? 'scale(-1 1)' : undefined" />
        </template>
      </g>
    </svg>
    <p class="top">
      <span class="next">{{ next }}</span>
      <span v-if="moonName" class="moon-note">
        <svg viewBox="-6 -6 12 12" aria-hidden="true">
          <circle class="moon-dark" r="5" />
          <path class="moon-lit" :d="smallMoon.path" :transform="smallMoon.flip ? 'scale(-1 1)' : undefined" />
        </svg>
        {{ moonName }}
      </span>
    </p>
    <p class="bottom">
      <span :aria-label="t('sun.sunrise')">↑ {{ clock(sunrise) }}</span>
      <span class="length">{{ dayLength }}</span>
      <span :aria-label="t('sun.sunset')">{{ clock(sunset) }} ↓</span>
    </p>
  </section>
</template>

<style scoped>
.sun-moon {
  container-type: size;
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  overflow: hidden;
  color: var(--sky-ink);
  background: linear-gradient(to bottom, var(--sky-top), var(--sky-low));
  transition: background 2s;
  /* Der Himmel hat seine eigenen Farben – am Tag hell, in der Dämmerung warm, nachts tiefblau */
  --sky-top: #6fb4e6;
  --sky-low: #d9ecf7;
  --sky-ink: #12324a;
  --sky-line: rgba(18, 50, 74, 0.35);
}
.twilight {
  --sky-top: #3b4a7a;
  --sky-low: #f0a05a;
  --sky-ink: #ffffff;
  --sky-line: rgba(255, 255, 255, 0.5);
}
.night {
  --sky-top: #0b1330;
  --sky-low: #25315e;
  --sky-ink: #e8edf8;
  --sky-line: rgba(232, 237, 248, 0.4);
}
.unknown {
  --sky-top: var(--card);
  --sky-low: var(--card);
  --sky-ink: var(--mute);
  --sky-line: var(--line);
}
.sun-moon > svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.arc,
.horizon,
.done {
  fill: none;
  stroke: var(--sky-line);
  stroke-width: 0.8;
}
.arc {
  stroke-dasharray: 1.5 3;
}
.done {
  stroke: var(--sky-ink);
  stroke-width: 1.2;
  opacity: 0.7;
}
.body {
  transition: transform 20s linear;
}
.sun {
  fill: #ffd23f;
}
.glow {
  fill: #ffd23f;
  opacity: 0.3;
  animation: breathe 5s ease-in-out infinite;
}
.rays {
  animation: turn 60s linear infinite;
}
.rays path {
  stroke: #ffd23f;
  stroke-width: 1.4;
  stroke-linecap: round;
}
.moonlight {
  fill: #f4f1de;
  opacity: 0.18;
}
.moon-dark {
  fill: #5a6485;
}
.moon-lit {
  fill: #f4f1de;
}
.stars circle {
  fill: #ffffff;
  opacity: 0;
}
.night .stars circle,
.twilight .stars circle {
  animation: twinkle 4s ease-in-out infinite;
}
.twilight .stars {
  opacity: 0.4;
}
@keyframes breathe {
  50% {
    opacity: 0.45;
    transform: scale(1.12);
  }
}
@keyframes turn {
  to {
    transform: rotate(360deg);
  }
}
@keyframes twinkle {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 0.95;
  }
}
p {
  position: absolute;
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: clamp(12px, 8.5cqh, 17px);
  line-height: 1.2;
  white-space: nowrap;
}
.top {
  top: 0;
}
.bottom {
  bottom: 0;
  font-family: var(--font-num);
  font-size: clamp(14px, 11cqh, 22px);
}
.next {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}
.moon-note {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.moon-note svg {
  width: 1.15em;
  height: 1.15em;
}
.length {
  opacity: 0.8;
  font-size: 0.85em;
}
/* Schmale Kachel: Die Tageslänge weicht zuerst, dann der Name der Mondphase */
@container (max-width: 260px) {
  .length {
    display: none;
  }
}
@container (max-width: 200px) {
  .moon-note {
    font-size: 0;
    gap: 0;
  }
  .moon-note svg {
    font-size: 15px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .glow,
  .rays,
  .stars circle {
    animation: none;
  }
  .night .stars circle {
    opacity: 0.7;
  }
}
</style>
