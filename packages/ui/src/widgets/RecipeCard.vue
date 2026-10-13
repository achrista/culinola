<script setup lang="ts">
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson, postFile, postJson } from '../api.ts';
import { mediaUrl } from '../media.ts';
import { matches } from '../search.ts';
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
/** Was von einem Rezept auf die Einkaufsliste käme. */
interface Shopping {
  /** Ob es eine Einkaufsliste gibt, auf die sich etwas setzen lässt. */
  ready: boolean;
  /** Wofür das Rezept geschrieben ist und wofür gerade gerechnet wird – etwa 4 und 6 „Portionen“. */
  base: number;
  amount: number;
  unit: string;
  /** Ob das Rezept eine Zahl nennt; ohne Einheit sind dann Portionen gemeint, sonst das Vielfache des Rezepts. */
  counted: boolean;
  items: { name: string; amount: string; note: string | null }[];
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
const query = ref('');
const recipe = ref<Recipe>();
const failed = ref('');
const scale = ref(readScale());
const broken = reactive(new Set<string>());

// „Das koche ich gerade“: Dieses Rezept bleibt auf der Kachel stehen, bis es fertig gemeldet wird
const cookingId = computed(() => {
  const value = datapoints.get(`${source.value}:cooking`)?.value;
  return typeof value === 'string' && value ? value : undefined;
});
const cooking = computed(() => list.value.find((entry) => entry.id === cookingId.value));
/** Was die Kachel zeigt: das Rezept, das gekocht wird – sonst das gerade ausgeloste. */
const shownOnTile = computed(() => cooking.value ?? featured.value);
async function setCooking(id: string | undefined) {
  try {
    await postJson(id ? '/actions/recipes.cook' : '/actions/recipes.finish', id ? { recipe: id } : {});
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}

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
      // Solange jemand liest oder kocht, bleibt die Kachel ruhig
      if (!open.value && !cooking.value) pick();
    },
    Math.max(5, props.config.seconds ?? 30) * 1000,
  );
});

function pictureFailed(entry: RecipeInfo) {
  broken.add(`${entry.id}/${entry.image}`);
  pick();
}

const categories = computed(() => [...new Set(list.value.map((entry) => entry.category).filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b)));
/** Was die Liste zeigt: die gewählte Kategorie, darin das, was zur Suche passt. */
const shown = computed(() => list.value.filter((entry) => (!category.value || entry.category === category.value) && matches(query.value, [entry.title, entry.category, entry.source, ...entry.tags])));

// Zutaten auf die Einkaufsliste: Menge wählen, abwählen, was im Haus ist, und eintragen lassen
const shopping = ref<Shopping>();
const shopOpen = ref(false);
const shopBusy = ref(false);
const shopError = ref('');
const chosen = reactive(new Set<string>());
const shopPath = (id: string) => `/p/${encodeURIComponent(source.value)}/shopping/${encodeURIComponent(id)}`;
async function loadShopping(id: string, amount?: number) {
  try {
    const next = await getJson<Shopping>(`${shopPath(id)}${amount ? `?amount=${amount}` : ''}`);
    // Inzwischen ist ein anderes Rezept offen
    if (recipe.value?.id === id) shopping.value = next;
  } catch {
    // Ohne Auskunft wird das Einkaufen nicht angeboten.
    if (recipe.value?.id === id && !amount) shopping.value = undefined;
  }
}
function startShopping() {
  if (!shopping.value) return;
  chosen.clear();
  for (const item of shopping.value.items) chosen.add(item.name);
  shopError.value = '';
  notice.value = [];
  shopOpen.value = true;
}
const toggle = (name: string) => void (chosen.has(name) ? chosen.delete(name) : chosen.add(name));
function toggleAll() {
  const all = shopping.value?.items ?? [];
  if (chosen.size === all.length) chosen.clear();
  else for (const item of all) chosen.add(item.name);
}
/** Mehr oder weniger: in ganzen Schritten der Angabe im Rezept, nie unter eins. */
function resizeShopping(step: number) {
  const current = recipe.value;
  if (!current || !shopping.value) return;
  const next = Math.max(1, Math.round(shopping.value.amount + step));
  if (next !== shopping.value.amount) void loadShopping(current.id, next);
}
async function shop() {
  const current = recipe.value;
  if (!current || !shopping.value || shopBusy.value) return;
  shopBusy.value = true;
  shopError.value = '';
  try {
    const result = await postJson<{ added: number; known: number; failed: string[] }>(shopPath(current.id), { amount: shopping.value.amount, names: [...chosen] });
    notice.value = [
      t('recipes.shopDone', { n: result.added }, result.added),
      ...(result.known ? [t('recipes.shopKnown', { n: result.known }, result.known)] : []),
      ...(result.failed.length ? [t('recipes.shopFailed', { names: result.failed.join(', ') })] : []),
    ];
    shopOpen.value = false;
  } catch (cause) {
    shopError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    shopBusy.value = false;
  }
}

