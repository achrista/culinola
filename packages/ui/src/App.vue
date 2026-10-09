<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AccessDenied, adoptTokenFromAddress, getJson } from './api.ts';
import { applySite, astroSource, nightTheme, setDaylight, type SiteSettings } from './i18n.ts';
import { connect, connected, subscribe, datapoints } from './store.ts';
import { widgets } from './widgets/index.ts';
import EventLayer from './EventLayer.vue';

interface Widget {
  type: string;
  at: [number, number, number, number];
  config?: unknown;
}
interface Layout {
  grid: { columns: number; rows: number };
  widgets: Widget[];
}

const { t } = useI18n();
const layout = ref<Layout>();
const error = ref('');
const denied = ref(false);

const DATAPOINT_ID = /^[a-z][a-z0-9-]*:[\w.-]+$/;

/**
 * Sammelt alle Datenpunkt-Kennungen aus den Widget-Einstellungen: jede Angabe der Form
 * "quelle:name". Was nur so aussieht und keiner ist, schadet nicht – der Kern schickt dazu nichts.
 */
/** Die Quelle, an der eine Kachel hängt, wenn ihre Konfiguration keine nennt – dieselbe Vorgabe wie in der Kachel selbst. */
const DEFAULT_SOURCES: Record<string, string> = {
  calendar: 'google',
  reminders: 'google',
  calls: 'fritzbox',
  checklist: 'merkio',
  mail: 'mail',
  'media-window': 'radio',
  news: 'news',
  radio: 'radio',
  recipes: 'recipes',
  'sun-moon': 'astro',
  video: 'video',
  voice: 'voice',
};

function collectIds(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    if (DATAPOINT_ID.test(value)) found.add(value);
  } else if (Array.isArray(value)) value.forEach((entry) => collectIds(entry, found));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      // Widgets, die an einer ganzen Quelle hängen (Radio, Video, Eieruhr), brauchen alle ihre Datenpunkte
      if ((key === 'source' || key === 'timer') && typeof entry === 'string') found.add(`${entry}:*`);
      else collectIds(entry, found);
    }
  }
}

onMounted(async () => {
  adoptTokenFromAddress();
  // Wird das Token an eine schon geöffnete Seite angehängt, lädt der Browser nicht neu – das holen wir nach.
  window.addEventListener('hashchange', () => {
    if (adoptTokenFromAddress()) location.reload();
  });
  try {
    applySite(await getJson<SiteSettings>('/site'));
    // Welches Layout diese Anzeige zeigt, sagt der Adresszusatz ?layout=name; ohne ihn gilt "main"
    const wanted = new URLSearchParams(location.search).get('layout') ?? 'main';
    layout.value = await getJson<Layout>(`/layouts/${encodeURIComponent(wanted)}`);
    const ids = new Set<string>();
    collectIds(layout.value.widgets, ids);
    for (const widget of layout.value.widgets) {
      const source = DEFAULT_SOURCES[widget.type];
      if (source && typeof (widget.config as { source?: unknown } | undefined)?.source !== 'string') ids.add(`${source}:*`);
    }
    // Für den Wechsel zwischen Tag- und Nachtschema braucht jede Anzeige den Sonnenstand, gleich welches Layout sie zeigt
    if (nightTheme.value) ids.add(`${astroSource.value}:day`);
    subscribe([...ids]);
    connect();
  } catch (cause) {
    denied.value = cause instanceof AccessDenied;
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

// Tag und Nacht: Geht die Sonne unter, wechselt die Anzeige auf ihr Nachtschema – und am Morgen zurück
watch(
  () => (nightTheme.value ? datapoints.get(`${astroSource.value}:day`)?.value : undefined),
  (day) => {
    if (typeof day === 'boolean') setDaylight(day);
  },
);

function place(widget: Widget) {
  const [x, y, w, h] = widget.at;
  return { gridColumn: `${x + 1} / span ${w}`, gridRow: `${y + 1} / span ${h}` };
}
</script>

<template>
  <p v-if="denied" class="notice">{{ t('app.notUnlocked', { error }) }}</p>
  <p v-else-if="error" class="notice">{{ t('app.layoutFailed', { error }) }}</p>
  <main
    v-else-if="layout"
    class="grid"
    :style="{ gridTemplateColumns: `repeat(${layout.grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.grid.rows}, minmax(0, 1fr))` }"
  >
    <template v-for="(widget, index) in layout.widgets" :key="index">
      <component :is="widgets[widget.type]" v-if="widgets[widget.type]" :config="widget.config ?? {}" :style="place(widget)" />
      <div v-else class="unknown" :style="place(widget)">{{ t('app.unknownWidget', { type: widget.type }) }}</div>
    </template>
  </main>
  <div v-if="layout && !connected" class="offline" role="status">{{ t('app.offline') }}</div>
  <EventLayer v-if="layout" />
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
.notice,
.unknown {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--bg-ink);
}
.unknown {
  border-radius: var(--radius);
  background: var(--card);
  color: var(--mute);
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
