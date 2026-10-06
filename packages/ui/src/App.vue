<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getJson } from './api.ts';
import { connect, connected, subscribe } from './store.ts';
import { widgets } from './widgets/index.ts';

interface Widget {
  type: string;
  at: [number, number, number, number];
  config?: unknown;
}
interface Layout {
  grid: { columns: number; rows: number };
  widgets: Widget[];
}

const layout = ref<Layout>();
const error = ref('');

/** Sammelt alle Datenpunkt-Kennungen, die in den Widget-Einstellungen vorkommen. */
function collectIds(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) value.forEach((entry) => collectIds(entry, found));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if ((key === 'datapoint' || key === 'secondary') && typeof entry === 'string') found.add(entry);
      else collectIds(entry, found);
    }
  }
}

onMounted(async () => {
  try {
    layout.value = await getJson<Layout>('/layouts/main');
    const ids = new Set<string>();
    collectIds(layout.value.widgets, ids);
    subscribe([...ids]);
    connect();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

function place(widget: Widget) {
  const [x, y, w, h] = widget.at;
  return { gridColumn: `${x + 1} / span ${w}`, gridRow: `${y + 1} / span ${h}` };
}
</script>

<template>
  <p v-if="error" class="notice">Das Layout konnte nicht geladen werden: {{ error }}</p>
  <main
    v-else-if="layout"
    class="grid"
    :style="{ gridTemplateColumns: `repeat(${layout.grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.grid.rows}, minmax(0, 1fr))` }"
  >
    <template v-for="(widget, index) in layout.widgets" :key="index">
      <component :is="widgets[widget.type]" v-if="widgets[widget.type]" :config="widget.config ?? {}" :style="place(widget)" />
      <div v-else class="unknown" :style="place(widget)">Unbekanntes Widget „{{ widget.type }}“</div>
    </template>
  </main>
  <div v-if="layout && !connected" class="offline" role="status">Keine Verbindung zum Kern – neuer Versuch läuft</div>
</template>

<style scoped>
.grid {
  box-sizing: border-box;
  height: 100%;
  padding: 16px;
  display: grid;
  gap: var(--gap);
}
.notice,
.unknown {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--mute);
}
.unknown {
  border-radius: var(--radius);
  background: var(--card);
}
.offline {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--bg);
  font-weight: 500;
}
</style>
