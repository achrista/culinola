<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AccessDenied, accessToken, deleteJson, forgetSession, getJson, postJson, putJson, rememberSession, rememberToken, sessionToken } from '../api.ts';
import EventLayer from '../EventLayer.vue';
import { type SiteSettings, applySite } from '../i18n.ts';
import { wantedLayout } from '../layout.ts';
import { connect, subscribe } from '../store.ts';
import type { Source } from '../widgets/catalog.ts';
import type { Field } from '../widgets/settings.ts';
import { EVENT_FIELDS, type EventEntry, toEntries, toEvents } from './events.ts';
import SettingsForm from './SettingsForm.vue';

type Role = 'read' | 'control' | 'admin';
interface Access {
  name: string;
  role: Role;
}

const { t } = useI18n();
const problem = ref('');
const denied = ref(false);
const forbidden = ref(false);
const loaded = ref(false);
const sources = ref<Source[]>([]);

/** Die mitgelieferten Farbschemata; „Klar“ ist die Vorgabe und folgt dem hellen oder dunklen Modus des Geräts. */
const THEMES = ['', 'glut', 'schiefer', 'signal', 'nacht', 'spiegel'];
const SITE_FIELDS: readonly Field[] = [
  { key: 'language', type: 'select', options: ['', 'de', 'en'] },
  { key: 'region', type: 'text', placeholder: 'de-DE' },
  { key: 'theme', type: 'select', options: THEMES },
  { key: 'nightTheme', type: 'select', options: THEMES },
  { key: 'astro', type: 'source', plugin: 'source-astro' },
];
const EVENTS_FIELDS: readonly Field[] = [{ key: 'events', type: 'list', fields: EVENT_FIELDS }];

/** Je Abschnitt: was der Kern hat, was im Formular steht, und was das letzte Speichern ergab. */
const site = reactive({ saved: {} as Record<string, unknown>, value: {} as Record<string, unknown>, said: '', failed: false, busy: false });
/**
 * Wann für die Anzeigen die Nacht beginnt, ist eine Einstellung der Quelle „Sonne und Mond“ – sie steht hier
 * beim Farbschema, weil man sie dort sucht. `source` ist die Quelle, an der sie hängt; ohne sie gibt es das Feld nicht.
 */
const night = reactive({ source: undefined as { id: string; config: Record<string, unknown> } | undefined, saved: '', value: '' });
const events = reactive({ saved: [] as EventEntry[], value: [] as EventEntry[], said: '', failed: false, busy: false });
const access = reactive({ list: [] as Access[], name: '', role: 'control' as Role, said: '', failed: false, busy: false, sure: '' });
/** Das Einrichtungskennwort: ob eines gesetzt ist, und das Formular zum Festlegen oder Ändern. */
const password = reactive({ set: false, value: '', repeat: '', said: '', failed: false, busy: false, sure: false });
interface Waiting {
  id: string;
  code: string;
  label: string;
  address: string;
  since: string;
}
/** Anzeigen, die um einen Zugang bitten, und was für sie eingetragen wird. */
const pair = reactive({ list: [] as Waiting[], names: {} as Record<string, string>, roles: {} as Record<string, Role>, said: '', failed: false, busy: false });
const signedIn = ref(!!sessionToken());
/** Das Token eines eben angelegten Zugangs – der Kern nennt es nur dieses eine Mal. */
const fresh = ref<{ name: string; token: string; adopted: boolean }>();

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const siteDirty = computed(() => JSON.stringify(site.value) !== JSON.stringify(site.saved) || night.value !== night.saved);

/** Die Quelle, die Tag und Nacht kennt: die gewählte, sonst „astro“. */
async function loadNight(): Promise<void> {
  const wanted = typeof site.saved['astro'] === 'string' ? site.saved['astro'] : 'astro';
  try {
    const all = await getJson<{ id: string; plugin: string; config: Record<string, unknown> }[]>('/sources');
    const found = all.find((source) => source.id === wanted && source.plugin === 'source-astro');
    const minutes = found?.config['nightOffsetMinutes'];
    const shown = typeof minutes === 'number' ? String(minutes) : '';
    Object.assign(night, { source: found ? { id: found.id, config: found.config } : undefined, saved: shown, value: shown });
  } catch {
    night.source = undefined;
  }
}
const eventsDirty = computed(() => JSON.stringify(events.value) !== JSON.stringify(events.saved));

