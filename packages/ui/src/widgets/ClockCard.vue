<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const now = ref(new Date());
let timer: number | undefined;
onMounted(() => (timer = window.setInterval(() => (now.value = new Date()), 1000)));
onUnmounted(() => window.clearInterval(timer));

const two = (value: number) => String(value).padStart(2, '0');
const date = new Intl.DateTimeFormat(navigator.language || 'de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
</script>

<template>
  <section class="clock">
    <div class="time">
      <span class="hm">{{ two(now.getHours()) }}:{{ two(now.getMinutes()) }}</span>
      <span class="sec">{{ two(now.getSeconds()) }}</span>
    </div>
    <div class="date">{{ date.format(now) }}</div>
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
