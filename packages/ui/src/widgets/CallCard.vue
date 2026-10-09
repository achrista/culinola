<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';
import { shortWhen } from '../format.ts';
import { region } from '../i18n.ts';
import { mediaUrl } from '../media.ts';
import { vScrollHome } from '../scroll.ts';
import { chime } from '../sound.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';

interface Call {
  id: string;
  kind: 'incoming' | 'missed' | 'outgoing' | 'rejected' | 'active';
  number: string;
  name: string;
  date: string;
  minutes: number;
  device: string;
  voicemail: boolean;
  /** Woher die Nummer kommt: Ort, Land oder Art der Nummer. */
  place?: string;
}

/**
 * Anrufe und Nachrichten des Anrufbeantworters in einer Liste, das Neueste zuerst.
 * Antippen zeigt die Einzelheiten und spielt eine aufgenommene Nachricht ab.
 */
const props = defineProps<{
  config: {
    source?: string;
    title?: string;
    /** Kurzer Ton, wenn es zu klingeln beginnt; mit false bleibt die Anzeige still. */
    sound?: boolean;
  };
}>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'fritzbox');
const calls = ref<Call[]>([]);
const opened = ref<Call>();

async function load() {
  try {
    calls.value = await getJson<Call[]>(`/resources/${encodeURIComponent(source.value)}/calls`);
  } catch {
    // Die zuletzt geladene Liste bleibt stehen.
  }
}
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

/** Nummer des Anrufers, solange es klingelt – mit Namen, wenn die Nummer aus der Liste bekannt ist. */
const ringing = computed(() => {
  const number = datapoints.get(`${source.value}:ringing`)?.value;
  if (typeof number !== 'string' || !number) return '';
  const known = calls.value.find((call) => call.number === number && call.name)?.name;
  if (known) return known;
  if (number === '?') return t('calls.unknown');
  // Bei einem unbekannten Anrufer hilft die Herkunft der Nummer
  const place = datapoints.get(`${source.value}:ringingPlace`)?.value;
  return typeof place === 'string' && place ? `${number} · ${place}` : number;
});

// Ein kurzer Ton, sobald es zu klingeln beginnt – einmal je Anruf, nicht solange es klingelt
watch(
  () => datapoints.get(`${source.value}:ringing`)?.value,
  (now, before) => {
    if (now && !before && props.config.sound !== false) chime();
  },
);

const who = (call: Call) => call.name || call.number || t('calls.unknown');
const duration = (call: Call) => (call.minutes > 0 ? t('calls.minutes', { n: call.minutes }) : '');
const dial = (number: string) => `tel:${number.replace(/[^\d+]/g, '')}`;
</script>

<template>
  <section class="calls">
    <h3>{{ props.config.title ?? t('calls.title') }}</h3>
    <p v-if="ringing" class="ringing" role="status">{{ t('calls.ringing', { who: ringing }) }}</p>
    <ul v-if="calls.length" v-scroll-home>
      <li v-for="call in calls" :key="call.id">
        <button :class="call.kind" @click="opened = call">
          <!-- Pfeil nach innen: eingehend. Pfeil nach außen: ausgehend. Rot: verpasst oder abgewiesen. Zwei Kreise: Nachricht. -->
          <svg class="icon" viewBox="0 0 24 24" role="img" :aria-label="t(call.voicemail ? 'calls.kind.voicemail' : `calls.kind.${call.kind}`)">
            <path v-if="call.voicemail" d="M6.5 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm11 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-11 0h11" />
            <path v-else-if="call.kind === 'outgoing'" d="M7 17 17 7m0 0H9m8 0v8" />
            <path v-else-if="call.kind === 'rejected'" d="M5.6 5.6l12.8 12.8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
            <path v-else d="M17 7 7 17m0 0h8m-8 0V9" />
          </svg>
          <span class="who">{{ who(call) }}</span>
          <span class="when">{{ shortWhen(call.date) }}</span>
          <span class="more">
            <template v-if="call.voicemail">{{ t('calls.message') }}</template>
            <template v-else-if="call.name && call.number">{{ call.number }}</template>
            <!-- Unbekannter Anrufer: woher die Nummer kommt -->
            <template v-else-if="call.place">{{ call.place }}</template>
            <template v-else>{{ t(`calls.kind.${call.kind}`) }}</template>
          </span>
          <span class="length">{{ duration(call) }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="none">{{ t('calls.none') }}</p>

    <DetailOverlay v-if="opened" :title="who(opened)" @close="opened = undefined">
      <div class="detail">
        <a v-if="opened.number" class="number" :href="dial(opened.number)">{{ opened.number }}</a>
        <dl>
          <dt>{{ t('calls.what') }}</dt>
          <dd>{{ t(opened.voicemail ? 'calls.kind.voicemail' : `calls.kind.${opened.kind}`) }}</dd>
          <template v-if="opened.place">
            <dt>{{ t('calls.place') }}</dt>
            <dd>{{ opened.place }}</dd>
          </template>
          <dt>{{ t('calls.when') }}</dt>
          <dd>{{ new Intl.DateTimeFormat(region, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(opened.date)) }}</dd>
          <template v-if="opened.minutes">
            <dt>{{ t('calls.duration') }}</dt>
            <dd>{{ duration(opened) }}</dd>
          </template>
          <template v-if="opened.device">
            <dt>{{ t('calls.device') }}</dt>
            <dd>{{ opened.device }}</dd>
          </template>
        </dl>
        <!-- Die Aufnahme kommt über den Kern von der FRITZ!Box -->
        <audio v-if="opened.voicemail" controls autoplay :src="mediaUrl(`/p/${encodeURIComponent(source)}/voicemail/${encodeURIComponent(opened.id)}`)" />
      </div>
    </DetailOverlay>
  </section>
</template>

<style scoped>
.calls {
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
h3 {
  flex: none;
  margin: 0 0 4px;
  color: var(--title-ink);
  font-size: var(--title-size);
  text-transform: var(--title-case);
  letter-spacing: var(--title-spacing);
  font-weight: 600;
}
.ringing {
  flex: none;
  margin: 0 0 4px;
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.calls > ul {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Zwei Zeilen je Anruf: wer und wann, darunter Nummer oder Art und die Dauer */
.calls > ul button {
  width: 100%;
  min-height: 46px;
  padding: 4px 0;
  border-top: 1px solid var(--line);
  background: none;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  column-gap: 8px;
  align-items: center;
  text-align: left;
  line-height: 1.25;
}
li:first-child button {
  border-top: 0;
}
.icon {
  grid-row: span 2;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--mute);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.missed .icon,
.rejected .icon {
  stroke: var(--alarm);
}
.who,
.more {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.who {
  font-size: 16px;
}
.missed .who {
  font-weight: 600;
}
.more {
  color: var(--mute);
  font-size: 14px;
}
.when,
.length {
  color: var(--mute);
  font-size: 13px;
  white-space: nowrap;
  text-align: right;
}
.none {
  margin: auto 0;
  color: var(--mute);
}

.detail {
  padding: 28px clamp(16px, 5vw, 64px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
  font-size: 20px;
}
.number {
  font-family: var(--font-num);
  font-size: 48px;
  line-height: 1;
  color: var(--ink);
  text-decoration: none;
}
dl {
  margin: 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 20px;
}
dt {
  color: var(--mute);
}
dd {
  margin: 0;
}
audio {
  width: min(560px, 100%);
}
</style>
