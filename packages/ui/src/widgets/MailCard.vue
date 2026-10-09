<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getJson } from '../api.ts';
import { shortWhen } from '../format.ts';
import { region } from '../i18n.ts';
import { vScrollHome } from '../scroll.ts';
import { datapoints } from '../store.ts';
import DetailOverlay from './DetailOverlay.vue';

interface MailEntry {
  account: string;
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
  attachments: boolean;
}
interface Account {
  id: string;
  name: string;
  error?: string;
}
interface Message {
  subject: string;
  from: string;
  to: string;
  date: string;
  /** Vollständige, vom Kern entschärfte HTML-Seite der Nachricht. */
  html?: string;
  text: string;
  attachments: { name: string; size: number }[];
}

/**
 * E-Mails aller eingerichteten Postfächer, das Neueste zuerst. Antippen zeigt die Nachricht;
 * Anlagen werden genannt, aber nicht geöffnet.
 */
const props = defineProps<{ config: { source?: string; title?: string } }>();

const { t } = useI18n();
const source = computed(() => props.config.source ?? 'mail');
const messages = ref<MailEntry[]>([]);
const accounts = ref<Account[]>([]);
const opened = ref<MailEntry>();
const message = ref<Message>();
const failed = ref('');

async function load() {
  try {
    const base = `/resources/${encodeURIComponent(source.value)}`;
    [messages.value, accounts.value] = await Promise.all([getJson<MailEntry[]>(`${base}/messages`), getJson<Account[]>(`${base}/accounts`)]);
  } catch {
    // Die zuletzt geladene Liste bleibt stehen.
  }
}
watch(() => datapoints.get(`${source.value}:updated`)?.value, load, { immediate: true });

const accountName = (id: string) => accounts.value.find((account) => account.id === id)?.name ?? id;
const broken = computed(() => accounts.value.filter((account) => account.error));

const size = (bytes: number) => (bytes >= 1_048_576 ? `${new Intl.NumberFormat(region.value, { maximumFractionDigits: 1 }).format(bytes / 1_048_576)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`);

async function open(entry: MailEntry) {
  opened.value = entry;
  message.value = undefined;
  failed.value = '';
  try {
    message.value = await getJson<Message>(`/p/${encodeURIComponent(source.value)}/message/${encodeURIComponent(entry.account)}/${entry.uid}`);
  } catch (cause) {
    failed.value = cause instanceof Error ? cause.message : String(cause);
  }
}
</script>

<template>
  <section class="mail">
    <h3>
      {{ props.config.title ?? t('mail.title') }}
      <span v-if="broken.length" class="trouble" :title="broken.map((account) => `${account.name}: ${account.error}`).join('\n')">{{ t('mail.trouble', { accounts: broken.map((account) => account.name).join(', ') }) }}</span>
    </h3>
    <ul v-if="messages.length" v-scroll-home>
      <li v-for="entry in messages" :key="entry.account + entry.uid">
        <button :class="{ unread: entry.unread }" @click="open(entry)">
          <span class="from">{{ entry.from || t('mail.unknownSender') }}</span>
          <span class="when">{{ shortWhen(entry.date) }}</span>
          <span class="subject">
            <!-- Büroklammer: Die Nachricht hat Anlagen -->
            <svg v-if="entry.attachments" class="clip" viewBox="0 0 24 24" role="img" :aria-label="t('mail.hasAttachments')"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.3-8.3" /></svg>
            {{ entry.subject || t('mail.noSubject') }}
          </span>
          <span v-if="accounts.length > 1" class="account">{{ accountName(entry.account) }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="none">{{ t('mail.none') }}</p>

    <DetailOverlay v-if="opened" :title="opened.subject || t('mail.noSubject')" @close="opened = undefined">
      <div class="reader">
        <dl v-if="message" class="head">
          <dt>{{ t('mail.from') }}</dt>
          <dd>{{ message.from }}</dd>
          <dt>{{ t('mail.to') }}</dt>
          <dd>{{ message.to }}</dd>
          <dt>{{ t('mail.date') }}</dt>
          <dd>{{ new Intl.DateTimeFormat(region, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(message.date)) }}</dd>
          <template v-if="message.attachments.length">
            <dt>{{ t('mail.attachments') }}</dt>
            <dd>
              {{ message.attachments.map((entry) => `${entry.name} (${size(entry.size)})`).join(', ') }}
              <span class="hint">{{ t('mail.attachmentsHint') }}</span>
            </dd>
          </template>
        </dl>
        <!-- Ohne jede Freigabe: keine Skripte, keine Formulare, keine Verweise nach außen -->
        <iframe v-if="message?.html" :srcdoc="message.html" sandbox="" referrerpolicy="no-referrer" :title="message.subject" />
        <pre v-else-if="message">{{ message.text }}</pre>
        <p v-else class="none wait">{{ failed ? t('mail.failed', { error: failed }) : t('mail.loading') }}</p>
      </div>
    </DetailOverlay>
  </section>
</template>

<style scoped>
.mail {
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
  display: flex;
  align-items: baseline;
  gap: 10px;
  color: var(--title-ink);
  font-size: var(--title-size);
  text-transform: var(--title-case);
  letter-spacing: var(--title-spacing);
  font-weight: 600;
}
.trouble {
  min-width: 0;
  color: var(--alarm);
  font-size: 13px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mail > ul {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Zwei Zeilen je Nachricht: Absender und Zeit, darunter Betreff und Postfach */
.mail > ul button {
  width: 100%;
  min-height: 46px;
  padding: 4px 0;
  border-top: 1px solid var(--line);
  background: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 10px;
  text-align: left;
  line-height: 1.25;
}
li:first-child button {
  border-top: 0;
}
.from,
.subject {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.from {
  font-size: 16px;
}
.subject {
  color: var(--mute);
  font-size: 15px;
}
.when,
.account {
  color: var(--mute);
  font-size: 13px;
  white-space: nowrap;
  text-align: right;
}
.unread .from {
  font-weight: 600;
}
.unread .subject {
  color: var(--ink);
}
.unread .when {
  color: var(--accent);
  font-weight: 600;
}
.clip {
  width: 0.95em;
  height: 0.95em;
  margin-right: 2px;
  vertical-align: -0.1em;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.none {
  margin: auto 0;
  color: var(--mute);
}

.reader {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.head {
  flex: none;
  margin: 0;
  padding: 12px 20px;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 2px 14px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  font-size: 16px;
}
dt {
  color: var(--mute);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.hint {
  margin-left: 8px;
  color: var(--mute);
  font-size: 14px;
}
iframe,
pre {
  flex: 1;
  min-height: 0;
  width: 100%;
  margin: 0;
  border: 0;
  background: #fff;
}
pre {
  box-sizing: border-box;
  padding: 16px 20px;
  color: #14202b;
  font-family: var(--font-text);
  font-size: 18px;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-y: auto;
}
.wait {
  margin: 24px 20px;
}
</style>