onMounted(async () => {
  try {
    if ((await getJson<{ role?: string }>('/access')).role !== 'admin') {
      forbidden.value = true;
      return;
    }
    const all = await getJson<{ site: Record<string, unknown>; events: Record<string, unknown>; access: Access[]; password?: boolean }>('/settings');
    password.set = all.password === true;
    Object.assign(site, { saved: all.site, value: clone(all.site) });
    Object.assign(events, { saved: toEntries(all.events), value: toEntries(all.events) });
    access.list = all.access;
    // Ohne Kennwort muss der erste Zugang einrichten dürfen – das ist dann auch die Vorgabe
    access.role = all.access.length || password.set ? 'control' : 'admin';
    void loadWaiting();
    waitingTimer = window.setInterval(() => void loadWaiting(), 3_000);
    sources.value = (await getJson<{ sources: (Source & { state: string })[] }>('/status')).sources.filter((source) => source.state === 'running');
    await loadNight();
    loaded.value = true;
    // Auch diese Seite zeigt Meldungen – so sieht und hört man eine Probe gleich hier
    subscribe([], wantedLayout());
    connect();
  } catch (cause) {
    denied.value = cause instanceof AccessDenied;
    problem.value = cause instanceof Error ? cause.message : String(cause);
  }
});

let waitingTimer: number | undefined;
onUnmounted(() => window.clearInterval(waitingTimer));

/** Holt die Anzeigen, die gerade um einen Zugang bitten; scheitert es, bleibt die Liste, wie sie ist. */
async function loadWaiting(): Promise<void> {
  try {
    pair.list = await getJson<Waiting[]>('/settings/pairing');
    for (const entry of pair.list) pair.roles[entry.id] ??= 'control';
  } catch {
    // Ein Kern ohne Koppeln oder eine abgelaufene Anmeldung: Dann gibt es hier nichts zu zeigen.
  }
}

/** Ruft den Kern und sagt im Abschnitt, was daraus wurde. */
async function calling(section: { said: string; failed: boolean; busy: boolean }, call: () => Promise<string>): Promise<void> {
  if (section.busy) return;
  Object.assign(section, { busy: true, said: '', failed: false });
  try {
    section.said = await call();
  } catch (cause) {
    Object.assign(section, { said: cause instanceof Error ? cause.message : String(cause), failed: true });
  } finally {
    section.busy = false;
  }
}

const saveSite = () =>
  calling(site, async () => {
    const saved = await putJson<Record<string, unknown>>('/settings/site', site.value);
    Object.assign(site, { saved, value: clone(saved) });
    // Auch diese Seite spricht ab sofort die neue Sprache
    applySite(saved as SiteSettings);
    // Der Beginn der Nacht steht bei der Quelle „Sonne und Mond“; sie startet damit neu
    if (night.source && night.value !== night.saved) {
      const config = { ...night.source.config };
      if (String(night.value).trim() === '') delete config['nightOffsetMinutes'];
      else config['nightOffsetMinutes'] = Number(night.value);
      await putJson(`/sources/${encodeURIComponent(night.source.id)}`, { config });
    }
    await loadNight();
    return t('system.siteSaved');
  });

const saveEvents = () =>
  calling(events, async () => {
    const wanted = toEvents(events.value, { noName: t('system.eventNoName'), twice: (name) => t('system.eventTwice', { name }) });
    const saved = await putJson<Record<string, unknown>>('/settings/events', wanted);
    Object.assign(events, { saved: toEntries(saved), value: toEntries(saved) });
    return t('system.eventsSaved');
  });

/** Löst eine gespeicherte Meldung zur Probe aus – sie erscheint auf jeder offenen Anzeige. */
const raise = (name: string) =>
  calling(events, async () => {
    await postJson(`/events/${encodeURIComponent(name)}`, {});
    return t('system.raised', { name });
  });

const savePassword = () =>
  calling(password, async () => {
    if (password.value !== password.repeat) throw new Error(t('gate.mismatch'));
    const wasOpen = !password.set && access.list.length === 0;
    const session = await putJson<{ token: string }>('/settings/password', { password: password.value });
    // Mit dem neuen Kennwort enden alle bisherigen Anmeldungen – diese Seite bekommt gleich die neue
    rememberSession(session.token);
    signedIn.value = true;
    Object.assign(password, { set: true, value: '', repeat: '' });
    if (access.role === 'admin') access.role = 'control';
    return t(wasOpen ? 'system.passwordSavedOpen' : 'system.passwordSaved');
  });

const removePassword = () =>
  calling(password, async () => {
    try {
      await deleteJson('/settings/password');
    } finally {
      password.sure = false;
    }
    forgetSession();
    // Ohne Kennwort gilt wieder, als was dieser Browser sonst freigeschaltet ist – die Seite zeigt den neuen Stand
    location.reload();
    return '';
  });

