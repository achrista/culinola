<script setup lang="ts">
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { type ECharts, init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getSeries } from '../api.ts';

use([LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

interface SeriesConfig {
  datapoint: string;
  label?: string;
  /** Fläche unter der Linie füllen. */
  area?: boolean;
  /** Prognose: gestrichelt gezeichnet, darf in die Zukunft reichen. */
  forecast?: boolean;
  /** Rechnet die Werte um, wie es eine Messwert-Kachel für die Anzeige tut (100 für einen Anteil von 0,58). */
  factor?: number;
  /** Als Treppe zeichnen – für Zustände wie „aus“, „läuft“, „fertig“, die nicht stetig ineinander übergehen. */
  step?: boolean;
}
export interface ChartConfig {
  title?: string;
  series?: SeriesConfig[];
}
/** `plain`: ohne eigene Überschrift und Kartengrund – so steht das Diagramm in der Einzelansicht einer Kachel. */
const props = defineProps<{ config: ChartConfig; plain?: boolean }>();

const PERIODS = [
  { id: 'today', step: '5m' },
  { id: 'week', step: '1h' },
  { id: 'month', step: '6h' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

/** „Heute“ läuft von 0 bis 24 Uhr, damit eine Prognose für den Rest des Tages Platz hat. */
function range(id: PeriodId): { from: Date; to: Date } {
  const now = new Date();
  if (id === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start, to: new Date(start.getTime() + 24 * 3_600_000) };
  }
  return { from: new Date(now.getTime() - (id === 'week' ? 7 : 30) * 24 * 3_600_000), to: now };
}

const { t } = useI18n();
const period = ref<PeriodId>('today');
const failed = ref('');
const target = ref<HTMLElement>();
let chart: ECharts | undefined;
let timer: number | undefined;
let observer: ResizeObserver | undefined;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

async function draw() {
  const list = props.config.series ?? [];
  if (!chart || list.length === 0) return;
  const selected = PERIODS.find((entry) => entry.id === period.value)!;
  const { from, to } = range(selected.id);
  try {
    const data = await getSeries(list.map((entry) => entry.datapoint), from.toISOString(), to.toISOString(), selected.step);
    failed.value = '';
    const now = Date.now();
    chart.setOption(
      {
        animation: false,
        textStyle: { fontFamily: token('--font-text'), color: token('--mute') },
        color: [1, 2, 3, 4].map((index) => token(`--series-${index}`)),
        grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
        legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 4, textStyle: { color: token('--mute') } },
        tooltip: { trigger: 'axis', backgroundColor: token('--card'), borderColor: token('--line'), textStyle: { color: token('--ink') } },
        xAxis: {
          type: 'time',
          min: from.getTime(),
          max: to.getTime(),
          axisLine: { lineStyle: { color: token('--line') } },
          axisLabel: { color: token('--mute') },
          splitLine: { show: false },
        },
        yAxis: { type: 'value', axisLabel: { color: token('--mute') }, splitLine: { lineStyle: { color: token('--line') } } },
        series: list.map((entry, index) => ({
          name: entry.label ?? entry.datapoint,
          type: 'line',
          showSymbol: false,
          step: entry.step ? 'end' : undefined,
          lineStyle: { width: 2, type: entry.forecast ? 'dashed' : 'solid' },
          areaStyle: entry.area && !entry.forecast ? { opacity: 0.3 } : undefined,
          // Messwerte enden jetzt; nur eine Prognose darf darüber hinausreichen
          data: (entry.forecast ? (data[index]?.points ?? []) : (data[index]?.points ?? []).filter(([time]) => time <= now)).map(([time, value]) => [
            time,
            entry.factor !== undefined ? value * entry.factor : value,
          ]),
          markLine:
            index === 0 && selected.id === 'today'
              ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: token('--mute'), type: 'dotted', width: 1 }, data: [{ xAxis: now }] }
              : undefined,
        })),
      },
      true,
    );
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}

onMounted(() => {
  chart = init(target.value!);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(target.value!);
  void draw();
  timer = window.setInterval(() => void draw(), 60_000);
});
onUnmounted(() => {
  window.clearInterval(timer);
  observer?.disconnect();
  chart?.dispose();
});
watch(period, () => void draw());
</script>

<template>
  <section class="card" :class="{ plain }">
    <header>
      <h2 v-if="!plain">{{ config.title ?? t('chart.title') }}</h2>
      <div class="periods" role="group" :aria-label="t('chart.period')">
        <button v-for="entry in PERIODS" :key="entry.id" :class="{ active: period === entry.id }" :aria-pressed="period === entry.id" @click="period = entry.id">
          {{ t(`chart.${entry.id}`) }}
        </button>
      </div>
    </header>
    <p v-if="failed" class="error" role="alert">{{ t('chart.failed', { error: failed }) }}</p>
    <div ref="target" class="plot"></div>
  </section>
</template>

<style scoped>
.card {
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
header {
  display: flex;
  align-items: center;
  gap: 16px;
}
h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
}
.periods {
  margin-left: auto;
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--soft);
}
.periods button {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 6px;
  background: transparent;
  color: var(--mute);
  font-size: 15px;
}
.periods button.active {
  background: var(--card);
  color: var(--ink);
  font-weight: 600;
}
.card.plain {
  flex: 1;
  padding: 12px 16px 16px;
  border-radius: 0;
  background: transparent;
}
.plot {
  flex: 1;
  min-height: 0;
}
.error {
  margin: 0;
  color: var(--alarm);
  font-size: 14px;
}
</style>
