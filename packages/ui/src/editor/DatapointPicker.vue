<script lang="ts">
import type { Datapoint } from '@culinola/sdk';
import { getJson } from '../api.ts';

// Alle Auswahlfelder teilen sich eine Liste; sie wird neu geholt, wenn sie älter als eine halbe Minute ist
const KEEP_MS = 30_000;
let known: { at: number; list: Promise<Datapoint[]> } | undefined;

function allDatapoints(): Promise<Datapoint[]> {
  if (!known || Date.now() - known.at > KEEP_MS) {
    const list = getJson<Datapoint[]>('/datapoints');
    known = { at: Date.now(), list };
    // Ein gescheiterter Abruf soll den nächsten Versuch nicht verhindern
    list.catch(() => (known = undefined));
  }
  return known.list;
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatValue } from '../format.ts';

const props = defineProps<{
  modelValue: string;
  /** Die Einstellung erwartet etwas Schaltbares – die Auswahl zeigt zunächst nur das. */
  writable?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [id: string] }>();
const { t } = useI18n();

/** Mehr Zeilen zeigt die Liste nicht auf einmal; wer mehr braucht, sucht. */
const SHOWN = 60;

const open = ref(false);
const list = ref<Datapoint[]>([]);
const problem = ref('');
const query = ref('');
const source = ref('');
const onlyWritable = ref(false);

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (!open.value) return;
  query.value = '';
  onlyWritable.value = !!props.writable;
  problem.value = '';
  try {
    list.value = await allDatapoints();
  } catch (cause) {
    problem.value = cause instanceof Error ? cause.message : String(cause);
  }
}

const sourceOf = (id: string) => id.slice(0, id.indexOf(':'));
const sources = computed(() => [...new Set(list.value.map((datapoint) => sourceOf(datapoint.id)))].sort());

/** Gesucht wird in Kennung und Bezeichnung; mehrere Wörter müssen alle vorkommen. */
const matches = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  return list.value.filter((datapoint) => {
    if (source.value && sourceOf(datapoint.id) !== source.value) return false;
    if (onlyWritable.value && !datapoint.writable) return false;
    const text = `${datapoint.id} ${datapoint.label ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
});

function shown(datapoint: Datapoint): string {
  if (datapoint.value === null || datapoint.value === undefined) return '–';
  const value = typeof datapoint.value === 'number' ? formatValue(datapoint.value) : String(datapoint.value);
  return datapoint.unit ? `${value} ${datapoint.unit}` : value;
}

function choose(id: string): void {
  emit('update:modelValue', id);
  open.value = false;
}
</script>

<template>
  <div class="picker">
    <div class="chosen">
      <!-- Die Kennung lässt sich auch von Hand eintragen – etwa für einen Datenpunkt, den es noch nicht gibt -->
      <input type="text" :value="modelValue" spellcheck="false" autocapitalize="off" :placeholder="t('picker.none')" @change="emit('update:modelValue', ($event.target as HTMLInputElement).value.trim())" />
      <button type="button" :aria-expanded="open" @click="toggle">{{ open ? t('picker.close') : t('picker.choose') }}</button>
    </div>
    <div v-if="open" class="chooser">
      <input v-model="query" type="search" :placeholder="t('picker.search')" spellcheck="false" autocapitalize="off" />
      <div class="filters">
        <select v-model="source" :aria-label="t('picker.source')">
          <option value="">{{ t('picker.allSources') }}</option>
          <option v-for="entry in sources" :key="entry" :value="entry">{{ entry }}</option>
        </select>
        <label><input v-model="onlyWritable" type="checkbox" /> {{ t('picker.writable') }}</label>
      </div>
      <p v-if="problem" class="state bad" role="alert">{{ problem }}</p>
      <p v-else-if="!matches.length" class="state">{{ t('picker.nothing') }}</p>
      <ul v-else>
        <li v-for="datapoint in matches.slice(0, SHOWN)" :key="datapoint.id">
          <button type="button" :class="{ current: datapoint.id === modelValue }" @click="choose(datapoint.id)">
            <span class="name">{{ datapoint.label || datapoint.id }}</span>
            <span class="value">{{ shown(datapoint) }}</span>
            <span v-if="datapoint.label" class="id">{{ datapoint.id }}</span>
          </button>
        </li>
      </ul>
      <p v-if="matches.length > SHOWN" class="state">{{ t('picker.more', { shown: SHOWN, count: matches.length }) }}</p>
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chosen {
  display: flex;
  gap: 6px;
}
input[type='text'],
input[type='search'],
select {
  min-width: 0;
  flex: 1;
  box-sizing: border-box;
  font: inherit;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
}
.chosen button {
  flex: none;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--soft);
  border: 1px solid var(--line);
}
.chooser {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--accent);
  border-radius: 6px;
}
.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-size: 14px;
}
.filters label {
  display: flex;
  align-items: center;
  gap: 4px;
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 280px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
li button {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0 8px;
  padding: 7px 6px;
  text-align: left;
  background: none;
  border-bottom: 1px solid var(--line);
}
li button:hover,
li button.current {
  background: var(--soft);
}
li button.current .name {
  color: var(--accent);
  font-weight: 600;
}
.name {
  overflow-wrap: anywhere;
}
.value {
  color: var(--mute);
  white-space: nowrap;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.id {
  grid-column: 1 / -1;
  color: var(--mute);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.state {
  margin: 0;
  color: var(--mute);
  font-size: 14px;
}
.state.bad {
  color: var(--alarm);
}
</style>
