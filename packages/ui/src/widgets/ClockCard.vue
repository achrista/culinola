<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { postJson } from '../api.ts';
import { region } from '../i18n.ts';
import { datapoints } from '../store.ts';

/** Uhr mit Datum. Mit einer Eieruhr-Instanz stellt Antippen die Eieruhr oder startet die Stoppuhr. */
const props = defineProps<{
  config: {
    /** Instanz des Plugins `timer`; ohne die Angabe ist die Uhr nur eine Uhr. */
    timer?: string;
    /** So lange klingelt eine abgelaufene Eieruhr, wenn niemand sie ausschaltet. */
    alarmSeconds?: number;
  };
}>();

const DURATION_KEY = 'culinola.timer.seconds';
const PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90];
const MAX_SECONDS = 24 * 60 * 60;

const { t } = useI18n();
const now = ref(new Date());

// Stunden:Minuten und Sekunden getrennt, damit die Sekunden kleiner gesetzt werden können.
// Die Region bestimmt, ob 24 Stunden oder 12 Stunden mit Tageshälfte gezeigt werden.
const parts = computed(() => {
  const list = new Intl.DateTimeFormat(region.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now.value);
  const pick = (type: string) => list.find((part) => part.type === type)?.value ?? '';
  return { hm: `${pick('hour')}:${pick('minute')}`, sec: pick('second'), dayPeriod: pick('dayPeriod') };
});
const date = computed(() => new Intl.DateTimeFormat(region.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now.value));

// --- Eieruhr ---------------------------------------------------------------

const text = (id: string) => {
  const value = props.config.timer ? datapoints.get(`${props.config.timer}:${id}`)?.value : undefined;
  return typeof value === 'string' ? value : '';
};
const mode = computed(() => text('state') || 'idle');
/** Sekunden auf der Anzeige: Rest bei der Eieruhr, verstrichene Zeit bei der Stoppuhr. */
const shownSeconds = computed(() => {
  if (mode.value === 'down') return Math.max(0, Math.ceil((Date.parse(text('end')) - now.value.getTime()) / 1000));
  if (mode.value === 'up') return Math.max(0, Math.floor((now.value.getTime() - Date.parse(text('since'))) / 1000));
  return 0;
});
const ringing = computed(() => mode.value === 'done' && now.value.getTime() - Date.parse(text('end')) < (props.config.alarmSeconds ?? 120) * 1000);

