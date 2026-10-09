<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

/**
 * Ein Bild von einer Webadresse, das sich von selbst erneuert – etwa eine Webcam, die alle paar
 * Minuten ein neues Standbild ablegt. Antippen zeigt es über die ganze Anzeige.
 */
const props = defineProps<{
  config: {
    url: string;
    /** Abstand, in dem das Bild neu geholt wird; Vorgabe 300 Sekunden. */
    refreshSeconds?: number;
    label?: string;
    /** `contain` zeigt das ganze Bild, `cover` (Vorgabe) füllt die Kachel. */
    fit?: 'cover' | 'contain';
  };
}>();

const stamp = ref(Date.now());
const shown = ref('');
const failed = ref(false);
const full = ref(false);
let timer: number | undefined;

/** Die Adresse mit einem wechselnden Zusatz, damit der Browser nicht das alte Bild aus dem Speicher nimmt. */
const address = computed(() => {
  const url = props.config.url;
  if (!/^https?:\/\//i.test(url ?? '')) return '';
  return `${url}${url.includes('?') ? '&' : '?'}_=${stamp.value}`;
});

/** Das neue Bild wird im Hintergrund geladen und erst gezeigt, wenn es da ist – so flackert nichts. */
function load() {
  if (!address.value) return;
  const next = address.value;
  const image = new Image();
  image.onload = () => {
    shown.value = next;
    failed.value = false;
  };
  image.onerror = () => {
    failed.value = !shown.value;
  };
  image.src = next;
}
onMounted(() => {
  load();
  timer = window.setInterval(
    () => {
      stamp.value = Date.now();
      load();
    },
    Math.max(10, props.config.refreshSeconds ?? 300) * 1000,
  );
});
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <button class="image" :class="{ full }" :aria-label="config.label" @click="full = !full">
    <img v-if="shown" :src="shown" alt="" :style="{ objectFit: full ? 'contain' : (config.fit ?? 'cover') }" />
    <span v-if="config.label && !full" class="label">{{ config.label }}</span>
    <span v-if="failed || !address" class="none">{{ config.label ?? '' }} –</span>
  </button>
</template>

<style scoped>
.image {
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
  display: block;
}
img {
  width: 100%;
  height: 100%;
  display: block;
}
.label {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
}
.none {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--mute);
}
/* Angetippt liegt das Bild über der ganzen Anzeige; noch einmal antippen bringt die Kachel zurück */
.full {
  position: fixed;
  inset: 0;
  z-index: 60;
  border-radius: 0;
  background: #000;
}
</style>
