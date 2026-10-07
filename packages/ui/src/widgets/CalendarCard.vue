<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';
import { region } from '../i18n.ts';
import { vScrollHome } from '../scroll.ts';
import { datapoints } from '../store.ts';

interface CalendarEvent {
  id: string;
  title: string;
  /** Zeitpunkt, bei ganztägigen Terminen nur das Datum. */
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  location?: string;
}

/** Die nächsten Termine, nach Tagen gegliedert. Gezeigt wird, was in die Kachel passt. */
const props = defineProps<{ config: { source?: string; title?: string } }>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'google');
const events = ref<CalendarEvent[]>([]);
const now = ref(new Date());

async function load() {
  try {
    events.value = await getJson<CalendarEvent[]>(`/resources/${encodeURIComponent(source.value)}/events`);
  } catch {
    // Die zuletzt geladenen Termine bleiben stehen.
  }
}
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

let ticker: number | undefined;
onMounted(() => (ticker = window.setInterval(() => (now.value = new Date()), 60_000)));
onUnmounted(() => window.clearInterval(ticker));

const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
const local = (text: string, allDay: boolean) => (allDay ? new Date(`${text}T00:00:00`) : new Date(text));

/** Termine je Tag; Vergangenes fällt weg, ein laufender mehrtägiger Termin steht unter heute. */
const days = computed(() => {
  const today = midnight(now.value);
  const groups = new Map<number, { key: string; time: string; title: string; place: string }[]>();
  for (const event of events.value) {
    const start = local(event.start, event.allDay);
    const end = local(event.end, event.allDay);
    if (end.getTime() <= (event.allDay ? today : now.value.getTime())) continue;
    const day = Math.max(midnight(start), today);
    // Ein Termin, der vor heute begann, hat heute keine Anfangszeit mehr
    const time = event.allDay || midnight(start) < today ? '' : new Intl.DateTimeFormat(region.value, { hour: '2-digit', minute: '2-digit' }).format(start);
    groups.set(day, [...(groups.get(day) ?? []), { key: event.id + event.start, time, title: event.title || t('calendar.untitled'), place: event.location ?? '' }]);
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([day, entries]) => {
      const offset = Math.round((day - today) / 86_400_000);
      const date = new Intl.DateTimeFormat(region.value, { weekday: 'short', day: 'numeric', month: 'numeric' }).format(day);
      return { day, label: offset === 0 ? t('calendar.today') : offset === 1 ? t('calendar.tomorrow') : date, date: offset < 2 ? date : '', entries };
    });
});
</script>

<template>
  <section class="calendar">
    <h3>{{ props.config.title ?? t('calendar.title') }}</h3>
    <div v-if="days.length" v-scroll-home class="days">
      <template v-for="day in days" :key="day.day">
        <div class="day">
          <b>{{ day.label }}</b>
          <span v-if="day.date">{{ day.date }}</span>
        </div>
        <ul>
          <li v-for="entry in day.entries" :key="entry.key">
            <span class="time">{{ entry.time || t('calendar.allDay') }}</span>
            <span class="what">{{ entry.title }}</span>
          </li>
        </ul>
      </template>
    </div>
    <p v-else class="none">{{ t('calendar.none') }}</p>
  </section>
</template>

<style scoped>
.calendar {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
h3 {
  flex: none;
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.days {
  flex: 1;
  min-height: 0;
}
.day {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
  color: var(--accent);
  font-size: 14px;
}
.day span {
  color: var(--mute);
}
ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: grid;
  grid-template-columns: 4.2em minmax(0, 1fr);
  gap: 8px;
  padding: 2px 0;
  font-size: 17px;
  line-height: 1.25;
}
.time {
  color: var(--mute);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.what {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.none {
  margin: auto 0;
  color: var(--mute);
}
</style>
