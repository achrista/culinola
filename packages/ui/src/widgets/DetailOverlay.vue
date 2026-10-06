<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';

/** Füllt den Bildschirm mit der Einzelansicht einer Kachel – Artikel, Rezept, später Mail oder Kontakt. */
defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close');
};
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="overlay" role="dialog" aria-modal="true" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <slot name="actions" />
        <button class="close" @click="emit('close')">{{ t('overlay.close') }}</button>
      </header>
      <div class="body"><slot /></div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Tasten im Kopf – auch die aus dem Einschub – sind groß genug für den Finger. */
header :deep(button),
header :deep(a) {
  flex: none;
  min-height: 48px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--soft);
  color: var(--ink);
  font-weight: 500;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
header :deep(button:disabled) {
  opacity: 0.4;
}
header .close {
  background: var(--accent);
  color: var(--on-accent);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
