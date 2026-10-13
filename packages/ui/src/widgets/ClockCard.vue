<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { postJson } from '../api.ts';
import { region } from '../i18n.ts';
import { volumeLevel } from '../format.ts';
import { beep, unlockSound } from '../sound.ts';
import { datapoints } from '../store.ts';

/**
 * Uhr mit Datum. Mit einer Eieruhr-Instanz stellt Antippen die Eieruhr oder startet die
 * Stoppuhr; solange eine läuft, nimmt sie den Platz der Uhrzeit ein und die Uhrzeit den des Datums.
 */
const props = defineProps<{
  config: {
    /** Instanz des Plugins `timer`; ohne die Angabe ist die Uhr nur eine Uhr. */
    timer?: string;
    /** Lautstärke des Klingelns in Prozent; Vorgabe 100, höchstens 200. */
    ringVolume?: number;
    /** Lautstärke des kurzen Tons, der danach alle zwei Sekunden erinnert; Vorgabe 40, 0 schaltet ihn stumm. */
    reminderVolume?: number;
  };
}>();

const DURATION_KEY = 'culinola.timer.seconds';
const PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90];
const MAX_SECONDS = 24 * 60 * 60;
/** So lange klingelt es nach dem Ablauf, bevor nur noch ein kurzer Ton an die Eieruhr erinnert. */
const RING_SECONDS = 6;

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
const time = computed(() => new Intl.DateTimeFormat(region.value, { timeStyle: 'medium' }).format(now.value));

// --- Eieruhr ---------------------------------------------------------------

const text = (id: string) => {
  const value = props.config.timer ? datapoints.get(`${props.config.timer}:${id}`)?.value : undefined;
  return typeof value === 'string' ? value : '';
};
const mode = computed(() => text('state') || 'idle');
/** Sekunden auf der Anzeige: Rest bei der Eieruhr, verstrichene Zeit bei der Stoppuhr und nach dem Ablauf. */
const shownSeconds = computed(() => {
  if (mode.value === 'down') return Math.max(0, Math.ceil((Date.parse(text('end')) - now.value.getTime()) / 1000));
  if (mode.value === 'done') return Math.max(0, Math.floor((now.value.getTime() - Date.parse(text('end'))) / 1000));
  if (mode.value === 'up') return Math.max(0, Math.floor((now.value.getTime() - Date.parse(text('since'))) / 1000));
  return 0;
});