const approve = (entry: Waiting) =>
  calling(pair, async () => {
    const name = (pair.names[entry.id] ?? '').trim();
    const created = await postJson<Access>(`/settings/pairing/${encodeURIComponent(entry.id)}`, { name, role: pair.roles[entry.id] ?? 'control' });
    access.list.push(created);
    await loadWaiting();
    return t('system.pairApproved', { name: created.name });
  });

const reject = (entry: Waiting) =>
  calling(pair, async () => {
    await deleteJson(`/settings/pairing/${encodeURIComponent(entry.id)}`);
    await loadWaiting();
    return t('system.pairRejected');
  });

function logout(): void {
  forgetSession();
  go((query) => query.delete('edit'));
}

const addAccess = () =>
  calling(access, async () => {
    const wasOpen = access.list.length === 0 && !password.set;
    const created = await postJson<Access & { token: string }>('/settings/access', { name: access.name.trim(), role: access.role });
    // War die API bis eben offen, sperrt der erste Zugang auch diese Seite aus – sie merkt sich deshalb sein Token
    const adopted = wasOpen || !accessToken() ? rememberToken(created.token) : false;
    fresh.value = { name: created.name, token: created.token, adopted };
    access.list.push({ name: created.name, role: created.role });
    Object.assign(access, { name: '', role: 'control' });
    return '';
  });

const setRole = (name: string, role: string) =>
  calling(access, async () => {
    const changed = await putJson<Access>(`/settings/access/${encodeURIComponent(name)}`, { role });
    access.list = access.list.map((entry) => (entry.name === name ? changed : entry));
    return t('system.roleSaved', { name });
  });

const removeAccess = (name: string) =>
  calling(access, async () => {
    try {
      await deleteJson(`/settings/access/${encodeURIComponent(name)}`);
    } finally {
      access.sure = '';
      // Auch nach einer Ablehnung zeigt die Liste, was im Kern gilt
      access.list = await getJson<{ access: Access[] }>('/settings').then((all) => all.access).catch(() => access.list.filter((entry) => entry.name !== name));
    }
    if (fresh.value?.name === name) fresh.value = undefined;
    return t('system.accessRemoved', { name });
  });

const unlockAddress = computed(() => (fresh.value ? `${location.origin}/#token=${encodeURIComponent(fresh.value.token)}` : ''));

function go(change: (query: URLSearchParams) => void): void {
  const query = new URLSearchParams(location.search);
  change(query);
  location.search = query.toString().replace(/(^|&)edit=(?=&|$)/, '$1edit');
}
</script>

