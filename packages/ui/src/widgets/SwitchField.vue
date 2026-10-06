<script setup lang="ts">
import { ref } from 'vue';
import { postJson } from '../api.ts';
import { datapoints } from '../store.ts';

const props = defineProps<{ config: { items?: { datapoint: string; label?: string }[] } }>();

const pending = ref(new Set<string>());
const failed = ref('');

async function toggle(id: string) {
  const current = datapoints.get(id)?.value === true;
  pending.value = new Set(pending.value).add(id);
  failed.value = '';
  try {
    await postJson('/actions/switch.set', { datapoint: id, on: !current });
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
    <button
      v-for="item in props.config.items ?? []"
      :key="item.datapoint"
      class="switch"
      :class="{ on: datapoints.get(item.datapoint)?.value === true, busy: pending.has(item.datapoint) }"
      :aria-pressed="datapoints.get(item.datapoint)?.value === true"
      @click="toggle(item.datapoint)"
    >
      <span class="track"><span class="knob"></span></span>
      <span class="label">{{ item.label ?? datapoints.get(item.datapoint)?.label ?? item.datapoint }}</span>
    </button>
    <p v-if="failed" class="error" role="alert">Schalten fehlgeschlagen: {{ failed }}</p>
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
  padding: 8px 10px;
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
