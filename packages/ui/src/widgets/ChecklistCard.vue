<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson, postJson } from '../api.ts';
import { vScrollHome } from '../scroll.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';

interface Entry {
  id: number;
  name: string;
  amount?: string;
  checked: boolean;
  checkedAt?: string;
}
interface List {
  id: string;
  name: string;
  type: string;
  items: Entry[];
}

/**
 * Eine Einkaufs- oder Aufgabenliste zum Abhaken. Die Liste selbst führt die Quelle – etwa
 * Merkio –, die Kachel zeigt sie eng gesetzt, damit viele Einträge ohne Blättern Platz haben.
 */
const props = defineProps<{
  config: {
    source?: string;
    /** Kennung oder Name der Liste; ohne Angabe die erste der Quelle. */
    list?: string;
    title?: string;
    /** So viele Stunden bleibt Abgehaktes sichtbar, um den Haken zurückzunehmen. */
    recentHours?: number;
  };
}>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'merkio');
const lists = ref<List[]>([]);
const loaded = ref(false);
// Angetippte Einträge wechseln sofort; bestätigt die Quelle den neuen Stand, verschwindet der Vermerk wieder
const pending = reactive(new Map<number, boolean>());
const failed = ref('');

async function load() {
  try {
    lists.value = await getJson<List[]>(`/resources/${encodeURIComponent(source.value)}/lists`);
    loaded.value = true;
    for (const [id, checked] of pending) if (list.value?.items.some((entry) => entry.id === id && entry.checked === checked)) pending.delete(id);
  } catch {
    // Die zuletzt geladene Liste bleibt stehen.
  }
}
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

const list = computed(() => {
  const wanted = props.config.list?.trim().toLowerCase();
  return wanted ? lists.value.find((entry) => entry.id === wanted || entry.name.toLowerCase() === wanted) : lists.value[0];
});
const state = computed(() => datapoints.get(`${source.value}:state`)?.value);
const isChecked = (entry: Entry) => pending.get(entry.id) ?? entry.checked;
const open = computed(() => (list.value?.items ?? []).filter((entry) => !isChecked(entry)));
const done = computed(() => {
  const since = Date.now() - (props.config.recentHours ?? 12) * 3_600_000;
  return (list.value?.items ?? []).filter((entry) => isChecked(entry) && (pending.has(entry.id) || (entry.checkedAt !== undefined && Date.parse(entry.checkedAt) >= since)));
});

async function toggle(entry: Entry) {
  const checked = !isChecked(entry);
  pending.set(entry.id, checked);
  failed.value = '';
  try {
    await postJson(`/actions/lists.check`, { item: entry.id, checked });
  } catch (cause) {
    pending.delete(entry.id);
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}

// Hinzufügen: ein Feld über der Anzeige, das für mehrere Einträge nacheinander offen bleibt
const adding = ref(false);
const text = ref('');
const busy = ref(false);
const added = ref<string[]>([]);
const field = ref<HTMLInputElement>();
async function add() {
  const wanted = text.value.trim();
  if (!wanted || busy.value || !list.value) return;
  busy.value = true;
  failed.value = '';
  try {
    await postJson('/actions/lists.add', { text: wanted, list: list.value.id });
    added.value.unshift(wanted);
    text.value = '';
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
    void nextTick(() => field.value?.focus());
  }
}
function startAdding() {
  adding.value = true;
  added.value = [];
  failed.value = '';
  void nextTick(() => field.value?.focus());
}
</script>

<template>
  <section class="checklist">
    <header>
      <h3>{{ props.config.title ?? list?.name ?? t('checklist.title') }}</h3>
      <span v-if="list" class="count">{{ open.length }}</span>
      <span v-if="state === 'offline'" class="offline">{{ t('checklist.offline') }}</span>
      <button v-if="list" class="plus" :aria-label="t('checklist.add')" @click="startAdding">+</button>
    </header>
    <ul v-if="list && (open.length || done.length)" v-scroll-home>
      <li v-for="entry in open" :key="entry.id">
        <button :aria-label="t('checklist.check', { name: entry.name })" @click="toggle(entry)">
          <span class="box" />
          <span class="name">{{ entry.name }}</span>
          <span v-if="entry.amount" class="amount">{{ entry.amount }}</span>
        </button>
      </li>
      <li v-for="entry in done" :key="entry.id" class="done">
        <button :aria-label="t('checklist.uncheck', { name: entry.name })" @click="toggle(entry)">
          <span class="box">✓</span>
          <span class="name">{{ entry.name }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="none">{{ state === 'login' ? t('checklist.login') : state === 'nogroup' ? t('checklist.noGroup') : !loaded ? '' : list ? t('checklist.empty') : props.config.list ? t('checklist.notFound', { list: props.config.list }) : t('checklist.noList') }}</p>
    <p v-if="failed && !adding" class="failed" role="alert">{{ failed }}</p>

    <DetailOverlay v-if="adding && list" :title="t('checklist.addTo', { list: list.name })" @close="adding = false">
      <form class="add" @submit.prevent="add">
        <label>
          <span>{{ t('checklist.what') }}</span>
          <span class="row">
            <input ref="field" v-model="text" type="text" autocomplete="off" enterkeyhint="done" :placeholder="t('checklist.example')" />
            <button type="submit" :disabled="busy || !text.trim()">{{ t('checklist.addGo') }}</button>
          </span>
        </label>
        <p v-if="failed" class="failed" role="alert">{{ failed }}</p>
        <ul v-if="added.length" class="added">
          <li v-for="(entry, index) in added" :key="index">✓ {{ entry }}</li>
        </ul>
      </form>
    </DetailOverlay>
  </section>
</template>

<style scoped>
.checklist {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
header {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  padding: 0 8px;
  border-radius: 999px;
  background: var(--soft);
  color: var(--mute);
  font-family: var(--font-num);
  font-size: 15px;
}
.offline {
  color: var(--warn);
  font-size: 13px;
}
.plus {
  margin-left: auto;
  width: 34px;
  height: 30px;
  border-radius: 999px;
  background: var(--soft);
  font-size: 22px;
  line-height: 1;
}
/* Mehrere Spalten nebeneinander: So stehen viele kurze Einträge ohne Blättern da. */
.checklist > ul {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  align-content: start;
  gap: 0 12px;
}
.checklist > ul button {
  width: 100%;
  min-height: 30px;
  padding: 2px 0;
  background: none;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  font-size: 17px;
  line-height: 1.2;
}
.box {
  flex: none;
  width: 18px;
  height: 18px;
  border: 2px solid var(--none);
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
}
.name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.amount {
  flex: none;
  color: var(--mute);
  font-size: 14px;
}
.done {
  color: var(--mute);
}
.done .name {
  text-decoration: line-through;
}
.done .box {
  border-color: var(--ok);
  color: var(--ok);
}
.none {
  margin: auto 0;
  color: var(--mute);
}
.failed {
  flex: none;
  margin: 2px 0 0;
  color: var(--alarm);
  font-size: 14px;
}

.add {
  max-width: 34em;
  padding: 28px clamp(16px, 5vw, 64px);
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 20px;
}
.add label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.add .row {
  display: flex;
  gap: 8px;
}
.add input {
  flex: 1;
  min-width: 0;
  min-height: 52px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  font: inherit;
}
.add button {
  min-height: 52px;
  padding: 0 24px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 500;
}
.add button:disabled {
  opacity: 0.4;
}
.add .failed {
  font-size: 16px;
}
.added {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--mute);
}
</style>
