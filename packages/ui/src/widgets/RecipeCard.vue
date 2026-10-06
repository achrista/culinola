<script setup lang="ts">
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
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
  image?: string;
}
interface Recipe extends RecipeInfo {
  markdown: string;
}

/**
 * Rezepte: Die Kachel zeigt im Wechsel ein zufällig gewähltes Rezept mit Bild,
 * nach dem Antippen folgen Liste und Leseansicht über den ganzen Bildschirm.
 */
const props = defineProps<{
  config: {
    source?: string;
    title?: string;
    /** So lange bleibt ein Rezept auf der Kachel stehen. */
    seconds?: number;
  };
}>();

const SCALE_KEY = 'culinola.recipes.scale';
const SCALES = [0.85, 1, 1.2, 1.45, 1.75];

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'recipes');
const heading = computed(() => props.config.title ?? t('recipes.title'));
const list = ref<RecipeInfo[]>([]);
const featured = ref<RecipeInfo>();
const open = ref(false);
const category = ref<string>();
const recipe = ref<Recipe>();
const failed = ref('');
const scale = ref(readScale());
const broken = reactive(new Set<string>());

/** Adresse eines Bildes, das zu einem Rezept gehört: Webadressen bleiben, alles andere liegt neben dem Rezept und kommt über den Kern. */
function imageUrl(recipeId: string, address: string): string {
  if (/^https?:\/\//i.test(address)) return address;
  const path = address.split('/').map(encodeURIComponent).join('/');
  return mediaUrl(`/p/${encodeURIComponent(source.value)}/file/${encodeURIComponent(recipeId)}/${path}`);
}
const picture = (entry: RecipeInfo) => (entry.image && !broken.has(`${entry.id}/${entry.image}`) ? imageUrl(entry.id, entry.image) : undefined);

/** Wählt zufällig ein anderes Rezept für die Kachel – eines mit Bild, solange es welche gibt. */
function pick() {
  const withPicture = list.value.filter((entry) => picture(entry));
  const pool = withPicture.length ? withPicture : list.value;
  const others = pool.filter((entry) => entry.id !== featured.value?.id);
  const choice = others.length ? others : pool;
  featured.value = choice[Math.floor(Math.random() * choice.length)];
}

async function load() {
  try {
    list.value = await getJson<RecipeInfo[]>(`/resources/${encodeURIComponent(source.value)}/list`);
    if (!list.value.some((entry) => entry.id === featured.value?.id)) pick();
  } catch {
    // Die zuletzt geladene Liste bleibt stehen.
  }
}
// Der Kern meldet über diesen Datenpunkt, dass sich der Rezeptordner geändert hat
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

let rotation: number | undefined;
onMounted(() => {
  rotation = window.setInterval(
    () => {
      // Solange jemand liest, bleibt die Kachel dahinter ruhig
      if (!open.value) pick();
    },
    Math.max(5, props.config.seconds ?? 30) * 1000,
  );
});

function pictureFailed(entry: RecipeInfo) {
  broken.add(`${entry.id}/${entry.image}`);
  pick();
}

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
  const current = recipe.value;
  if (!current) return '';
  const holder = document.createElement('template');
  holder.innerHTML = micromark(current.markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
  for (const image of holder.content.querySelectorAll('img')) {
    image.setAttribute('src', imageUrl(current.id, image.getAttribute('src') ?? ''));
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
  window.clearInterval(rotation);
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
    <button v-if="featured" class="feature" :class="{ plain: !picture(featured) }" :aria-label="t('recipes.open', { title: featured.title })" @click="show(featured.id)">
      <img v-if="picture(featured)" :key="featured.id" :src="picture(featured)" alt="" @error="pictureFailed(featured)" />
      <span class="caption">
        <span class="kicker">{{ heading }}</span>
        <strong>{{ featured.title }}</strong>
        <span v-if="featured.category || featured.time" class="facts">{{ [featured.category, featured.time].filter(Boolean).join(' · ') }}</span>
      </span>
    </button>
    <p v-else class="none">{{ heading }} – {{ t('recipes.count', 0) }}</p>
    <button class="all" :aria-label="t('recipes.showAll', list.length)" @click="open = true">›</button>

    <DetailOverlay v-if="open" :title="recipe?.title ?? heading" @close="close">
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
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}
/* Hohe Kachel: Das Bild füllt die Fläche, die Beschriftung liegt unten darauf. */
.feature {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0;
  background: none;
  display: flex;
  align-items: flex-end;
  text-align: left;
}
.feature img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.caption {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 28px 60px 10px 12px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.78), transparent);
  color: #fff;
}
.plain .caption {
  align-self: center;
  padding-top: 10px;
  background: none;
  color: var(--ink);
}
.kicker {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.85;
}
.caption strong {
  font-size: clamp(18px, 9cqh, 28px);
  font-weight: 600;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.caption .facts {
  margin: 0;
  font-size: 14px;
  color: inherit;
  opacity: 0.85;
}
.all {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 26px;
  line-height: 1;
}
.none {
  height: 100%;
  margin: 0;
  padding: 0 60px 0 12px;
  display: flex;
  align-items: center;
  color: var(--mute);
}
/* Niedrige Kachel: Bild links, Beschriftung daneben */
@container (max-height: 150px) {
  .feature {
    align-items: stretch;
  }
  .feature img {
    position: static;
    flex: none;
    width: auto;
    aspect-ratio: 3 / 2;
  }
  .caption {
    justify-content: center;
    padding: 4px 60px 4px 12px;
    background: none;
    color: var(--ink);
  }
  .kicker,
  .caption .facts {
    color: var(--mute);
    opacity: 1;
  }
  .all {
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
    background: var(--soft);
    color: var(--ink);
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
article .facts {
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
