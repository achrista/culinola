<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';

/**
 * Eine fremde Webseite in einer Kachel – etwa ein Regenradar, ein Diagramm aus Grafana oder die Seite
 * eines Geräts im Haus. Die Kachel ist zunächst nur Vorschau: Antippen zeigt die Seite über die ganze
 * Anzeige, dort lässt sie sich bedienen. Viele Seiten verbieten das Einbetten; dann sagt die Kachel das,
 * statt leer zu bleiben.
 */
const props = defineProps<{
  config: {
    url: string;
    label?: string;
    /** Abstand, in dem die Seite neu geladen wird; ohne Angabe bleibt sie stehen. */
    refreshMinutes?: number;
    /** Verkleinert oder vergrößert die Seite in der Kachel: 0.5 zeigt doppelt so viel. */
    zoom?: number;
    /** Die Seite lässt sich schon in der Kachel bedienen, nicht erst nach dem Antippen. */
    interactive?: boolean;
  };
}>();

const { t } = useI18n();
const stamp = ref(0);
const full = ref(false);
const refusal = ref('');
let timer: number | undefined;

const address = computed(() => (/^https?:\/\//i.test(props.config.url ?? '') ? props.config.url : ''));
/** Eine gesicherte Anzeige darf keine ungesicherte Seite einbetten – der Browser lässt die Fläche dann leer. */
const mixed = computed(() => location.protocol === 'https:' && /^http:\/\//i.test(address.value));
const zoom = computed(() => {
  const wanted = props.config.zoom ?? 1;
  return full.value || !(wanted >= 0.2 && wanted <= 3) ? 1 : wanted;
});
/**
 * Die Seite läuft abgeschottet: Sie darf rechnen und Formulare schicken, aber weder die Anzeige selbst auf
 * eine andere Adresse lenken noch Fenster öffnen. Eine Seite vom selben Rechner wie Culinola bekommt zudem
 * keinen Zugriff auf dessen Speicher.
 */
const sandbox = computed(() => {
  let same = false;
  try {
    same = new URL(address.value).origin === location.origin;
  } catch {
    // Eine Adresse, die keine ist, wird gar nicht erst geladen.
  }
  return same ? 'allow-scripts allow-forms' : 'allow-scripts allow-forms allow-same-origin';
});
const trouble = computed(() => (!address.value ? t('web.invalid') : mixed.value ? t('web.mixed') : refusal.value ? t('web.refused', { detail: refusal.value }) : ''));

onMounted(async () => {
  const minutes = props.config.refreshMinutes ?? 0;
  if (minutes > 0) {
    timer = window.setInterval(
      () => {
        // Solange jemand die Seite groß vor sich hat, wird sie ihm nicht unter den Fingern neu geladen
        if (!full.value) stamp.value++;
      },
      Math.max(1, minutes) * 60_000,
    );
  }
  if (!address.value || mixed.value) return;
  try {
    const result = await getJson<{ ok: boolean; reason?: string; detail?: string }>(`/embed?url=${encodeURIComponent(address.value)}`);
    // Erreicht der Kern die Seite nicht, kann die Anzeige sie trotzdem erreichen – nur ein Verbot ist sicher
    if (!result.ok && result.reason === 'refused') refusal.value = result.detail ?? '';
  } catch {
    // Ohne Auskunft wird die Seite einfach versucht.
  }
});
onUnmounted(() => window.clearInterval(timer));
</script>

<template>
  <section class="web" :class="{ full, passive: !config.interactive && !full }">
    <p v-if="trouble" class="none">
      <strong v-if="config.label">{{ config.label }}</strong>
      <span>{{ trouble }}</span>
    </p>
    <template v-else>
      <div class="page" :style="{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }">
        <iframe :key="stamp" :src="address" :title="config.label ?? address" :sandbox="sandbox" referrerpolicy="no-referrer" />
      </div>
      <!-- Als Vorschau fängt die Kachel jede Berührung ab und öffnet die große Ansicht -->
      <button v-if="!full && !config.interactive" class="cover" :aria-label="t('web.open', { title: config.label ?? address })" @click="full = true" />
      <button v-else-if="!full" class="grow" :aria-label="t('web.open', { title: config.label ?? address })" @click="full = true">⤢</button>
      <button v-else class="close" :aria-label="t('web.close')" @click="full = false">×</button>
      <span v-if="config.label && !full" class="label">{{ config.label }}</span>
    </template>
  </section>
</template>

<style scoped>
.web {
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}
.page {
  transform-origin: 0 0;
}
iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: #fff;
}
.passive iframe {
  pointer-events: none;
}
.cover {
  position: absolute;
  inset: 0;
  padding: 0;
  background: none;
}
.grow,
.close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 22px;
  line-height: 1;
}
.close {
  width: 56px;
  height: 56px;
  font-size: 30px;
}
.label {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 14px;
  pointer-events: none;
}
.none {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  text-align: center;
  color: var(--mute);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.none strong {
  color: var(--ink);
}
/* Angetippt liegt die Seite über der ganzen Anzeige und lässt sich bedienen; das Kreuz bringt die Kachel zurück */
.full {
  position: fixed;
  inset: 0;
  z-index: 60;
  border-radius: 0;
}
</style>
