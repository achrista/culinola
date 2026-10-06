<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';
import { region } from '../i18n.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';

interface Item {
  title: string;
  summary: string;
  link: string;
  image?: string;
  published: number;
}
interface Feed {
  id: string;
  name: string;
  /** Der Anbieter erlaubt, seine Artikel innerhalb der Anzeige zu öffnen. */
  embed: boolean;
  items: Item[];
}
interface Entry {
  feed: Feed;
  item: Item;
}

/** Zeigt immer eine Meldung mit Bild und wechselt reihum durch die Feeds. */
const props = defineProps<{
  config: {
    /** Nachrichten-Instanz. */
    source?: string;
    /** Nur diese Feeds zeigen; ohne Angabe alle der Instanz. */
    feeds?: string[];
    /** So lange bleibt eine Meldung stehen. */
    seconds?: number;
  };
}>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'news');
const feeds = ref<Feed[]>([]);
const index = ref(0);
const opened = ref<Entry>();
const broken = reactive(new Set<string>());

async function load() {
  try {
    feeds.value = await getJson<Feed[]>(`/resources/${encodeURIComponent(source.value)}/feeds`);
  } catch {
    // Die zuletzt geladenen Meldungen bleiben stehen; der nächste Abruf des Kerns stößt einen neuen Versuch an.
  }
}
// Der Kern meldet über diesen Datenpunkt, dass er die Feeds neu abgerufen hat
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

/** Die Meldungen aller gewählten Feeds im Wechsel: erst von jedem die neueste, dann die zweitneueste … */
const queue = computed(() => {
  const chosen = feeds.value.filter((feed) => !props.config.feeds || props.config.feeds.includes(feed.id));
  const entries: Entry[] = [];
  const longest = Math.max(0, ...chosen.map((feed) => feed.items.length));
  for (let position = 0; position < longest; position++) {
    for (const feed of chosen) {
      const item = feed.items[position];
      if (item) entries.push({ feed, item });
    }
  }
  return entries;
});
const current = computed(() => (queue.value.length ? queue.value[index.value % queue.value.length] : undefined));
const picture = computed(() => {
  const image = current.value?.item.image;
  return image && !broken.has(image) ? image : undefined;
});
const when = computed(() => {
  const published = current.value?.item.published;
  if (!published) return '';
  const sameDay = new Date(published).toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(region.value, sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(published);
});

let timer: number | undefined;
function schedule() {
  window.clearInterval(timer);
  timer = window.setInterval(
    () => {
      // Solange ein Artikel offen ist, bleibt die Meldung dahinter stehen
      if (!opened.value) index.value++;
    },
    Math.max(5, props.config.seconds ?? 20) * 1000,
  );
}
function next() {
  index.value++;
  schedule();
}
onMounted(schedule);
onUnmounted(() => window.clearInterval(timer));

function open() {
  if (!current.value) return;
  // Wo der Anbieter das Einbetten untersagt, öffnet sich der Artikel in einem eigenen Fenster
  if (current.value.feed.embed) opened.value = current.value;
  else window.open(current.value.item.link, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <section class="news">
    <button v-if="current" class="story" :class="{ plain: !picture }" :aria-label="t('news.open', { title: current.item.title })" @click="open">
      <img v-if="picture" :src="picture" alt="" referrerpolicy="no-referrer" @error="broken.add(picture)" />
      <span class="text">
        <span class="meta">
          <span class="feed">{{ current.feed.name }}</span>
          <span>{{ when }}</span>
        </span>
        <strong>{{ current.item.title }}</strong>
        <span class="summary">{{ current.item.summary }}</span>
      </span>
    </button>
    <p v-else class="empty">{{ t('news.empty') }}</p>
    <button v-if="queue.length > 1" class="next" :aria-label="t('news.next')" @click="next">›</button>

    <DetailOverlay v-if="opened" :title="opened.item.title" @close="opened = undefined">
      <template #actions>
        <a :href="opened.item.link" target="_blank" rel="noopener noreferrer">{{ t('news.ownWindow') }}</a>
      </template>
      <iframe :src="opened.item.link" :title="opened.item.title" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer" />
    </DetailOverlay>
  </section>
</template>

<style scoped>
.news {
  container-type: size;
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: var(--radius);
  background: var(--card);
  overflow: hidden;
}
.story {
  width: 100%;
  height: 100%;
  padding: 0;
  background: none;
  display: grid;
  grid-template-rows: minmax(0, 46%) minmax(0, 1fr);
  text-align: left;
}
.story.plain {
  grid-template-rows: minmax(0, 1fr);
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* Bei Nachrichtenbildern sitzt das Wesentliche meist im oberen Drittel */
  object-position: center 30%;
}
.text {
  min-height: 0;
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}
.meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--mute);
  font-size: 14px;
}
/* Ohne Bild liegt die Weiter-Taste über dieser Zeile */
.plain .meta {
  padding-right: 52px;
}
.feed {
  font-weight: 600;
  color: var(--accent);
}
strong {
  font-size: clamp(17px, 6.4cqh, 26px);
  font-weight: 600;
  line-height: 1.2;
}
.summary {
  flex: 1;
  min-height: 0;
  color: var(--mute);
  font-size: clamp(15px, 4.6cqh, 19px);
  overflow: hidden;
  /* Was nicht mehr passt, läuft unten aus, statt mitten in der Zeile abzubrechen */
  mask-image: linear-gradient(to bottom, #000 calc(100% - 1.6em), transparent);
}
/* Breite, flache Kachel: Bild links, Text rechts */
@container (min-aspect-ratio: 5 / 2) {
  .story:not(.plain) {
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(0, 38%) minmax(0, 1fr);
  }
}
.next {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 26px;
  line-height: 1;
}
.empty {
  height: 100%;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mute);
}
iframe {
  flex: 1;
  width: 100%;
  border: 0;
  background: #fff;
}
</style>
