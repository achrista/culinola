<script setup lang="ts">
// Hält im Layout einen Platz frei und sagt, was dort einmal stehen wird.
defineProps<{ config: { title?: string; text?: string } }>();
</script>

<template>
  <section class="note">
    <strong v-if="config.title">{{ config.title }}</strong>
    <span v-if="config.text">{{ config.text }}</span>
  </section>
</template>

<style scoped>
.note {
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 12px;
  border: 1px dashed var(--none);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  text-align: center;
  color: var(--mute);
  font-size: 15px;
  overflow: hidden;
}
strong {
  font-weight: 600;
  color: var(--ink);
}
</style>
