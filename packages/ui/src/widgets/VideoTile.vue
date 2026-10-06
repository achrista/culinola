<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import StreamPlayer from './StreamPlayer.vue';

const props = defineProps<{ config: { source?: string; stream: string; label?: string } }>();
const { t } = useI18n();
const full = ref(false);
</script>

<template>
  <!-- Antippen füllt den ganzen Bildschirm, erneutes Antippen stellt die Ansicht wieder her -->
  <button class="video" :class="{ full }" :aria-label="t(full ? 'video.shrink' : 'video.enlarge', { name: props.config.label ?? props.config.stream })" @click="full = !full">
    <StreamPlayer :source="props.config.source ?? 'video'" :stream="props.config.stream" muted />
    <span v-if="props.config.label" class="label">{{ props.config.label }}</span>
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
