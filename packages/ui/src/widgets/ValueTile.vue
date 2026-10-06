<script setup lang="ts">
import type { DatapointValue } from '@culinola/sdk';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getSeries } from '../api.ts';
import { formatValue } from '../format.ts';
import { datapoints } from '../store.ts';

interface Warn {
  lowAlarm?: number;
  lowWarn?: number;
  highWarn?: number;
  highAlarm?: number;
}
/** Nebenwert: nur die Kennung oder mit eigener Umrechnung, Einheit und Stellenzahl. */
interface Secondary {
  datapoint: string;
  factor?: number;
  unit?: string;
  decimals?: number;
}
const props = defineProps<{
  config: {
    datapoint: string;
    label?: string;
    secondary?: string | Secondary;
    factor?: number;
    unit?: string;
    decimals?: number;
    warn?: Warn;
    /** Übersetzt Zustandswerte in Text, z. B. { "0": "aus", "1": "läuft", "3": "fertig" }. */
    map?: Record<string, string>;
  };
}>();

/** Manche Quellen liefern Anteile als Bruchteil (0,58 statt 58 %); `factor` rechnet für die Anzeige um. */
const scale = (value: DatapointValue | undefined, factor?: number) => (typeof value === 'number' && factor !== undefined ? value * factor : value);

const main = computed(() => datapoints.get(props.config.datapoint));
const mainValue = computed(() => scale(main.value?.value, props.config.factor));
const secondaryConfig = computed<Secondary | undefined>(() => (typeof props.config.secondary === 'string' ? { datapoint: props.config.secondary } : props.config.secondary));
const secondary = computed(() => (secondaryConfig.value ? datapoints.get(secondaryConfig.value.datapoint) : undefined));
const mapped = computed(() => {
  const value = mainValue.value;
  if (!props.config.map || value === null || value === undefined) return undefined;
  return props.config.map[typeof value === 'number' ? String(Math.round(value)) : String(value)];
});
const display = computed(() => mapped.value ?? formatValue(mainValue.value, props.config.decimals));
const unit = computed(() => (mapped.value !== undefined ? '' : (props.config.unit ?? main.value?.unit ?? '')));

/** grün = im Bereich, gelb = Achtung, rot = außerhalb, grau = keine Bewertung */
const status = computed(() => {
  const value = mainValue.value;
  const warn = props.config.warn;
  if (typeof value !== 'number' || !warn || main.value?.quality !== 'good') return 'none';
  if ((warn.highAlarm !== undefined && value >= warn.highAlarm) || (warn.lowAlarm !== undefined && value <= warn.lowAlarm)) return 'alarm';
  if ((warn.highWarn !== undefined && value >= warn.highWarn) || (warn.lowWarn !== undefined && value <= warn.lowWarn)) return 'warn';
  return 'ok';
});

// Verlaufslinie der letzten Stunde: einmal laden, danach mit jedem neuen Wert fortschreiben
const history = ref<number[]>([]);
async function loadHistory() {
  try {
    const [series] = await getSeries([props.config.datapoint], '-1h', undefined, '2m');
    history.value = (series?.points ?? []).map(([, value]) => value);
  } catch {
    history.value = [];
  }
}
let timer: number | undefined;
onMounted(() => {
  void loadHistory();
  timer = window.setInterval(() => void loadHistory(), 120_000);
});
onUnmounted(() => window.clearInterval(timer));
watch(
  () => main.value?.value,
  (value) => {
    if (typeof value === 'number') history.value = [...history.value.slice(-59), value];
  },
);

const sparkline = computed(() => {
  const values = history.value;
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return values.map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(1)},${(26 - ((value - min) / span) * 24).toFixed(1)}`).join(' ');
});
</script>

<template>
  <section class="tile">
    <header>
      <span class="name">{{ config.label ?? main?.label ?? config.datapoint }}</span>
      <span v-if="secondary && secondaryConfig" class="secondary">{{ formatValue(scale(secondary.value, secondaryConfig.factor), secondaryConfig.decimals) }} {{ secondaryConfig.unit ?? secondary.unit }}</span>
      <span class="dot" :class="status" role="img" :aria-label="{ ok: 'im Bereich', warn: 'Achtung', alarm: 'außerhalb', none: 'ohne Bewertung' }[status]"></span>
    </header>
    <div class="reading">
      <span class="value">{{ display }}</span>
      <span class="unit">{{ unit }}</span>
      <svg v-if="sparkline && mapped === undefined" class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkline" /></svg>
    </div>
  </section>
</template>

<style scoped>
.tile {
  container-type: size;
  box-sizing: border-box;
  min-width: 0;
  padding: 7px 12px;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: var(--mute);
}
.name {
  font-weight: 500;
  white-space: nowrap;
}
.secondary {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot {
  flex: none;
  margin-left: auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--none);
}
.secondary + .dot {
  margin-left: 0;
}
.dot.ok {
  background: var(--ok);
}
.dot.warn {
  background: var(--warn);
}
.dot.alarm {
  background: var(--alarm);
}
.reading {
  display: flex;
  align-items: baseline;
  gap: 5px;
}
.value {
  font-family: var(--font-num);
  font-weight: var(--num-weight);
  font-size: clamp(24px, 52cqh, 72px);
  line-height: 0.9;
  white-space: nowrap;
}
.unit {
  font-size: 15px;
  color: var(--mute);
}
.spark {
  flex: none;
  margin-left: auto;
  width: 62px;
  height: 20px;
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
/* Schmale Kachel: die Verlaufslinie weicht zuerst */
@container (max-width: 200px) {
  .spark {
    display: none;
  }
}
</style>