<template>
  <p v-if="forbidden" class="notice">{{ t('system.needsAdmin') }}</p>
  <p v-else-if="denied" class="notice">{{ t('app.notUnlocked', { error: problem }) }}</p>
  <p v-else-if="problem" class="notice">{{ problem }}</p>
  <div v-else-if="loaded" class="system">
    <header class="bar">
      <strong>{{ t('system.title') }}</strong>
      <span class="spacer" />
      <button type="button" @click="go((query) => query.set('edit', ''))">{{ t('sources.back') }}</button>
      <button type="button" @click="go((query) => query.set('edit', 'sources'))">{{ t('editor.sources') }}</button>
      <button type="button" @click="go((query) => query.delete('edit'))">{{ t('editor.close') }}</button>
      <button v-if="signedIn" type="button" @click="logout">{{ t('system.logout') }}</button>
    </header>

    <main>
      <section>
        <h2>{{ t('system.site') }}</h2>
        <p class="hint">{{ t('system.siteHint') }}</p>
        <SettingsForm type="site" :fields="SITE_FIELDS" :value="site.value" :sources="sources" @update="site.value = $event" />
        <label v-if="night.source" class="row">
          <span>{{ t('system.nightOffset') }}</span>
          <input v-model="night.value" type="number" inputmode="numeric" min="-180" max="180" :placeholder="t('form.default', { value: 30 })" />
          <small>{{ t('system.nightOffsetHint', { source: night.source.id }) }}</small>
        </label>
        <p v-else class="hint small">{{ t('system.nightOffsetMissing') }}</p>
        <p v-if="site.said" class="said" :class="{ bad: site.failed }" role="status">{{ site.said }}</p>
        <div class="actions">
          <button type="button" class="primary" :disabled="!siteDirty || site.busy" @click="saveSite">{{ t('editor.save') }}</button>
        </div>
      </section>

      <section>
        <h2>{{ t('system.events') }}</h2>
        <p class="hint">{{ t('system.eventsHint') }}</p>
        <SettingsForm type="events" :fields="EVENTS_FIELDS" :value="{ events: events.value }" :sources="sources" @update="events.value = ($event['events'] as EventEntry[] | undefined) ?? []" />
        <p v-if="events.said" class="said" :class="{ bad: events.failed }" role="status">{{ events.said }}</p>
        <div class="actions">
          <button type="button" class="primary" :disabled="!eventsDirty || events.busy" @click="saveEvents">{{ t('editor.save') }}</button>
          <template v-if="!eventsDirty && events.saved.length">
            <span class="hint">{{ t('system.try') }}</span>
            <button v-for="entry in events.saved" :key="String(entry['name'])" type="button" :disabled="events.busy" @click="raise(String(entry['name']))">{{ entry['name'] }}</button>
          </template>
        </div>
      </section>

      <section>
        <h2>{{ t('system.access') }}</h2>
        <p class="hint" :class="{ bad: !access.list.length && !password.set }">{{ access.list.length || password.set ? t('system.accessHint') : t('system.accessOpen') }}</p>
        <details class="help" :open="!access.list.length && !password.set">
          <summary>{{ t('system.accessHelp') }}</summary>
          <p v-for="(paragraph, index) in t('system.accessHelpText').split('\n')" :key="index">{{ paragraph }}</p>
        </details>

        <h3>{{ t('system.passwordTitle') }}</h3>
        <p class="hint">{{ t(password.set ? 'system.passwordSet' : 'system.passwordUnset') }}</p>
        <form class="adding" @submit.prevent="savePassword">
          <label>{{ t(password.set ? 'gate.newPassword' : 'gate.password') }} <input v-model="password.value" type="password" required minlength="8" autocomplete="new-password" /></label>
          <label>{{ t('gate.repeat') }} <input v-model="password.repeat" type="password" required minlength="8" autocomplete="new-password" /></label>
          <button type="submit" class="primary" :disabled="password.busy">{{ t(password.set ? 'system.passwordChange' : 'system.passwordSave') }}</button>
          <template v-if="password.set">
            <template v-if="password.sure">
              <span>{{ t('system.passwordRemoveSure') }}</span>
              <button type="button" class="danger" :disabled="password.busy" @click="removePassword">{{ t('sources.removeYes') }}</button>
              <button type="button" @click="password.sure = false">{{ t('sources.cancel') }}</button>
            </template>
            <button v-else type="button" @click="password.sure = true">{{ t('system.passwordRemove') }}</button>
          </template>
        </form>
        <p v-if="!password.set && !access.list.length" class="hint small">{{ t('system.passwordOpenWarning') }}</p>
        <p v-if="password.said" class="said" :class="{ bad: password.failed }" role="status">{{ password.said }}</p>

        <h3>{{ t('system.pairTitle') }}</h3>
        <p class="hint">{{ t('system.pairHint') }}</p>
        <table v-if="pair.list.length" class="waiting">
          <tr v-for="entry in pair.list" :key="entry.id">
            <td>
              <strong class="code">{{ entry.code.replace(/^(\d{3})(\d{3})$/, '$1 $2') }}</strong>
              <small>{{ entry.label }} · {{ entry.address }}</small>
            </td>
            <td>
              <input v-model="pair.names[entry.id]" type="text" maxlength="40" :aria-label="t('system.name')" :placeholder="t('form.example', { value: 'kueche' })" pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" spellcheck="false" autocapitalize="off" autocomplete="off" />
              <select v-model="pair.roles[entry.id]" :aria-label="t('system.role')">
                <option v-for="role in ['read', 'control', 'admin']" :key="role" :value="role">{{ t(`system.roles.${role}`) }}</option>
              </select>
            </td>
            <td class="end">
              <button type="button" class="primary" :disabled="pair.busy || !(pair.names[entry.id] ?? '').trim()" @click="approve(entry)">{{ t('system.pairApprove') }}</button>
              <button type="button" :disabled="pair.busy" @click="reject(entry)">{{ t('system.pairReject') }}</button>
            </td>
          </tr>
        </table>
        <p v-else class="hint small">{{ t('system.pairNone') }}</p>
        <p v-if="pair.said" class="said" :class="{ bad: pair.failed }" role="status">{{ pair.said }}</p>

        <h3>{{ t('system.tokensTitle') }}</h3>
        <p class="hint">{{ t('system.tokensHint') }}</p>

        <table v-if="access.list.length">
          <tr v-for="entry in access.list" :key="entry.name">
            <td>
              <strong>{{ entry.name }}</strong>
            </td>
            <td>
              <select :value="entry.role" :disabled="access.busy" :aria-label="t('system.role')" @change="setRole(entry.name, ($event.target as HTMLSelectElement).value)">
                <option v-for="role in ['read', 'control', 'admin']" :key="role" :value="role">{{ t(`system.roles.${role}`) }}</option>
              </select>
            </td>
            <td class="end">
              <template v-if="access.sure === entry.name">
                <span>{{ t('system.removeSure', { name: entry.name }) }}</span>
                <button type="button" class="danger" :disabled="access.busy" @click="removeAccess(entry.name)">{{ t('sources.removeYes') }}</button>
                <button type="button" @click="access.sure = ''">{{ t('sources.cancel') }}</button>
              </template>
              <button v-else type="button" @click="access.sure = entry.name">{{ t('system.remove') }}</button>
            </td>
          </tr>
        </table>

        <!-- Das Token eines neuen Zugangs steht nur jetzt da; der Kern gibt es danach nicht mehr heraus -->
        <div v-if="fresh" class="fresh" role="status">
          <strong>{{ t('system.freshTitle', { name: fresh.name }) }}</strong>
          <p>{{ t('system.freshOnce') }}</p>
          <label>{{ t('system.token') }} <input type="text" readonly :value="fresh.token" @focus="($event.target as HTMLInputElement).select()" /></label>
          <label>{{ t('system.unlock') }} <input type="text" readonly :value="unlockAddress" @focus="($event.target as HTMLInputElement).select()" /></label>
          <p>{{ t('system.unlockHint') }}</p>
          <p v-if="fresh.adopted">
            <strong>{{ t('system.adopted') }}</strong>
          </p>
          <button type="button" @click="fresh = undefined">{{ t('system.freshDone') }}</button>
        </div>

        <form class="adding" @submit.prevent="addAccess">
          <label>{{ t('system.name') }} <input v-model="access.name" type="text" required maxlength="40" :placeholder="t('form.example', { value: 'kueche' })" pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" spellcheck="false" autocapitalize="off" autocomplete="off" /></label>
          <label>
            {{ t('system.role') }}
            <select v-model="access.role">
              <option v-for="role in ['read', 'control', 'admin']" :key="role" :value="role">{{ t(`system.roles.${role}`) }}</option>
            </select>
          </label>
          <button type="submit" class="primary" :disabled="access.busy">{{ t('system.add') }}</button>
        </form>
        <p v-if="!access.list.length && !password.set" class="hint">{{ t('system.firstAdmin') }}</p>
        <p v-if="access.said" class="said" :class="{ bad: access.failed }" role="status">{{ access.said }}</p>
      </section>
    </main>
    <EventLayer />
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--bg-ink);
}
.system {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--soft);
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  font-size: 18px;
}
.spacer {
  flex: 1;
}
main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 20px 40px;
}
section {
  max-width: 720px;
  margin: 16px 0;
  padding: 12px 14px 14px;
  border-radius: 8px;
  background: var(--card);
}
h2 {
  margin: 0 0 6px;
  font-size: 18px;
}
h3 {
  margin: 22px 0 4px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 16px;
}
/* Wartende Anzeigen: der Code groß, damit er sich mit dem auf dem Gerät vergleichen lässt */
.waiting .code {
  display: block;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}
