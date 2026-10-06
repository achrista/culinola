<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { currentStation } from '../media.ts';
import { datapoints } from '../store.ts';
import StreamPlayer from './StreamPlayer.vue';

/**
 * Das Fenster für Radio und Fernsehen: Fernsehbild bei einem Fernsehsender,
 * Logo des Senders in der Mitte bei einem Radiosender, sonst der Ruhezustand.
 */
const props = defineProps<{
  config: {
    /** Radio-Instanz, deren laufender Sender gezeigt wird. */
    source?: string;
    /** Video-Instanz, die die Fernsehbilder liefert; die Kennung des Streams ist die des Senders. */
    video?: string;
    /** Videoquelle für den Ruhezustand, etwa eine weitere Kamera. */
    idle?: string;
  };
}>();

const { t } = useI18n();
const radio = computed(() => props.config.source ?? 'radio');
const videoSource = computed(() => props.config.video ?? 'video');
const station = computed(() => currentStation(radio.value));
const volume = computed(() => {
  const value = datapoints.get(`${radio.value}:volume`)?.value;
  return typeof value === 'number' ? value / 100 : 0.5;
});
const full = ref(false);
const showsVideo = computed(() => station.value?.kind === 'video' || (!station.value && !!props.config.idle));
</script>

<template>
  <component :is="showsVideo ? 'button' : 'section'" class="window" :class="{ full: full && showsVideo }" @click="showsVideo && (full = !full)">
    <StreamPlayer v-if="station?.kind === 'video'" :source="videoSource" :stream="station.id" :muted="false" :volume="volume" />
    <StreamPlayer v-else-if="!station && props.config.idle" :source="videoSource" :stream="props.config.idle" muted />
    <div v-else class="still">
      <img v-if="station?.image" :src="station.image" :alt="station.name" />
      <span v-else class="name">{{ station?.name ?? t('radio.idle') }}</span>
    </div>
    <span v-if="station" class="label">{{ station.name }}</span>
  </component>
</template>

<style scoped>
.window {
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}
.window.full {
  position: fixed;
  inset: 0;
  z-index: 50;
  border-radius: 0;
}
/* Das Logo steht in der Mitte und wird nie über seine eigene Größe hinaus gestreckt. */
.still {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.still img {
  max-width: 45%;
  max-height: 60%;
  object-fit: contain;
}
.name {
  font-family: var(--font-num);
  font-weight: 400;
  font-size: 30px;
  color: var(--mute);
  text-align: center;
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
