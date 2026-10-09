<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { region } from './i18n.ts';
import { beep, bell, chime } from './sound.ts';
import { onEvent, type Raised } from './store.ts';
import StreamPlayer from './widgets/StreamPlayer.vue';

/**
 * Meldungen des Kerns – „Jemand klingelt an der Haustür“, „Die Waschmaschine ist fertig“ – liegen
 * über jeder Anzeige, gleich welches Layout sie zeigt: als Tafel oben in der Mitte, mit Ton, auf
 * Wunsch vorgelesen und mit dem Bild einer Kamera dahinter. Antippen räumt sie weg.
 */
const MAX_SHOWN = 3;
const { t } = useI18n();
const shown = ref<Raised[]>([]);
const video = ref<Raised>();
const timers = new Map<number, number>();

function dismiss(id: number) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  shown.value = shown.value.filter((entry) => entry.id !== id);
  if (video.value?.id === id) video.value = undefined;
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = region.value;
  const language = region.value.split('-')[0]!;
  const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(language));
  const voice = voices.find((entry) => entry.localService) ?? voices[0];
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

function show(raised: Raised) {
  // Reine Signale gehen an Programme, die mithören – nicht an die Menschen vor der Anzeige
  if (raised.show === false) return;
  // Dieselbe Meldung noch einmal ersetzt ihre Vorgängerin, statt sich daneben zu stellen
  for (const older of shown.value.filter((entry) => entry.name === raised.name)) dismiss(older.id);
  shown.value = [raised, ...shown.value].slice(0, MAX_SHOWN);
  if (raised.video) video.value = raised;
  timers.set(
    raised.id,
    window.setTimeout(() => dismiss(raised.id), raised.seconds * 1000),
  );
  if (raised.sound === 'bell') bell();
  else if (raised.sound === 'chime') chime();
  else if (raised.sound === 'beep') beep(2);
  // Erst der Ton, dann die Stimme
  if (raised.speak) window.setTimeout(() => speak(raised.text), raised.sound === 'none' ? 0 : 900);
}

let stop: (() => void) | undefined;
onMounted(() => {
  stop = onEvent(show);
});
onUnmounted(() => {
  stop?.();
  for (const timer of timers.values()) window.clearTimeout(timer);
});
</script>

<template>
  <Teleport to="body">
    <button v-if="video?.video" class="event-video" :aria-label="t('events.close')" @click="dismiss(video.id)">
      <StreamPlayer :source="video.video.source" :stream="video.video.stream" muted />
    </button>
    <div v-if="shown.length" class="event-stack" role="alert">
      <button v-for="entry in shown" :key="entry.id" class="event" :aria-label="t('events.close')" @click="dismiss(entry.id)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4.5a2 2 0 0 0 4 0M3 9a9.5 9.5 0 0 1 2.5-5M21 9a9.5 9.5 0 0 0-2.5-5" /></svg>
        <span>{{ entry.text }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style>
/* Das Kamerabild füllt die Anzeige, die Tafeln liegen darüber */
.event-video {
  position: fixed;
  inset: 0;
  z-index: 80;
  padding: 0;
  background: #000;
  display: grid;
}
.event-video > * {
  width: 100%;
  height: 100%;
}
.event-stack {
  position: fixed;
  top: 24px;
  left: 50%;
  z-index: 85;
  transform: translateX(-50%);
  width: min(900px, calc(100vw - 32px));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.event {
  box-sizing: border-box;
  width: 100%;
  padding: 18px 24px;
  border-radius: 18px;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  gap: 18px;
  text-align: left;
  font-size: clamp(22px, 2.4vw, 36px);
  font-weight: 600;
  line-height: 1.2;
  animation: event-in 0.25s ease-out;
}
.event svg {
  flex: none;
  width: 1.5em;
  height: 1.5em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
@keyframes event-in {
  from {
    opacity: 0;
    transform: translateY(-16px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .event {
    animation: none;
  }
}
</style>
