<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { postJson } from '../api.ts';
import { currentStation, playbackBlocked, resumePlayback, startRadioPlayback, stationsOf } from '../media.ts';
import { datapoints } from '../store.ts';

const props = defineProps<{ config: { source?: string } }>();
const { t } = useI18n();
const source = computed(() => props.config.source ?? 'radio');

const stations = computed(() => stationsOf(source.value));
const current = computed(() => currentStation(source.value));
const title = computed(() => {
  const value = datapoints.get(`${source.value}:title`)?.value;
  return typeof value === 'string' ? value : '';
});
const volume = computed(() => {
  const value = datapoints.get(`${source.value}:volume`)?.value;
  return typeof value === 'number' ? value : 0;
});
const failed = ref('');

onMounted(() => startRadioPlayback(source.value));

async function run(action: string, params: Record<string, unknown> = {}) {
  failed.value = '';
  try {
    await postJson(`/actions/${action}`, params);
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}
</script>

<template>
  <section class="radio">
    <div class="now">
      <span class="kind">{{ current ? t(current.kind === 'video' ? 'radio.tv' : 'radio.radio') : t('radio.idle') }}</span>
      <span class="name">{{ current?.name ?? t('radio.off') }}</span>
      <span class="title">{{ current?.kind === 'video' ? t('radio.inMediaWindow') : title }}</span>
    </div>

    <div class="stations">
      <button
        v-for="station in stations"
        :key="station.id"
        :class="{ active: current?.id === station.id }"
        :aria-pressed="current?.id === station.id"
        @click="run('radio.play', { station: station.id })"
      >
        <span class="label">{{ station.name }}</span>
        <span v-if="station.kind === 'video'" class="tv">{{ t('radio.tvTag') }}</span>
      </button>
    </div>

    <div class="controls">
      <button :aria-label="t('radio.quieter')" @click="run('radio.volume', { delta: -5 })">−</button>
      <button :aria-label="t('radio.louder')" @click="run('radio.volume', { delta: 5 })">+</button>
      <span class="volume" role="img" :aria-label="t('radio.volume', { percent: volume })"><span :style="{ width: `${Math.min(100, (volume / 150) * 100)}%` }"></span></span>
      <button class="off" @click="run('radio.stop')">{{ t('radio.off') }}</button>
    </div>

    <button v-if="playbackBlocked" class="blocked" @click="resumePlayback">{{ t('radio.tapToStart') }}</button>
    <p v-if="failed" class="error" role="alert">{{ failed }}</p>
  </section>
</template>

<style scoped>
.radio {
  position: relative;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 10px 14px;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  align-items: stretch;
  gap: 14px;
}
.now {
  flex: none;
  width: 170px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
}
.kind,
.title {
  font-size: 15px;
  color: var(--mute);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title {
  min-height: 1.3em;
}
.name {
  font-family: var(--font-num);
  font-weight: 400;
  font-size: 30px;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Die Sendertasten verteilen sich selbst auf Zeilen und Spalten. */
.stations {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
  grid-auto-rows: minmax(48px, 1fr);
  gap: var(--gap);
}
.stations button {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: var(--radius);
  background: var(--soft);
  font-weight: 500;
}
.stations button.active {
  background: var(--accent);
  color: var(--on-accent);
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tv {
  flex: none;
  padding: 0 5px;
  border: 1px solid currentColor;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
}
.controls {
  flex: none;
  width: 132px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr auto 1fr;
  gap: var(--gap);
}
.controls button {
  min-height: 44px;
  border-radius: var(--radius);
  background: var(--soft);
  font-size: 26px;
}
.controls .off {
  grid-column: span 2;
  font-size: 16px;
  font-weight: 500;
}
.volume {
  grid-column: span 2;
  height: 6px;
  border-radius: 999px;
  background: var(--soft);
  overflow: hidden;
}
.volume span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.blocked,
.error {
  position: absolute;
  inset: auto 14px 8px 14px;
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 15px;
  text-align: center;
}
.blocked {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.error {
  background: var(--alarm);
  color: #fff;
}
</style>
