<script setup lang="ts">
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';
import { mediaUrl } from '../media.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';

interface RecipeInfo {
  id: string;
  title: string;
  category?: string;
  tags: string[];
  time?: string;
  servings?: string;
}
interface Recipe extends RecipeInfo {
  markdown: string;
}

/** Rezepte: auf der Kachel die Auswahl, nach dem Antippen Liste und Leseansicht über den ganzen Bildschirm. */
const props = defineProps<{ config: { source?: string; title?: string } }>();

const SCALE_KEY = 'culinola.recipes.scale';
const SCALES = [0.85, 1, 1.2, 1.45, 1.75];

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'recipes');
const list = ref<RecipeInfo[]>([]);
const open = ref(false);
const category = ref<string>();
const recipe = ref<Recipe>();
const failed = ref('');
const scale = ref(readScale());

async function load() {
  try {
    list.value = await getJson<RecipeInfo[]>(`/resources/${encodeURIComponent(source.value)}/list`);
  } catch {
    // Die zuletzt geladene Liste bleibt stehen.
  }
}
// Der Kern meldet über diesen Datenpunkt, dass sich der Rezeptordner geändert hat
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

const categories = computed(() => [...new Set(list.value.map((entry) => entry.category).filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b)));
const shown = computed(() => (category.value ? list.value.filter((entry) => entry.category === category.value) : list.value));

