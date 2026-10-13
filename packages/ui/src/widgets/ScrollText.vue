<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

/**
 * Eine Zeile Text, die durchläuft, wenn sie länger ist als ihr Feld – etwa Interpret und Titel im Radio.
 * Passt sie hinein, steht sie still. Wer am Gerät weniger Bewegung wünscht, sieht sie abgeschnitten.
 */
const props = defineProps<{ text: string }>();

/** Bildpunkte je Sekunde: langsam genug zum Mitlesen. */
const SPEED = 32;
/** Abstand zwischen dem Ende des Textes und seinem neuen Anfang. */
const GAP = 48;
/** Anteil eines Durchlaufs, den der Text am Anfang stehen bleibt. */
const REST = 0.15;

const box = ref<HTMLElement>();
const first = ref<HTMLElement>();
/** Weg eines Durchlaufs in Bildpunkten; 0, solange der Text in sein Feld passt. */
const distance = ref(0);

function measure() {
  const width = first.value?.getBoundingClientRect().width ?? 0;
  distance.value = box.value && width > box.value.clientWidth + 1 ? Math.ceil(width) + GAP : 0;
}
const motion = computed(() => (distance.value ? { '--scroll-distance': `-${distance.value}px`, '--scroll-gap': `${GAP}px`, animationDuration: `${(distance.value / SPEED / (1 - REST)).toFixed(1)}s` } : undefined));

let observer: ResizeObserver | undefined;
onMounted(() => {
  measure();
  if (box.value) {
    observer = new ResizeObserver(measure);
    observer.observe(box.value);
  }
  // Die Breite stimmt erst, wenn die Schrift geladen ist
  void document.fonts?.ready.then(measure);
});
onUnmounted(() => observer?.disconnect());
watch(
  () => props.text,
  () => void nextTick(measure),
);
</script>

<template>
  <span ref="box" class="scroll-text" :class="{ moving: distance > 0 }">
    <!-- Ein neuer Text beginnt wieder am Anfang -->
    <span :key="text" class="track" :style="motion">
      <span ref="first">{{ text }}</span>
      <span v-if="distance" class="again" aria-hidden="true">{{ text }}</span>
    </span>
  </span>
</template>

<style scoped>
.scroll-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
@media (prefers-reduced-motion: no-preference) {
  /* Das Feld selbst kürzt sonst mit Auslassungspunkten – die würden den laufenden Text verdecken */
  .scroll-text.moving {
    text-overflow: clip;
  }
  .scroll-text.moving .track {
    display: inline-flex;
    gap: var(--scroll-gap);
    animation: scroll-text linear infinite;
    will-change: transform;
  }
}
@media (prefers-reduced-motion: reduce) {
  .again {
    display: none;
  }
}
/* Erst steht der Anfang einen Augenblick, dann läuft der Text durch, bis sein zweiter Abzug am Anfang steht */
@keyframes scroll-text {
  0%,
  15% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(var(--scroll-distance));
  }
}
</style>