async function show(id: string, keepNotice = false) {
  open.value = true;
  adding.value = false;
  shopOpen.value = false;
  shopping.value = undefined;
  failed.value = '';
  if (!keepNotice) notice.value = [];
  try {
    recipe.value = await getJson<Recipe>(`/p/${encodeURIComponent(source.value)}/text/${encodeURIComponent(id)}`);
    void loadShopping(id);
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
  shopOpen.value = false;
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
  query.value = '';
  recipe.value = undefined;
  adding.value = false;
  shopOpen.value = false;
  notice.value = [];
}
</script>

<template>
  <section class="recipes">
    <button v-if="shownOnTile" class="feature" :class="{ plain: !picture(shownOnTile), cooking: !!cooking }" :aria-label="t('recipes.open', { title: shownOnTile.title })" @click="show(shownOnTile.id)">
      <img v-if="picture(shownOnTile)" :key="shownOnTile.id" :src="picture(shownOnTile)" alt="" @error="pictureFailed(shownOnTile)" />
      <span class="caption">
        <span class="kicker"><TitleIcon name="pot" />{{ cooking ? t('recipes.cooking') : heading }}</span>
        <strong>{{ shownOnTile.title }}</strong>
        <span v-if="shownOnTile.category || shownOnTile.time" class="facts">{{ [shownOnTile.category, shownOnTile.time].filter(Boolean).join(' · ') }}</span>
      </span>
    </button>
    <p v-else class="none">{{ heading }} – {{ t('recipes.count', 0) }}</p>
    <button class="all" :aria-label="t('recipes.showAll', list.length)" @click="open = true">›</button>

    <DetailOverlay v-if="open" :title="recipe?.title ?? heading" @close="close">
      <template #actions>
        <button v-if="recipe || adding" class="back" @click="(recipe = undefined), (adding = false), (shopOpen = false)">{{ t('recipes.list') }}</button>
        <button v-if="canAdd && !adding" :aria-label="t('recipes.add')" @click="startAdding">{{ t('recipes.addShort') }}</button>
        <button v-if="recipe && shopping?.ready && shopping.items.length" class="cook" :class="{ on: shopOpen }" :aria-pressed="shopOpen" @click="shopOpen ? (shopOpen = false) : startShopping()">{{ t('recipes.shop') }}</button>
        <button v-if="recipe" class="cook" :class="{ on: cookingId === recipe.id }" :aria-pressed="cookingId === recipe.id" @click="setCooking(cookingId === recipe.id ? undefined : recipe.id)">{{ t(cookingId === recipe.id ? 'recipes.cookDone' : 'recipes.cook') }}</button>
        <button v-if="recipe" :aria-label="t('recipes.smaller')" :disabled="scale === SCALES[0]" @click="resize(-1)">A−</button>
        <button v-if="recipe" :aria-label="t('recipes.larger')" :disabled="scale === SCALES[SCALES.length - 1]" @click="resize(1)">A+</button>
      </template>
      <div class="browser" :class="{ reading: !!recipe || adding }">
        <nav>
          <div v-if="list.length" class="search" role="search">
            <input v-model="query" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" :placeholder="t('recipes.search')" :aria-label="t('recipes.search')" />
            <button v-if="query" :aria-label="t('recipes.searchClear')" @click="query = ''">×</button>
          </div>
          <div v-if="categories.length > 1" class="chips">
            <button :class="{ active: !category }" @click="category = undefined">{{ t('recipes.all') }}</button>
            <button v-for="name in categories" :key="name" :class="{ active: category === name }" @click="category = name">{{ name }}</button>
          </div>
          <ul>
            <li v-for="entry in shown" :key="entry.id">
              <button :class="{ active: recipe?.id === entry.id }" @click="show(entry.id)">
                <strong>{{ entry.title }}<span v-if="cookingId === entry.id" class="now"> · {{ t('recipes.cooking') }}</span></strong>
                <span v-if="entry.time || entry.category || entry.source">{{ [entry.category, entry.time, entry.source].filter(Boolean).join(' · ') }}</span>
              </button>
            </li>
          </ul>
          <p v-if="!list.length" class="hint">{{ t('recipes.empty') }}</p>
          <p v-else-if="!shown.length" class="hint">{{ t('recipes.noMatch') }}</p>
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
          <form v-else-if="recipe && shopOpen && shopping" class="add shop" @submit.prevent>
            <h3>{{ t('recipes.shopTitle') }}</h3>
            <p class="amount">
              <span>{{ t('recipes.shopFor') }}</span>
              <button type="button" :aria-label="t('recipes.shopLess')" :disabled="shopBusy || shopping.amount <= 1" @click="resizeShopping(-1)">−</button>
              <strong>{{ shopping.unit ? `${shopping.amount} ${shopping.unit}` : shopping.counted ? t('recipes.shopPortions', { n: shopping.amount }, shopping.amount) : t('recipes.shopTimes', { n: shopping.amount }) }}</strong>
              <button type="button" :aria-label="t('recipes.shopMore')" :disabled="shopBusy" @click="resizeShopping(1)">+</button>
            </p>
            <ul>
              <li v-for="item in shopping.items" :key="item.name">
                <label :class="{ off: !chosen.has(item.name) }">
                  <input type="checkbox" :checked="chosen.has(item.name)" :disabled="shopBusy" @change="toggle(item.name)" />
                  <span class="qty">{{ item.amount }}</span>
                  <span>{{ item.name }}<small v-if="item.note"> · {{ item.note }}</small></span>
                </label>
              </li>
            </ul>
            <p class="row">
              <button type="button" class="go" :disabled="shopBusy || !chosen.size" @click="shop">{{ t('recipes.shopGo', { n: chosen.size }) }}</button>
              <button type="button" class="quiet" :disabled="shopBusy" @click="toggleAll">{{ t(chosen.size === shopping.items.length ? 'recipes.shopNone' : 'recipes.shopAll') }}</button>
            </p>
            <p v-if="shopBusy" class="state" role="status">{{ t('recipes.shopBusy') }}</p>
            <p v-else-if="shopError" class="state bad" role="alert">{{ t('recipes.shopError', { error: shopError }) }}</p>
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
          <p v-else-if="failed" class="hint failed" role="alert">{{ t('recipes.failed', { error: failed }) }}</p>
          <p v-else class="hint">{{ list.length ? t('recipes.choose') : '' }}</p>
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
/* Die Suche bleibt oben stehen, während die Liste darunter durchläuft */
.search {
  position: sticky;
  top: -12px;
  z-index: 1;
  margin: -12px -12px 0;
  padding: 12px 12px 10px;
  background: var(--card);
  display: flex;
  gap: 6px;
}
.search input {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--ink);
  font: inherit;
  font-size: 18px;
}
/* Zum Leeren gibt es die eigene, größere Taste */
.search input::-webkit-search-cancel-button {
  display: none;
}
.search button {
  flex: none;
  width: 48px;
  border-radius: var(--radius);
  background: var(--soft);
  font-size: 26px;
  line-height: 1;
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
/* Ein Rezept, das sich nicht öffnen lässt, soll nicht wie eine leere Seite aussehen */
.hint.failed {
  color: var(--alarm);
  font-weight: 600;
}
/* Das Rezept, das gerade gekocht wird */
/* Auf dem Bild bleibt die Zeile weiß, damit sie lesbar ist */
.cooking.plain .kicker {
  color: var(--accent);
}
.now {
  color: var(--accent);
  font-size: 0.8em;
  font-weight: 600;
}
.cook.on {
  background: var(--accent);
  color: var(--on-accent);
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
/* Zutaten für die Einkaufsliste: große Zeilen, die sich mit dem Finger an- und abwählen lassen */
.shop .amount {
  display: flex;
  align-items: center;
  gap: 12px;
}
.shop .amount button {
  width: 48px;
  padding: 0;
  font-size: 24px;
}
.shop .amount strong {
  min-width: 7em;
  text-align: center;
}
.shop ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}
.shop li label {
  flex-direction: row;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}
.shop li label.off {
  color: var(--mute);
  text-decoration: line-through;
}
.shop input[type='checkbox'] {
  flex: none;
  width: 26px;
  height: 26px;
  accent-color: var(--accent);
}
.shop .qty {
  flex: none;
  width: 6.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.shop small {
  color: var(--mute);
}
.shop .quiet {
  background: var(--soft);
  color: var(--ink);
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