function readout(seconds: number): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const rest = `${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
  return hours ? `${hours}:${rest}` : rest;
}

const open = ref(false);
const failed = ref('');
const chosen = ref(readChosen());

function readChosen(): number {
  try {
    const stored = Number(localStorage.getItem(DURATION_KEY));
    return stored >= 1 && stored <= MAX_SECONDS ? Math.round(stored) : 300;
  } catch {
    return 300;
  }
}
function choose(seconds: number) {
  chosen.value = Math.min(MAX_SECONDS, Math.max(10, seconds));
}

async function act(action: string, params: Record<string, number> = {}, thenClose = false) {
  failed.value = '';
  try {
    await postJson(`/actions/timer.${action}`, params);
    if (thenClose) open.value = false;
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
    open.value = true;
  }
}
function start() {
  try {
    localStorage.setItem(DURATION_KEY, String(chosen.value));
  } catch {
    // Ohne Speicher gilt beim nächsten Mal wieder die Vorgabe.
  }
  void act('start', { seconds: chosen.value }, true);
}
function tap() {
  // Das Antippen erlaubt dem Browser, später den Klingelton zu spielen
  unlockSound();
  if (mode.value === 'done') void act('stop');
  else open.value = true;
}

// Der Klingelton wird erzeugt, nicht abgespielt: keine Tondatei, keine fremden Rechte.
let sound: AudioContext | undefined;
function unlockSound() {
  sound ??= new AudioContext();
  void sound.resume();
}
function beep() {
  if (!sound) unlockSound();
  if (sound?.state !== 'running') return;
  for (let index = 0; index < 3; index++) {
    const at = sound.currentTime + index * 0.22;
    const tone = sound.createOscillator();
    const level = sound.createGain();
    tone.frequency.value = 1320;
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(0.5, at + 0.01);
    level.gain.setValueAtTime(0.5, at + 0.12);
    level.gain.linearRampToValueAtTime(0, at + 0.16);
    tone.connect(level).connect(sound.destination);
    tone.start(at);
    tone.stop(at + 0.18);
  }
}

let ticker: number | undefined;
let ticks = 0;
onMounted(() => {
  ticker = window.setInterval(() => {
    now.value = new Date();
    if (ringing.value && ticks++ % 2 === 0) beep();
    if (!ringing.value) ticks = 0;
  }, 1000);
});
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') open.value = false;
};
window.addEventListener('keydown', onKey);
onUnmounted(() => {
  window.clearInterval(ticker);
  window.removeEventListener('keydown', onKey);
  void sound?.close();
});
</script>

<template>
  <section class="clock" :class="{ done: mode === 'done' }">
    <component :is="props.config.timer ? 'button' : 'div'" class="face" :aria-label="props.config.timer ? t(mode === 'done' ? 'timer.tapToStop' : 'timer.set') : undefined" @click="props.config.timer && tap()">
      <span class="now">
        <span class="time">
          <span class="hm">{{ parts.hm }}</span>
          <span class="sec">{{ parts.sec }}</span>
          <span v-if="parts.dayPeriod" class="sec">{{ parts.dayPeriod }}</span>
        </span>
        <span class="date">{{ date }}</span>
      </span>
      <span v-if="mode !== 'idle'" class="timer" role="timer">
        <span class="what">{{ t(mode === 'up' ? 'timer.stopwatch' : mode === 'done' ? 'timer.done' : 'timer.title') }}</span>
        <span class="left">{{ readout(shownSeconds) }}</span>
      </span>
    </component>

    <Teleport to="body">
      <div v-if="open" class="backdrop" @click.self="open = false">
        <div class="dialog" role="dialog" aria-modal="true" :aria-label="t('timer.title')">
          <h2>{{ t(mode === 'up' ? 'timer.stopwatch' : 'timer.title') }}</h2>
          <p class="big">{{ readout(mode === 'idle' ? chosen : shownSeconds) }}</p>

          <template v-if="mode === 'idle'">
            <div class="presets">
              <button v-for="minutes in PRESETS" :key="minutes" :class="{ active: chosen === minutes * 60 }" @click="choose(minutes * 60)">{{ t('timer.minutes', { n: minutes }) }}</button>
            </div>
            <div class="adjust">
              <button @click="choose(chosen - 60)">−1 min</button>
              <button @click="choose(chosen - 10)">−10 s</button>
              <button @click="choose(chosen + 10)">+10 s</button>
              <button @click="choose(chosen + 60)">+1 min</button>
            </div>
            <div class="go">
              <button class="primary" @click="start">{{ t('timer.start') }}</button>
              <button @click="act('stopwatch', {}, true)">{{ t('timer.startStopwatch') }}</button>
            </div>
          </template>
          <div v-else class="go">
            <button v-if="mode !== 'up'" @click="act('add', { seconds: 60 })">+1 min</button>
            <button v-if="mode === 'down'" :disabled="shownSeconds <= 60" @click="act('add', { seconds: -60 })">−1 min</button>
            <button class="primary" @click="act('stop', {}, true)">{{ t('timer.stop') }}</button>
          </div>

          <p v-if="failed" class="failed">{{ t('timer.failed', { error: failed }) }}</p>
          <button class="close" @click="open = false">{{ t('overlay.close') }}</button>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.clock {
  container-type: size;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
}
.face {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 0 8px;
  background: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
}
.now {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.time {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-num);
  font-weight: var(--num-weight);
  line-height: 0.9;
}
.hm {
  font-size: clamp(40px, 62cqh, 140px);
}
.sec {
  font-size: clamp(20px, 28cqh, 64px);
}
.date {
  color: var(--mute);
  font-size: clamp(14px, 12cqh, 22px);
  white-space: nowrap;
}
.timer {
  flex: none;
  padding: 4px 10px;
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  color: var(--accent);
}
.what {
  font-size: clamp(12px, 11cqh, 18px);
  font-weight: 600;
}
.left {
  font-family: var(--font-num);
  font-weight: 400;
  font-size: clamp(24px, 36cqh, 80px);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
/* Abgelaufen: Die Anzeige macht auf sich aufmerksam, bis jemand sie antippt */
.done .timer {
  background: var(--alarm);
  color: #fff;
  animation: ring 1s steps(2, jump-none) infinite;
}
@keyframes ring {
  50% {
    opacity: 0.55;
  }
}
@media (prefers-reduced-motion: reduce) {
  .done .timer {
    animation: none;
  }
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  box-sizing: border-box;
  width: min(620px, 100%);
  max-height: 100%;
  padding: 20px;
  border-radius: calc(var(--radius) * 2);
  background: var(--card);
  color: var(--ink);
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.big {
  margin: 0;
  font-family: var(--font-num);
  font-weight: var(--num-weight);
  font-size: 96px;
  line-height: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.presets,
.adjust,
.go {
  display: grid;
  gap: 8px;
}
.presets {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.adjust {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.go {
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
}
.dialog button {
  min-height: 56px;
  padding: 0 8px;
  border-radius: var(--radius);
  background: var(--soft);
  font-size: 18px;
  font-weight: 500;
}
.dialog button:disabled {
  opacity: 0.4;
}
.dialog .active {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.dialog .primary {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.dialog .close {
  background: none;
  color: var(--mute);
  min-height: 44px;
}
.failed {
  margin: 0;
  color: var(--alarm);
}
@media (max-width: 520px) {
  .presets {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .big {
    font-size: 72px;
  }
}
</style>
