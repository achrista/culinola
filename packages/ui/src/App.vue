<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AccessDenied, adoptTokenFromAddress, getJson } from './api.ts';
import { applySite, astroSource, nightTheme, setDaylight, type SiteSettings } from './i18n.ts';
import { type LoadedLayout, datapointsOf, wantedLayout } from './layout.ts';
import { connect, connected, onLayoutChanged, subscribe, datapoints } from './store.ts';
import EventLayer from './EventLayer.vue';
import LayoutGrid from './LayoutGrid.vue';

const { t } = useI18n();
const layout = ref<LoadedLayout>();
const error = ref('');
const denied = ref(false);
const name = wantedLayout();
// Bearbeiten öffnet sich nur über die Adresse (…&edit) – an der Anzeige selbst soll niemand versehentlich etwas verstellen.
// Der Editor wird erst dann geladen; eine Anzeige trägt ihn nicht mit.
const editing = new URLSearchParams(location.search).has('edit');
const LayoutEditor = defineAsyncComponent(() => import('./editor/LayoutEditor.vue'));
const ready = ref(false);

/** Holt das Layout vom Kern und abonniert, was es braucht. Ist es noch dasselbe, bleibt alles, wie es ist. */
async function loadLayout(): Promise<void> {
  const loaded = await getJson<LoadedLayout>(`/layouts/${encodeURIComponent(name)}`);
  if (layout.value && loaded.rev !== undefined && loaded.rev === layout.value.rev) return;
  layout.value = loaded;
  const ids = datapointsOf(loaded);
  // Für den Wechsel zwischen Tag- und Nachtschema braucht jede Anzeige den Sonnenstand, gleich welches Layout sie zeigt
  if (nightTheme.value) ids.add(`${astroSource.value}:night`);
  subscribe([...ids], name);
}

onMounted(async () => {
  adoptTokenFromAddress();
  // Wird das Token an eine schon geöffnete Seite angehängt, lädt der Browser nicht neu – das holen wir nach.
  window.addEventListener('hashchange', () => {
    if (adoptTokenFromAddress()) location.reload();
  });
  try {
    applySite(await getJson<SiteSettings>('/site'));
    ready.value = true;
    if (editing) return;
    await loadLayout();
    connect();
    // Wird das Layout geändert – im Editor, über die API oder von Hand in der Datei –, übernimmt es die Anzeige ohne Neuladen.
    // Scheitert das Nachladen, bleibt stehen, was da ist.
    onLayoutChanged(() => void loadLayout().catch(() => undefined));
  } catch (cause) {
    denied.value = cause instanceof AccessDenied;
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

// Tag und Nacht: Nach Sonnenuntergang wechselt die Anzeige auf ihr Nachtschema, vor Sonnenaufgang zurück –
// wann genau, legt die Quelle fest
watch(
  () => (nightTheme.value ? datapoints.get(`${astroSource.value}:night`)?.value : undefined),
  (night) => {
    if (typeof night === 'boolean') setDaylight(!night);
  },
);
</script>

<template>
  <p v-if="denied" class="notice">{{ t('app.notUnlocked', { error }) }}</p>
  <p v-else-if="error" class="notice">{{ t('app.layoutFailed', { error }) }}</p>
  <LayoutEditor v-else-if="editing && ready" :name="name" />
  <LayoutGrid v-else-if="layout" :layout="layout" />
  <div v-if="layout && !connected" class="offline" role="status">{{ t('app.offline') }}</div>
  <EventLayer v-if="layout" />
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--bg-ink);
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
