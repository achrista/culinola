<script setup lang="ts">
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { type ECharts, init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { getSeries } from '../api.ts';

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface SeriesConfig {
  datapoint: string;
  label?: string;
  area?: boolean;
}
const props = defineProps<{ config: { title?: string; series?: SeriesConfig[] } }>();

const PERIODS = [
  { id: 'day', label: 'Tag', from: '-24h', step: '5m' },
  { id: 'week', label: 'Woche', from: '-7d', step: '1h' },
  { id: 'month', label: 'Monat', from: '-30d', step: '6h' },
] as const;
const period = ref<(typeof PERIODS)[number]['id']>('day');
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
  try {
    const data = await getSeries(list.map((entry) => entry.datapoint), selected.from, selected.step);
    failed.value = '';
    chart.setOption(
      {
        animation: false,
        textStyle: { fontFamily: token('--font-text'), color: token('--mute') },
        color: [1, 2, 3, 4].map((index) => token(`--series-${index}`)),
        grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
        legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 4, textStyle: { color: token('--mute') } },
        tooltip: { trigger: 'axis', backgroundColor: token('--card'), borderColor: token('--line'), textStyle: { color: token('--ink') } },
        xAxis: { type: 'time', axisLine: { lineStyle: { color: token('--line') } }, axisLabel: { color: token('--mute') }, splitLine: { show: false } },
        yAxis: { type: 'value', axisLabel: { color: token('--mute') }, splitLine: { lineStyle: { color: token('--line') } } },
        series: list.map((entry, index) => ({
          name: entry.label ?? entry.datapoint,
          type: 'line',
          showSymbol: false,
          smooth: false,
          lineStyle: { width: 2 },
          areaStyle: entry.area ? { opacity: 0.3 } : undefined,
          data: data[index]?.points ?? [],
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
  <section class="card">
    <header>
      <h2>{{ config.title ?? 'Verlauf' }}</h2>
      <div class="periods" role="group" aria-label="Zeitraum">
        <button v-for="entry in PERIODS" :key="entry.id" :class="{ active: period === entry.id }" :aria-pressed="period === entry.id" @click="period = entry.id">
          {{ entry.label }}
        </button>
      </div>
    </header>
    <p v-if="failed" class="error" role="alert">Verlauf nicht verfügbar: {{ failed }}</p>
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
