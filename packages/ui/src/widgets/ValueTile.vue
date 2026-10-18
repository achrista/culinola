<script setup lang="ts">
import type { DatapointValue } from '@culinola/sdk';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getSeries } from '../api.ts';
import { formatValue } from '../format.ts';
import { isOn } from '../state.ts';
import { datapoints } from '../store.ts';
import ChartCard, { type ChartConfig } from './ChartCard.vue';
import DetailOverlay from './DetailOverlay.vue';

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
    /**
     * Bereich des Werts für die Ringanzeige: In einer Kachel, die hoch genug ist, steht der Wert dann in einem Ring,
     * der sich mit ihm füllt – etwa Ladestand, Leistung oder Füllstand. In einer flachen Kachel bleibt es bei der Zahl.
     */
    gauge?: { min?: number; max: number };
    /**
     * Datenpunkt, der sagt, ob der Wert aktuell ist – etwa ein Schalter, den die Quelle setzt, solange sie frische
     * Daten bekommt. Ist er aus, steht die Kachel ausgegraut da: Der Wert ist der letzte bekannte.
     */
    fresh?: string;
    /**
     * Das Diagramm, das ein Tippen auf die Kachel zeigt – aufgebaut wie die Einstellungen einer Diagramm-Kachel.
     * So können mehrere Kacheln dasselbe Diagramm zeigen, etwa alle Temperaturen. Ohne Angabe zeigt es den
     * Verlauf des eigenen Werts, mit `false` öffnet die Kachel nichts.
     */
    chart?: false | ChartConfig;
  };
}>();

/** Manche Quellen liefern Anteile als Bruchteil (0,58 statt 58 %); `factor` rechnet für die Anzeige um. */
const { t } = useI18n();
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
  if (typeof value !== 'number' || !warn || main.value?.quality !== 'good' || stale.value) return 'none';
  if ((warn.highAlarm !== undefined && value >= warn.highAlarm) || (warn.lowAlarm !== undefined && value <= warn.lowAlarm)) return 'alarm';
  if ((warn.highWarn !== undefined && value >= warn.highWarn) || (warn.lowWarn !== undefined && value <= warn.lowWarn)) return 'warn';
  return 'ok';
});

/** Ob der Wert veraltet ist: nur, wenn ein Datenpunkt dafür angegeben ist und er „aus“ meldet. */
const stale = computed(() => (props.config.fresh ? !isOn(datapoints.get(props.config.fresh)?.value) : false));

/** Anteil des Rings, der gefüllt ist: 0 bis 1. */
const filled = computed(() => {
  const value = mainValue.value;
  const gauge = props.config.gauge;
  if (!gauge || typeof value !== 'number') return 0;
  const min = gauge.min ?? 0;
  return gauge.max > min ? Math.min(1, Math.max(0, (value - min) / (gauge.max - min))) : 0;
});
// Der Ring ist ein Dreiviertelkreis, unten offen: Umfang 2·π·42, davon drei Viertel
const ARC = 2 * Math.PI * 42 * 0.75;

const name = computed(() => props.config.label ?? main.value?.label ?? props.config.datapoint);

/** Was ein Tippen öffnet: das eingestellte Diagramm oder der Verlauf des eigenen Werts – Zustände als Treppe. */
const chart = computed<ChartConfig | undefined>(() => {
  const own = props.config.chart;
  if (own === false) return undefined;
  if (own?.series?.length) return own;
  const factor = props.config.factor;
  return { title: own?.title || name.value, series: [{ datapoint: props.config.datapoint, label: name.value, step: !!props.config.map, ...(factor !== undefined && { factor }) }] };
});
const opened = ref(false);
function open() {
  if (chart.value) opened.value = true;
}

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
  <section
    class="tile"
    :class="{ 'has-gauge': !!config.gauge, stale, opens: !!chart }"
    :title="stale ? t('tile.stale') : undefined"
    :role="chart ? 'button' : undefined"
    :tabindex="chart ? 0 : undefined"
    :aria-label="chart ? t('tile.openChart', { name }) : undefined"
    @click="open"
    @keydown.enter.self="open"
    @keydown.space.self.prevent="open"
  >
    <!-- Die innere Hülle trägt die Anordnung, damit sie sich nach der Größe der Kachel richten kann -->
    <div class="tile-row">
    <header>
      <span class="name">{{ name }}</span>
      <span v-if="secondary && secondaryConfig" class="secondary">{{ formatValue(scale(secondary.value, secondaryConfig.factor), secondaryConfig.decimals) }} {{ secondaryConfig.unit ?? secondary.unit }}</span>
      <span class="dot" :class="status" role="img" :aria-label="t(`tile.status.${status}`)"></span>
    </header>
    <div class="reading">
      <span class="value">{{ display }}</span>
      <span class="unit">{{ unit }}</span>
      <svg v-if="sparkline && mapped === undefined" class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline :points="sparkline" /></svg>
    </div>
    </div>
    <!-- Ringanzeige: nur in Kacheln, die hoch genug dafür sind -->
    <div v-if="config.gauge" class="gauge">
      <div class="ring" :class="status">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="track" cx="50" cy="50" r="42" :stroke-dasharray="`${ARC} 264`" />
          <circle class="fill" cx="50" cy="50" r="42" :stroke-dasharray="`${ARC * filled} 264`" />
        </svg>
        <span class="center">
          <span class="value">{{ display }}</span>
          <span class="unit">{{ unit }}</span>
        </span>
        <span class="name">{{ name }}</span>
      </div>
      <span v-if="secondary && secondaryConfig" class="below">{{ formatValue(scale(secondary.value, secondaryConfig.factor), secondaryConfig.decimals) }} {{ secondaryConfig.unit ?? secondary.unit }}</span>
    </div>
    <DetailOverlay v-if="opened && chart" :title="chart.title || name" @close="opened = false">
      <ChartCard :config="chart" plain />
    </DetailOverlay>
  </section>
