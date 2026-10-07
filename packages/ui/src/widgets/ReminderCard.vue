<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';
import { region } from '../i18n.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';

interface Reminder {
  contact: string;
  name: string;
  kind: 'birthday' | 'nameday' | 'wedding' | 'baptism' | 'death' | 'anniversary' | 'other';
  label?: string;
  date: string;
  inDays: number;
  years?: number;
  deceased: boolean;
  phones: { label: string; number: string }[];
}

/**
 * Anstehende Geburtstage und andere wiederkehrende Tage als Liste.
 * Antippen zeigt die Telefonnummern des Kontakts – zum Gratulieren.
 */
const props = defineProps<{ config: { source?: string; title?: string } }>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'google');
const reminders = ref<Reminder[]>([]);
const opened = ref<Reminder>();

async function load() {
  try {
    reminders.value = await getJson<Reminder[]>(`/resources/${encodeURIComponent(source.value)}/reminders`);
  } catch {
    // Die zuletzt geladene Liste bleibt stehen.
  }
}
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

/** Der Satz zu einer Erinnerung – je nach Art, Alter und danach, ob die Person noch lebt. */
function sentence(entry: Reminder): string {
  const date = new Intl.DateTimeFormat(region.value, { day: 'numeric', month: 'numeric' }).format(new Date(`${entry.date}T00:00:00`));
  const values = { name: entry.name, date, years: entry.years ?? 0, label: entry.label ?? '' };
  const form = entry.years ? 'withYears' : 'plain';
  if (entry.kind === 'birthday') return t(`reminders.birthday.${entry.deceased ? 'deceased' : 'living'}.${form}`, values);
  return t(`reminders.${entry.kind}.${form}`, values);
}
const when = (entry: Reminder) => (entry.inDays === 0 ? t('reminders.today') : entry.inDays === 1 ? t('reminders.tomorrow') : entry.inDays === -1 ? t('reminders.yesterday') : '');
const dial = (number: string) => `tel:${number.replace(/[^\d+]/g, '')}`;
</script>

<template>
  <section class="reminders">
    <h3>{{ props.config.title ?? t('reminders.title') }}</h3>
    <ul v-if="reminders.length">
      <li v-for="entry in reminders" :key="entry.contact + entry.kind + entry.date + entry.name">
        <button :class="{ today: entry.inDays === 0, past: entry.inDays < 0 }" @click="opened = entry">
          <span class="text">{{ sentence(entry) }}</span>
          <span v-if="when(entry)" class="when">{{ when(entry) }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="none">{{ t('reminders.none') }}</p>

    <DetailOverlay v-if="opened" :title="opened.name" @close="opened = undefined">
      <div class="contact">
        <p class="occasion">{{ sentence(opened) }}</p>
        <ul v-if="opened.phones.length && !opened.deceased" class="phones">
          <li v-for="phone in opened.phones" :key="phone.number">
            <span>{{ phone.label }}</span>
            <a :href="dial(phone.number)">{{ phone.number }}</a>
          </li>
        </ul>
        <p v-else-if="!opened.deceased" class="none">{{ t('reminders.noPhone') }}</p>
      </div>
    </DetailOverlay>
  </section>
</template>

<style scoped>
.reminders {
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
.reminders > ul {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}
.reminders > ul button {
  width: 100%;
  min-height: 30px;
  padding: 3px 0;
  background: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  text-align: left;
  font-size: 17px;
  line-height: 1.25;
}
.text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.when {
  flex: none;
  color: var(--mute);
  font-size: 14px;
}
.today .text {
  font-weight: 600;
}
.today .when {
  color: var(--accent);
  font-weight: 600;
}
.past {
  color: var(--mute);
}
.none {
  margin: auto 0;
  color: var(--mute);
}

.contact {
  padding: 28px clamp(16px, 5vw, 64px);
  font-size: 22px;
}
.occasion {
  margin: 0 0 24px;
}
.phones {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: max-content max-content;
  gap: 14px 28px;
  align-items: baseline;
}
.phones li {
  display: contents;
}
.phones span {
  color: var(--mute);
}
.phones a {
  font-family: var(--font-num);
  font-size: 40px;
  color: var(--ink);
  text-decoration: none;
}
</style>
