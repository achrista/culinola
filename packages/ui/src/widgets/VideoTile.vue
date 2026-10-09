<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { currentStation } from '../media.ts';
import { datapoints } from '../store.ts';
import StreamPlayer from './StreamPlayer.vue';

const props = defineProps<{
  config: {
    source?: string;
    stream: string;
    label?: string;
    /**
     * Radio-Instanz, deren Fernsehsender diese Kachel zeigt: Läuft einer, steht sein Bild mit Ton hier –
     * solange weicht das Kamerabild. So braucht das Fernsehen keine eigene Fläche.
     */
    tv?: string;
  };
}>();
const { t } = useI18n();
const full = ref(false);
const station = computed(() => {
  const playing = props.config.tv ? currentStation(props.config.tv) : undefined;
  return playing?.kind === 'video' ? playing : undefined;
});
const volume = computed(() => {
  const value = props.config.tv ? datapoints.get(`${props.config.tv}:volume`)?.value : undefined;
  return typeof value === 'number' ? value / 100 : 0.5;
});
const name = computed(() => station.value?.name ?? props.config.label ?? props.config.stream);
</script>

<template>
  <!-- Antippen füllt den ganzen Bildschirm, erneutes Antippen stellt die Ansicht wieder her -->
  <button class="video" :class="{ full }" :aria-label="t(full ? 'video.shrink' : 'video.enlarge', { name })" @click="full = !full">
    <StreamPlayer v-if="station" :key="station.id" :source="props.config.source ?? 'video'" :stream="station.id" :muted="false" :volume="volume" />
    <StreamPlayer v-else :source="props.config.source ?? 'video'" :stream="props.config.stream" muted />
    <span v-if="station || props.config.label" class="label">{{ name }}</span>
  </button>
</template>

<style scoped>
.video {
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border-radius: var(--radius);
  background: #0b0f13;
  overflow: hidden;
}
.video.full {
  position: fixed;
  inset: 0;
  z-index: 50;
  border-radius: 0;
}
.label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  text-align: left;
}
</style>
