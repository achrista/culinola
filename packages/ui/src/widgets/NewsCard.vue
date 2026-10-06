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
    /** Nach so vielen Sekunden schließt sich ein geöffneter Artikel von selbst; 0 lässt ihn offen. */
    closeAfter?: number;
  };
}>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'news');
const feeds = ref<Feed[]>([]);
const index = ref(0);
const opened = ref<Entry>();
/** Der Artikel liegt in einem eigenen Fenster über der Anzeige. */
const separate = ref(false);
const blocked = ref(false);
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

// Das eigene Fenster gehört nicht in den Zustand der Oberfläche: Auf ein fremdes Fenster darf Vue nicht zugreifen.
let popup: Window | null = null;
let watchdog: number | undefined;
let giveUp: number | undefined;

function open() {
  const entry = current.value;
  if (!entry) return;
  opened.value = entry;
  separate.value = !entry.feed.embed;
  blocked.value = false;
  if (separate.value) {
    // Wo der Anbieter das Einbetten untersagt: ein eigenes Browserfenster, das sich über die ganze Anzeige legt
    const area = screen as Screen & { availLeft?: number; availTop?: number };
    popup = window.open('', 'culinola-article', `popup,left=${area.availLeft ?? 0},top=${area.availTop ?? 0},width=${area.availWidth},height=${area.availHeight}`);
    if (popup) {
      // Die fremde Seite bekommt keinen Zugriff auf die Anzeige, die sie geöffnet hat
      popup.opener = null;
      popup.location.href = entry.item.link;
      watchdog = window.setInterval(() => {
        if (popup?.closed) close();
      }, 500);
    } else {
      blocked.value = true;
    }
  }
  const limit = props.config.closeAfter ?? 600;
  if (limit > 0) giveUp = window.setTimeout(close, limit * 1000);
}

/** Schließt den Artikel – eingebettet wie im eigenen Fenster – und gibt die Anzeige wieder frei. */
function close() {
  window.clearInterval(watchdog);
  window.clearTimeout(giveUp);
  if (popup && !popup.closed) popup.close();
  popup = null;
  opened.value = undefined;
}

onUnmounted(() => {
  window.clearInterval(timer);
  close();
});
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

    <DetailOverlay v-if="opened" :title="opened.item.title" @close="close">
      <template v-if="!separate || blocked" #actions>
        <a :href="opened.item.link" target="_blank" rel="noopener noreferrer">{{ t('news.ownWindow') }}</a>
      </template>
      <!-- Hinter dem eigenen Fenster wartet dieser Hinweis; wer ihn sieht, kommt mit einem Tipp zurück zur Anzeige -->
      <p v-if="separate" class="waiting">{{ t(blocked ? 'news.blocked' : 'news.inOwnWindow', { feed: opened.feed.name }) }}</p>
      <iframe v-else :src="opened.item.link" :title="opened.item.title" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer" />
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
.waiting {
  margin: auto;
  max-width: 32em;
  padding: 24px;
  color: var(--mute);
  font-size: 20px;
  text-align: center;
}
</style>