function readout(seconds: number): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const rest = `${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
  return hours ? `${hours}:${rest}` : rest;
}
/** Nach dem Ablauf zählt die Eieruhr mit Minuszeichen weiter – so sieht man, wie lange etwas schon nachkocht. */
/** Ziffern stehen in gleich breiten Feldern – die Schrift selbst setzt die 1 schmaler als die 0. */
const isDigit = (char: string) => char >= '0' && char <= '9';
const timerText = computed(() => (mode.value === 'done' ? `−${readout(shownSeconds.value)}` : readout(shownSeconds.value)));

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

let ticker: number | undefined;
onMounted(() => {
  ticker = window.setInterval(() => {
    now.value = new Date();
    // Abgelaufen: erst klingeln, danach alle zwei Sekunden ein kurzer Ton, bis jemand antippt oder die Nachlaufzeit um ist
    if (mode.value !== 'done' || shownSeconds.value % 2 !== 0) return;
    if (shownSeconds.value < RING_SECONDS) beep(3, volumeLevel(props.config.ringVolume, 100));
    else beep(1, volumeLevel(props.config.reminderVolume, 40));
  }, 1000);
});
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') open.value = false;
};
window.addEventListener('keydown', onKey);
onUnmounted(() => {
  window.clearInterval(ticker);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <section class="clock" :class="{ down: mode === 'down', done: mode === 'done' }">
    <component :is="props.config.timer ? 'button' : 'div'" class="face" :aria-label="props.config.timer ? t(mode === 'done' ? 'timer.tapToStop' : 'timer.set') : undefined" @click="props.config.timer && tap()">
      <template v-if="mode === 'idle'">
        <span class="big" :class="{ period: !!parts.dayPeriod }">
          <span><span v-for="(char, index) in parts.hm" :key="index" :class="{ digit: isDigit(char) }">{{ char }}</span></span>
          <span class="sec"><span v-for="(char, index) in parts.sec" :key="index" :class="{ digit: isDigit(char) }">{{ char }}</span></span>
          <span v-if="parts.dayPeriod" class="sec">{{ parts.dayPeriod }}</span>
        </span>
        <span class="small">{{ date }}</span>
      </template>
      <template v-else>
        <span class="big timer" :class="{ long: timerText.length > 6 }" role="timer" :aria-label="t(mode === 'up' ? 'timer.stopwatch' : mode === 'done' ? 'timer.done' : 'timer.title')"><span><span v-for="(char, index) in timerText" :key="index" :class="{ digit: isDigit(char) }">{{ char }}</span></span></span>
        <span class="small time">{{ time }}</span>
      </template>
    </component>

    <Teleport to="body">
      <div v-if="open" class="backdrop" @click.self="open = false">
        <div class="dialog" role="dialog" aria-modal="true" :aria-label="t('timer.title')">
          <h2>{{ t(mode === 'up' ? 'timer.stopwatch' : 'timer.title') }}</h2>
          <p class="readout">{{ mode === 'idle' ? readout(chosen) : timerText }}</p>

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
  background: var(--clock-bg);
  box-shadow: var(--clock-shadow);
  color: var(--clock-ink);
}
/* Die laufende Eieruhr steht als Signalfläche da, die abgelaufene als Alarmfläche */
.clock.down {
  background: var(--countdown-bg);
}
.clock.done {
  background: var(--clock-alarm-bg);
}
.face {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 0 8px;
  background: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  text-align: left;
}
/*
 * Die große Zeile richtet sich nach Höhe und Breite der Kachel: Sie füllt die Höhe bis auf die Zeile mit dem
 * Datum und die Breite bis auf einen kleinen Rand. Weil jede Ziffer ein gleich breites Feld hat, sind Stunden,
 * Minuten und Sekunden zusammen immer knapp drei Geviert breit – um 11:11 Uhr wie um 20:08 Uhr.
 */
.big {
  display: flex;
  align-items: baseline;
  gap: 0.08em;
  font-family: var(--font-num);
  font-weight: var(--clock-weight);
  font-size: clamp(36px, min(86cqh, 32cqw), 170px);
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.digit {
  display: inline-block;
  width: 0.52em;
  text-align: center;
}
.sec {
  font-size: 0.45em;
}
/* Mit „AM“ oder „PM“ dahinter wird die Zeile länger */
.big.period {
  font-size: clamp(36px, min(86cqh, 26cqw), 170px);
}
.small {
  max-width: 100%;
  color: var(--clock-mute);
  font-size: clamp(13px, 12cqh, 22px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Unter der laufenden Eieruhr steht die Uhrzeit größer als sonst das Datum – die Eieruhr selbst bleibt dafür etwas kleiner */
.timer {
  color: var(--timer-ink);
  font-size: clamp(36px, min(72cqh, 33cqw), 150px);
}
/* Mit Stunden wird die Anzeige länger und deshalb kleiner gesetzt */
.timer.long {
  font-size: clamp(30px, min(50cqh, 26cqw), 110px);
}
.time {
  font-family: var(--font-num);
  font-size: clamp(18px, 26cqh, 48px);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.down .timer,
.down .time {
  color: var(--countdown-ink);
}
/* Abgelaufen: Die Anzeige macht auf sich aufmerksam, bis jemand sie antippt */
.done .timer,
.done .time {
  color: var(--clock-alarm-ink);
}
.done .timer {
  animation: ring 1s steps(2, jump-none) infinite;
}
@keyframes ring {
  50% {
    opacity: 0.45;
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
.readout {
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
  .readout {
    font-size: 72px;
  }
}
</style>