async function show(id: string) {
  open.value = true;
  failed.value = '';
  try {
    recipe.value = await getJson<Recipe>(`/p/${encodeURIComponent(source.value)}/text/${encodeURIComponent(id)}`);
  } catch (cause) {
    recipe.value = undefined;
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/**
 * Der Rezepttext als HTML. Der Umsetzer lässt eingebettetes HTML und gefährliche
 * Adressen nicht durch; hier kommen nur noch die Bildadressen und Verweise an die Reihe.
 */
const html = computed(() => {
  if (!recipe.value) return '';
  const holder = document.createElement('template');
  holder.innerHTML = micromark(recipe.value.markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  for (const image of holder.content.querySelectorAll('img')) {
    const address = image.getAttribute('src') ?? '';
    // Bilder ohne Webadresse liegen neben dem Rezept und kommen über den Kern
    if (!/^https?:\/\//i.test(address)) {
      const path = address.split('/').map(encodeURIComponent).join('/');
      image.setAttribute('src', mediaUrl(`/p/${encodeURIComponent(source.value)}/file/${encodeURIComponent(recipe.value.id)}/${path}`));
    }
    image.setAttribute('loading', 'lazy');
  }
  for (const link of holder.content.querySelectorAll('a')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  return holder.innerHTML;
});

function readScale(): number {
  try {
    const stored = Number(localStorage.getItem(SCALE_KEY));
    return SCALES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}
function resize(step: number) {
  scale.value = SCALES[Math.min(SCALES.length - 1, Math.max(0, SCALES.indexOf(scale.value) + step))] ?? 1;
  try {
    localStorage.setItem(SCALE_KEY, String(scale.value));
  } catch {
    // Ohne Speicher gilt die Größe bis zum Neuladen.
  }
}

// Solange ein Rezept offen ist, soll der Bildschirm nicht abschalten – wo der Browser das zulässt.
let lock: WakeLockSentinel | undefined;
async function keepAwake() {
  if (!open.value || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
  } catch {
    // Ohne gesicherte Verbindung oder bei schwachem Akku lehnt der Browser ab.
  }
}
watch(open, (isOpen) => {
  if (isOpen) void keepAwake();
  else void lock?.release().catch(() => undefined);
});
// Der Browser gibt die Sperre frei, sobald die Anzeige verdeckt wird; beim Zurückkehren holen wir sie wieder.
document.addEventListener('visibilitychange', keepAwake);
onUnmounted(() => {
  document.removeEventListener('visibilitychange', keepAwake);
  void lock?.release().catch(() => undefined);
});

function close() {
  open.value = false;
  recipe.value = undefined;
}
</script>

<template>
  <section class="recipes">
    <button class="head" @click="open = true">
      <span class="title">{{ props.config.title ?? t('recipes.title') }}</span>
      <span class="count">{{ t('recipes.count', list.length) }}</span>
      <span class="arrow" aria-hidden="true">›</span>
    </button>
    <ul class="quick">
      <li v-for="entry in list" :key="entry.id">
        <button @click="show(entry.id)">{{ entry.title }}</button>
      </li>
    </ul>

    <DetailOverlay v-if="open" :title="recipe?.title ?? props.config.title ?? t('recipes.title')" @close="close">
      <template #actions>
        <button v-if="recipe" class="back" @click="recipe = undefined">{{ t('recipes.list') }}</button>
        <button v-if="recipe" :aria-label="t('recipes.smaller')" :disabled="scale === SCALES[0]" @click="resize(-1)">A−</button>
        <button v-if="recipe" :aria-label="t('recipes.larger')" :disabled="scale === SCALES[SCALES.length - 1]" @click="resize(1)">A+</button>
      </template>
      <div class="browser" :class="{ reading: !!recipe }">
        <nav>
          <div v-if="categories.length > 1" class="chips">
            <button :class="{ active: !category }" @click="category = undefined">{{ t('recipes.all') }}</button>
            <button v-for="name in categories" :key="name" :class="{ active: category === name }" @click="category = name">{{ name }}</button>
          </div>
          <ul>
            <li v-for="entry in shown" :key="entry.id">
              <button :class="{ active: recipe?.id === entry.id }" @click="show(entry.id)">
                <strong>{{ entry.title }}</strong>
                <span v-if="entry.time || entry.category">{{ [entry.category, entry.time].filter(Boolean).join(' · ') }}</span>
              </button>
            </li>
          </ul>
          <p v-if="!list.length" class="hint">{{ t('recipes.empty') }}</p>
        </nav>
        <article :style="{ fontSize: `${20 * scale}px` }">
          <template v-if="recipe">
            <p v-if="recipe.time || recipe.servings || recipe.tags.length" class="facts">
              <span v-if="recipe.time">{{ t('recipes.time', { time: recipe.time }) }}</span>
              <span v-if="recipe.servings">{{ t('recipes.servings', { servings: recipe.servings }) }}</span>
              <span v-for="tag in recipe.tags" :key="tag" class="tag">{{ tag }}</span>
            </p>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="text" v-html="html" />
          </template>
          <p v-else class="hint">{{ failed ? t('recipes.failed', { error: failed }) : list.length ? t('recipes.choose') : '' }}</p>
        </article>
      </div>
    </DetailOverlay>
  </section>
</template>

<style scoped>
.recipes {
  container-type: size;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  flex: none;
  min-height: 44px;
  padding: 0 12px;
  background: none;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}
.title {
  font-weight: 600;
}
.count {
  flex: 1;
  color: var(--mute);
  font-size: 14px;
}
.arrow {
  font-size: 22px;
  color: var(--mute);
}
.quick {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 6px 6px;
  list-style: none;
  overflow: hidden;
}
.quick button {
  width: 100%;
  min-height: 40px;
  padding: 0 6px;
  border-top: 1px solid var(--line);
  background: none;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Niedrige Kachel: nur die Zeile, die zur Auswahl führt – und die füllt dann die Höhe */
@container (max-height: 100px) {
  .quick {
    display: none;
  }
  .head {
    flex: 1;
  }
}

.browser {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(260px, 26%) minmax(0, 1fr);
}
nav {
  min-height: 0;
  padding: 12px;
  border-right: 1px solid var(--line);
  background: var(--card);
  overflow-y: auto;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.chips button {
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--soft);
}
.chips .active {
  background: var(--accent);
  color: var(--on-accent);
}
nav ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
nav li button {
  width: 100%;
  min-height: 52px;
  padding: 6px 10px;
  border-radius: var(--radius);
  background: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: left;
}
nav li button.active {
  background: var(--soft);
}
nav li strong {
  font-weight: 500;
  font-size: 18px;
}
nav li span {
  color: var(--mute);
  font-size: 14px;
}
article {
  min-width: 0;
  min-height: 0;
  padding: 20px clamp(16px, 4vw, 56px) 48px;
  overflow-y: auto;
  line-height: 1.5;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 0 0 0.6em;
  color: var(--mute);
  font-size: 0.85em;
}
.tag {
  padding: 0 10px;
  border-radius: 999px;
  background: var(--soft);
}
.hint {
  color: var(--mute);
}
.back {
  display: none;
}
/* Schmale Anzeige: entweder die Liste oder das Rezept */
@media (max-width: 760px) {
  .browser {
    grid-template-columns: minmax(0, 1fr);
  }
  .browser.reading nav,
  .browser:not(.reading) article {
    display: none;
  }
  nav {
    border-right: 0;
  }
  .back {
    display: inline-flex;
  }
}

.text {
  max-width: 46em;
}
.text :deep(h1),
.text :deep(h2),
.text :deep(h3) {
  margin: 1.1em 0 0.4em;
  font-weight: 600;
  line-height: 1.2;
}
.text :deep(h1) {
  font-size: 1.5em;
}
.text :deep(h2) {
  font-size: 1.25em;
}
.text :deep(h3) {
  font-size: 1.05em;
}
.text :deep(p),
.text :deep(ul),
.text :deep(ol),
.text :deep(table) {
  margin: 0 0 0.8em;
}
.text :deep(li) {
  margin-bottom: 0.3em;
}
.text :deep(img) {
  max-width: 100%;
  max-height: 60vh;
  border-radius: var(--radius);
}
.text :deep(table) {
  border-collapse: collapse;
}
.text :deep(th),
.text :deep(td) {
  padding: 0.2em 1em 0.2em 0;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
.text :deep(a) {
  color: var(--accent);
}
.text :deep(blockquote) {
  margin: 0 0 0.8em;
  padding-left: 0.8em;
  border-left: 3px solid var(--line);
  color: var(--mute);
}
</style>
