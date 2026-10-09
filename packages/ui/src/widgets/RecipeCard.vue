<script setup lang="ts">
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson, postFile, postJson } from '../api.ts';
import { mediaUrl } from '../media.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';
import TitleIcon from './TitleIcon.vue';

interface RecipeInfo {
  id: string;
  title: string;
  category?: string;
  tags: string[];
  time?: string;
  servings?: string;
  image?: string;
  /** Herkunft in einem kurzen Vermerk, etwa "Familienrezept" oder "Instagram". */
  source?: string;
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

// Neue Rezepte: nur angeboten, wenn der Kern sie umwandeln kann
const canAdd = computed(() => datapoints.get(`${source.value}:importReady`)?.value === true);
const adding = ref(false);
const busy = ref(false);
const addUrl = ref('');
const addText = ref('');
const addError = ref('');
const notice = ref<string[]>([]);

/** Adresse eines Bildes, das zu einem Rezept gehört: Webadressen bleiben, alles andere liegt neben dem Rezept und kommt über den Kern. */
function imageUrl(recipeId: string, address: string): string {
  if (/^https?:\/\//i.test(address)) return address;
  const path = address.split('/').map(encodeURIComponent).join('/');
  return mediaUrl(`/p/${encodeURIComponent(source.value)}/file/${encodeURIComponent(recipeId)}/${path}`);
}
const picture = (entry: RecipeInfo) => (entry.image && !broken.has(`${entry.id}/${entry.image}`) ? imageUrl(entry.id, entry.image) : undefined);

/**
 * Wählt zufällig ein anderes Rezept für die Kachel – nur Rezepte mit Bild, solange es welche gibt.
 * Gewechselt wird erst, wenn das Bild geladen ist: So steht nie ein Rezept ohne sein Bild da,
 * und ein Bild, das sich nicht laden lässt, kommt gar nicht erst an die Reihe.
 */
let picking = 0;
function pick() {
  const turn = ++picking;
  const withPicture = list.value.filter((entry) => picture(entry));
  const pool = withPicture.length ? withPicture : list.value;
  const others = pool.filter((entry) => entry.id !== featured.value?.id);
  const choice = others.length ? others : pool;
  const next = choice[Math.floor(Math.random() * choice.length)];
  const address = next && picture(next);
  if (!next || !address) {
    featured.value = next;
    return;
  }
  const image = new Image();
  image.onload = () => {
    // Ein späterer Wechsel hat diesen überholt
    if (turn === picking) featured.value = next;
  };
  image.onerror = () => {
    broken.add(`${next.id}/${next.image}`);
    if (turn === picking) pick();
  };
  image.src = address;
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

async function show(id: string, keepNotice = false) {
  open.value = true;
  adding.value = false;
  failed.value = '';
  if (!keepNotice) notice.value = [];
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

interface Added {
  recipes: { title: string; id?: string }[];
  warnings: string[];
}

/** Verkleinert ein großes Foto vor dem Hochladen: Lesbar bleibt es, und es passt durch jede Leitung. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const factor = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * factor);
    canvas.height = Math.round(bitmap.height * factor);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    // Was der Browser nicht zeichnen kann, geht unverändert auf die Reise.
    return file;
  }
}

async function add(send: () => Promise<Added>) {
  if (busy.value) return;
  busy.value = true;
  addError.value = '';
  try {
    const added = await send();
    addUrl.value = '';
    addText.value = '';
    await load();
    notice.value = [t('recipes.added', { n: added.recipes.length, titles: added.recipes.map((entry) => entry.title).join(' · ') }, added.recipes.length), ...added.warnings];
    const first = added.recipes.find((entry) => entry.id)?.id;
    if (first) await show(first, true);
    else adding.value = false;
  } catch (cause) {
    addError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
const addPath = computed(() => `/p/${encodeURIComponent(source.value)}/import`);
const addFromUrl = () => add(() => postJson<Added>(addPath.value, { url: addUrl.value }));
const addFromText = () => add(() => postJson<Added>(addPath.value, { text: addText.value }));
function addFromFile(event: Event) {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  // Dieselbe Datei soll sich nach einem Fehler noch einmal wählen lassen
  field.value = '';
  if (file) void add(async () => postFile<Added>(`${addPath.value}?name=${encodeURIComponent(file.name)}`, await shrink(file)));
}
function startAdding() {
  recipe.value = undefined;
  notice.value = [];
  addError.value = '';
  adding.value = true;
}

/** Das Bild aus den Kopfdaten – in der Leseansicht nur, wenn der Text es nicht ohnehin zeigt. */
const lead = computed(() => {
  const current = recipe.value;
  if (!current?.image || broken.has(`${current.id}/${current.image}`)) return undefined;
  const inText = [current.image, encodeURI(current.image)].some((address) => current.markdown.includes(`](${address}`) || current.markdown.includes(`](<${address}`));
  return inText ? undefined : imageUrl(current.id, current.image);
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
  adding.value = false;
  notice.value = [];
}
</script>

<template>
  <section class="recipes">
    <button v-if="featured" class="feature" :class="{ plain: !picture(featured) }" :aria-label="t('recipes.open', { title: featured.title })" @click="show(featured.id)">
      <img v-if="picture(featured)" :key="featured.id" :src="picture(featured)" alt="" @error="pictureFailed(featured)" />
      <span class="caption">
        <span class="kicker"><TitleIcon name="pot" />{{ heading }}</span>
        <strong>{{ featured.title }}</strong>
        <span v-if="featured.category || featured.time" class="facts">{{ [featured.category, featured.time].filter(Boolean).join(' · ') }}</span>
      </span>
    </button>
    <p v-else class="none">{{ heading }} – {{ t('recipes.count', 0) }}</p>
    <button class="all" :aria-label="t('recipes.showAll', list.length)" @click="open = true">›</button>

    <DetailOverlay v-if="open" :title="recipe?.title ?? heading" @close="close">
      <template #actions>
        <button v-if="recipe || adding" class="back" @click="(recipe = undefined), (adding = false)">{{ t('recipes.list') }}</button>
        <button v-if="canAdd && !adding" :aria-label="t('recipes.add')" @click="startAdding">{{ t('recipes.addShort') }}</button>
        <button v-if="recipe" :aria-label="t('recipes.smaller')" :disabled="scale === SCALES[0]" @click="resize(-1)">A−</button>
        <button v-if="recipe" :aria-label="t('recipes.larger')" :disabled="scale === SCALES[SCALES.length - 1]" @click="resize(1)">A+</button>
      </template>
      <div class="browser" :class="{ reading: !!recipe || adding }">
        <nav>
          <div v-if="categories.length > 1" class="chips">
            <button :class="{ active: !category }" @click="category = undefined">{{ t('recipes.all') }}</button>
            <button v-for="name in categories" :key="name" :class="{ active: category === name }" @click="category = name">{{ name }}</button>
          </div>
          <ul>
            <li v-for="entry in shown" :key="entry.id">
              <button :class="{ active: recipe?.id === entry.id }" @click="show(entry.id)">
                <strong>{{ entry.title }}</strong>
                <span v-if="entry.time || entry.category || entry.source">{{ [entry.category, entry.time, entry.source].filter(Boolean).join(' · ') }}</span>
              </button>
            </li>
          </ul>
          <p v-if="!list.length" class="hint">{{ t('recipes.empty') }}</p>
        </nav>
        <article :style="{ fontSize: `${20 * scale}px` }">
          <form v-if="adding" class="add" @submit.prevent>
            <h3>{{ t('recipes.add') }}</h3>
            <p class="hint">{{ t('recipes.addIntro') }}</p>
            <label>
              <span>{{ t('recipes.addUrl') }}</span>
              <span class="row">
                <input v-model.trim="addUrl" type="url" inputmode="url" placeholder="https://" :disabled="busy" @keydown.enter.prevent="addUrl && addFromUrl()" />
                <button type="button" :disabled="busy || !addUrl" @click="addFromUrl">{{ t('recipes.addGo') }}</button>
              </span>
            </label>
            <label class="file" :class="{ off: busy }">
              <input type="file" accept=".pdf,.docx,.docm,.odt,.doc,.txt,.md,.htm,.html,image/*" :disabled="busy" @change="addFromFile" />
              <strong>{{ t('recipes.addFile') }}</strong>
              <span>{{ t('recipes.addFileHint') }}</span>
            </label>
            <label>
              <span>{{ t('recipes.addText') }}</span>
              <textarea v-model="addText" rows="5" :disabled="busy" />
            </label>
            <button type="button" class="go" :disabled="busy || !addText.trim()" @click="addFromText">{{ t('recipes.addGo') }}</button>
            <p v-if="busy" class="state" role="status">{{ t('recipes.addBusy') }}</p>
            <p v-else-if="addError" class="state bad" role="alert">{{ t('recipes.addFailed', { error: addError }) }}</p>
          </form>
          <template v-else-if="recipe">
            <p v-for="line in notice" :key="line" class="notice">{{ line }}</p>
            <p v-if="recipe.time || recipe.servings || recipe.tags.length" class="facts">
              <span v-if="recipe.time">{{ t('recipes.time', { time: recipe.time }) }}</span>
              <span v-if="recipe.servings">{{ t('recipes.servings', { servings: recipe.servings }) }}</span>
              <span v-for="tag in recipe.tags" :key="tag" class="tag">{{ tag }}</span>
            </p>
            <img v-if="lead" class="lead" :src="lead" alt="" @error="broken.add(`${recipe.id}/${recipe.image}`)" />
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
  .caption .facts {
    color: var(--mute);
    opacity: 1;
  }
  /* Neben dem Bild ist die Zeile über dem Titel die Überschrift der Kachel; auf dem Bild bleibt sie weiß */
  .kicker {
    color: var(--title-ink);
    letter-spacing: var(--title-spacing);
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
.notice {
  margin: 0 0 0.6em;
  padding: 0.4em 0.8em;
  border-radius: var(--radius);
  background: var(--soft);
  font-size: 0.85em;
}
.add {
  max-width: 40em;
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 18px;
}
.add h3,
.add p {
  margin: 0;
}
.add label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.add .row {
  display: flex;
  gap: 8px;
}
.add input[type='url'],
.add textarea {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  font: inherit;
}
.add textarea {
  resize: vertical;
}
.add button,
.add .file {
  min-height: 48px;
  padding: 0 20px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 500;
}
.add button:disabled,
.add .file.off {
  opacity: 0.4;
}
.add .go {
  align-self: flex-start;
}
/* Die Dateiwahl ist eine große Fläche; das eigentliche Feld bleibt für Tastatur und Vorleser erreichbar. */
.add .file {
  position: relative;
  padding: 14px 20px;
  border-radius: var(--radius);
  background: var(--soft);
  color: var(--ink);
  cursor: pointer;
}
.add .file input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.add .file:focus-within {
  outline: 2px solid var(--accent);
}
.add .file span {
  color: var(--mute);
  font-size: 0.85em;
}
.add .state {
  padding: 0.6em 0.9em;
  border-radius: var(--radius);
  background: var(--soft);
}
.add .state.bad {
  color: var(--alarm);
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
/* Das Bild des Rezepts steht rechts neben dem Anfang des Textes, auf schmalen Anzeigen darüber. */
.lead {
  float: right;
  width: min(40%, 440px);
  max-height: 60vh;
  margin: 0 0 1em 1.4em;
  border-radius: var(--radius);
  object-fit: cover;
}
@media (max-width: 1100px) {
  .lead {
    float: none;
    display: block;
    width: 100%;
    max-width: 30em;
    max-height: 40vh;
    margin: 0 0 1em;
  }
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
