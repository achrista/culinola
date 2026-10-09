<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { postJson } from '../api.ts';
import { isOn } from '../state.ts';
import { datapoints } from '../store.ts';

interface Item {
  datapoint: string;
  label?: string;
  /** `cover` für Rollladen, Jalousie oder Markise: drei Tasten zum Fahren statt eines Schalters. */
  type?: 'switch' | 'cover';
  /** Beschriftung der Tasten, etwa „ein“ und „aus“ bei einer Markise; ohne Angabe Pfeile. */
  up?: string;
  down?: string;
}
const props = defineProps<{ config: { items?: Item[] } }>();

const { t } = useI18n();
const pending = ref(new Set<string>());
const failed = ref('');

const on = (id: string) => isOn(datapoints.get(id)?.value);

/** Stellung in Prozent, wenn die Quelle eine meldet. */
const position = (id: string) => {
  const value = datapoints.get(id)?.value;
  return typeof value === 'number' ? `${Math.round(value)} %` : '';
};
async function move(id: string, direction: 'up' | 'down' | 'stop') {
  failed.value = '';
  try {
    await postJson('/actions/cover.move', { datapoint: id, direction });
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function toggle(id: string) {
  pending.value = new Set(pending.value).add(id);
  failed.value = '';
  try {
    await postJson('/actions/switch.set', { datapoint: id, on: !on(id) });
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    const next = new Set(pending.value);
    next.delete(id);
    pending.value = next;
  }
}
</script>

<template>
  <section class="field">
    <template v-for="item in props.config.items ?? []" :key="item.datapoint">
      <div v-if="item.type === 'cover'" class="switch cover">
        <span class="moves">
          <button :aria-label="t('switches.up', { name: item.label ?? item.datapoint })" @click="move(item.datapoint, 'up')">{{ item.up ?? '▲' }}</button>
          <button :aria-label="t('switches.stop', { name: item.label ?? item.datapoint })" @click="move(item.datapoint, 'stop')">■</button>
          <button :aria-label="t('switches.down', { name: item.label ?? item.datapoint })" @click="move(item.datapoint, 'down')">{{ item.down ?? '▼' }}</button>
        </span>
        <span class="label">{{ item.label ?? datapoints.get(item.datapoint)?.label ?? item.datapoint }} <small>{{ position(item.datapoint) }}</small></span>
      </div>
      <button v-else class="switch" :class="{ on: on(item.datapoint), busy: pending.has(item.datapoint) }" :aria-pressed="on(item.datapoint)" @click="toggle(item.datapoint)">
        <span class="track"><span class="knob"></span></span>
        <span class="label">{{ item.label ?? datapoints.get(item.datapoint)?.label ?? item.datapoint }}</span>
      </button>
    </template>
    <p v-if="failed" class="error" role="alert">{{ t('switches.failed', { error: failed }) }}</p>
  </section>
</template>

<style scoped>
/* Die Tasten verteilen sich selbst: eine Reihe, ein Block oder eine Spalte – je nach Platz. */
.field {
  position: relative;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  grid-auto-rows: minmax(56px, 1fr);
  gap: var(--gap);
}
.switch {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  padding: 8px;
  border-radius: var(--radius);
  background: var(--card);
  text-align: left;
}
.track {
  width: 38px;
  height: 20px;
  box-sizing: border-box;
  padding: 3px;
  border-radius: 999px;
  background: var(--line);
  display: flex;
  justify-content: flex-start;
  transition: background 0.15s;
}
.knob {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--card);
}
.switch.on .track {
  background: var(--accent);
  justify-content: flex-end;
}
.switch.on .knob {
  background: var(--on-accent);
}
.switch.busy {
  opacity: 0.6;
}
/* Zum Fahren: drei Tasten nebeneinander, darunter Name und Stellung. Das Feld ist doppelt so breit wie ein Schalter. */
.cover {
  grid-column: span 2;
}
.moves {
  display: flex;
  gap: 6px;
  width: 100%;
}
.moves button {
  flex: 1;
  min-width: 0;
  min-height: 30px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--soft);
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
.moves button:active {
  background: var(--accent);
  color: var(--on-accent);
}
.label small {
  color: var(--mute);
  font-weight: 400;
}
.label {
  font-weight: 500;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.error {
  position: absolute;
  inset: auto 0 0 0;
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--alarm);
  color: #fff;
  font-size: 14px;
}
</style>
