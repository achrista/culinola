<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { type Layout, type Widget, widgetKeys } from './layout.ts';
import { widgets } from './widgets/index.ts';

const props = defineProps<{ layout: Layout }>();
const { t } = useI18n();
const keys = computed(() => widgetKeys(props.layout.widgets));

function place(widget: Widget) {
  const [x, y, w, h] = widget.at;
  return { gridColumn: `${x + 1} / span ${w}`, gridRow: `${y + 1} / span ${h}` };
}
</script>

<template>
  <main class="grid" :style="{ gridTemplateColumns: `repeat(${layout.grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.grid.rows}, minmax(0, 1fr))` }">
    <template v-for="(widget, index) in layout.widgets" :key="keys[index]">
      <component :is="widgets[widget.type]" v-if="widgets[widget.type]" :config="widget.config ?? {}" :style="place(widget)" />
      <div v-else class="unknown" :style="place(widget)">{{ t('app.unknownWidget', { type: widget.type }) }}</div>
    </template>
  </main>
</template>

<style scoped>
.grid {
  box-sizing: border-box;
  height: 100%;
  padding: 16px;
  display: grid;
  gap: var(--gap);
}
/* Die Kacheln heben sich vom Grund ab, wo das Farbschema es vorsieht; Uhr und Anwesenheit regeln das selbst, weil sie keine eigene Fläche haben */
.grid > :not(.clock, .presence) {
  box-shadow: var(--shadow);
}
.unknown {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  border-radius: var(--radius);
  background: var(--card);
  color: var(--mute);
}
</style>
