<script setup lang="ts">
/**
 * Kleines Zeichen vor der Überschrift einer Kachel. Die Zeichen sind hier gezeichnet,
 * als Linien in der Farbe der Überschrift – so passen sie zu jedem Farbschema.
 */
defineProps<{ name: 'phone' | 'mail' | 'calendar' | 'bell' | 'cart' | 'check' | 'radio' | 'pot' }>();
</script>

<template>
  <svg class="title-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path v-if="name === 'phone'" d="M5 3.5h3.4l1.6 4.6-2 1.6a12.5 12.5 0 0 0 6.3 6.3l1.6-2 4.6 1.6V19a2 2 0 0 1-2 2A16 16 0 0 1 3 5.5a2 2 0 0 1 2-2Z" />
    <path v-else-if="name === 'mail'" d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm-1.5 2.5L12 13l8.5-5.5" />
    <path v-else-if="name === 'calendar'" d="M5.5 5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm-2 5h17M8 3v4m8-4v4" />
    <path v-else-if="name === 'bell'" d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Zm4 4.5a2 2 0 0 0 4 0" />
    <path v-else-if="name === 'cart'" d="M2.5 4h2.7l2.3 10.5h10.3L20 7H6.3M9.5 19.3a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6Zm7.5 0a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6Z" />
    <path v-else-if="name === 'check'" d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm1 8.5 3 3 5-6.5" />
    <path v-else-if="name === 'radio'" d="M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Zm2 0 9-4.5M8.5 16.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm6-4h3.5m-3.5 3.5h3.5" />
    <path v-else d="M5 10.5h14V16a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5.5Zm-2.5 0h19M9.5 7c0-1.2 1-1.3 1-2.5M13.5 7c0-1.2 1-1.3 1-2.5" />
  </svg>
</template>

<style scoped>
.title-icon {
  flex: none;
  align-self: center;
  width: 1.3em;
  height: 1.3em;
  margin-right: 0.4em;
  vertical-align: -0.28em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