.waiting small {
  color: var(--mute);
}
.waiting input {
  width: 9em;
  margin-right: 6px;
}
button,
select,
input {
  font: inherit;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 10px;
}
button {
  min-height: 40px;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.danger {
  background: var(--alarm);
  border-color: var(--alarm);
  color: #ffffff;
  font-weight: 600;
}
.hint {
  color: var(--mute);
}
.hint.small,
.row small {
  font-size: 12px;
  line-height: 1.3;
  color: var(--mute);
}
.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.row > span {
  color: var(--mute);
  font-size: 14px;
}
.row input::placeholder,
.adding input::placeholder {
  color: var(--none);
  font-style: italic;
}
.help {
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: 6px;
  border-left: 4px solid var(--accent);
  background: var(--soft);
}
.help summary {
  cursor: pointer;
  font-weight: 600;
}
.help p {
  margin: 8px 0 0;
}
.bad {
  color: var(--alarm);
}
.said {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--soft);
}
.actions,
.adding {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.actions {
  align-items: center;
}
.adding label,
.fresh label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mute);
  font-size: 14px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
td {
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid var(--line);
}
td.end {
  text-align: right;
}
td.end > * {
  margin-left: 6px;
}
.fresh {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  border-left: 4px solid var(--warn);
  background: var(--soft);
}
.fresh p {
  margin: 8px 0;
}
.fresh label {
  margin: 8px 0;
}
.fresh input {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 14px;
}
</style>
