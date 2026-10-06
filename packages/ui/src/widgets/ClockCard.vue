<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { region } from '../i18n.ts';

const now = ref(new Date());
let timer: number | undefined;
onMounted(() => (timer = window.setInterval(() => (now.value = new Date()), 1000)));
onUnmounted(() => window.clearInterval(timer));

// Stunden:Minuten und Sekunden getrennt, damit die Sekunden kleiner gesetzt werden können.
// Die Region bestimmt, ob 24 Stunden oder 12 Stunden mit Tageshälfte gezeigt werden.
const parts = computed(() => {
  const list = new Intl.DateTimeFormat(region.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now.value);
  const pick = (type: string) => list.find((part) => part.type === type)?.value ?? '';
  return { hm: `${pick('hour')}:${pick('minute')}`, sec: pick('second'), dayPeriod: pick('dayPeriod') };
});
const date = computed(() => new Intl.DateTimeFormat(region.value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now.value));
</script>

<template>
  <section class="clock">
    <div class="time">
      <span class="hm">{{ parts.hm }}</span>
      <span class="sec">{{ parts.sec }}</span>
      <span v-if="parts.dayPeriod" class="sec">{{ parts.dayPeriod }}</span>
    </div>
    <div class="date">{{ date }}</div>
  </section>
</template>

<style scoped>
.clock {
  container-type: size;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 8px;
  min-width: 0;
}
.time {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font-num);
  font-weight: var(--num-weight);
  line-height: 0.9;
}
.hm {
  font-size: clamp(40px, 62cqh, 140px);
}
.sec {
  font-size: clamp(20px, 28cqh, 64px);
}
.date {
  color: var(--mute);
  font-size: clamp(14px, 12cqh, 22px);
}
</style>