</template>

<style scoped>
.tile {
  container-type: size;
  box-sizing: border-box;
  min-width: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}
.tile.opens {
  cursor: pointer;
}
.tile.opens:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.tile-row {
  box-sizing: border-box;
  height: 100%;
  padding: 7px 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
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
  background: var(--dot-idle);
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
  font-size: clamp(24px, 43cqh, 72px);
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
/* Flache Kachel: alles in einer Zeile – Punkt, Name, Nebenwert, Wert. So passen doppelt so viele Werte auf dieselbe Fläche. */
@container (max-height: 58px) {
  .tile-row {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    padding: 0 10px;
  }
  header {
    flex: 1;
    min-width: 0;
  }
  .dot {
    order: -1;
    margin-left: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .value {
    font-size: clamp(20px, 74cqh, 36px);
  }
  .spark {
    display: none;
  }
}
@container (max-height: 58px) and (max-width: 190px) {
  .secondary {
    display: none;
  }
}

/* Veraltet: Der letzte bekannte Wert bleibt lesbar, tritt aber zurück */
.stale .tile-row,
.stale .gauge {
  opacity: 0.4;
  filter: grayscale(1);
}
.stale .fill {
  stroke: var(--none);
}

/* Ringanzeige: Der Wert steht in einem Ring, der Name im offenen Teil darunter, der Nebenwert unter dem Ring. */
.gauge {
  display: none;
}
@container (min-height: 110px) {
  .has-gauge .tile-row {
    display: none;
  }
  .has-gauge .gauge {
    box-sizing: border-box;
    height: 100%;
    padding: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
}
.ring {
  position: relative;
  flex: 0 1 auto;
  height: min(100cqh - 12px, 100cqw - 12px);
  aspect-ratio: 1;
  min-height: 0;
}
/* Mit Nebenwert darunter bleibt dem Ring etwas weniger Höhe */
.gauge:has(.below) .ring {
  height: min(100cqh - 40px, 100cqw - 12px);
}
.ring svg {
  width: 100%;
  height: 100%;
  /* Der Ring beginnt links unten und endet rechts unten */
  transform: rotate(135deg);
}
.ring circle {
  fill: none;
  stroke-width: 9;
  stroke-linecap: round;
}
.track {
  stroke: var(--soft);
}
.fill {
  stroke: var(--accent);
  transition: stroke-dasharray 0.6s ease;
}
.ring.ok .fill {
  stroke: var(--ok);
}
.ring.warn .fill {
  stroke: var(--warn);
}
.ring.alarm .fill {
  stroke: var(--alarm);
}
.center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 3px;
  /* etwas über der Mitte, weil unten der Name steht */
  padding-top: 31%;
}
.gauge .value {
  font-size: clamp(20px, min(26cqh, 21cqw), 64px);
}
.gauge .unit {
  font-size: clamp(12px, 9cqh, 18px);
}
.gauge .name {
  position: absolute;
  left: 12%;
  right: 12%;
  bottom: 9%;
  text-align: center;
  color: var(--mute);
  font-size: clamp(11px, 9cqh, 16px);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.below {
  flex: none;
  font-family: var(--font-num);
  font-size: clamp(15px, 13cqh, 24px);
  line-height: 1.1;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>
