<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AccessDenied, deleteJson, getJson, postJson, putJson } from '../api.ts';
import { type Field, initialValues } from '../widgets/settings.ts';
import SettingsForm from './SettingsForm.vue';

type Texts = Record<string, string>;
/** Eine Quelle, wie der Kern sie nennt: Einstellungen und Zustand – von den Zugangsdaten nur die Namen der hinterlegten. */
interface Source {
  id: string;
  plugin: string;
  /** `new`: in dieser Seite begonnen, im Kern noch nicht angelegt. */
  state: 'running' | 'failed' | 'new';
  error?: string;
  config: Record<string, unknown>;
  secrets: string[];
  datapoints?: number;
  notes?: { at: string; level: 'info' | 'warn' | 'error'; text: string }[];
}
interface Plugin {
  id: string;
  name?: Texts;
  text?: Texts;
  help?: Texts;
  settings?: Field[];
  secrets?: { key: string; label: Texts; hint?: Texts }[];
}

const { t, locale } = useI18n();
const own = (texts: Texts | undefined, fallback = '') => (texts ? (texts[locale.value] ?? texts['en'] ?? Object.values(texts)[0] ?? fallback) : fallback);

const sources = ref<Source[]>([]);
const plugins = ref<Plugin[]>([]);
const problem = ref('');
const denied = ref(false);
const forbidden = ref(false);
const loaded = ref(false);

const pluginOf = (id: string) => plugins.value.find((plugin) => plugin.id === id);
const nameOf = (id: string) => own(pluginOf(id)?.name, id);

onMounted(async () => {
  try {
    if ((await getJson<{ role?: string }>('/access')).role !== 'admin') {
      forbidden.value = true;
      return;
    }
    [sources.value, plugins.value] = await Promise.all([getJson<Source[]>('/sources'), getJson<Plugin[]>('/plugins')]);
    loaded.value = true;
    // Eine Quelle meldet oft erst Sekunden nach dem Start, ob sie ihr Gerät erreicht – deshalb wird nachgesehen
    poll = setInterval(() => void refresh(), 4000);
  } catch (cause) {
    denied.value = cause instanceof AccessDenied;
    problem.value = cause instanceof Error ? cause.message : String(cause);
  }
});

let poll: ReturnType<typeof setInterval> | undefined;
onUnmounted(() => clearInterval(poll));
async function refresh(): Promise<void> {
  try {
    sources.value = await getJson<Source[]>('/sources');
  } catch {
    // Ist der Kern gerade nicht erreichbar, bleibt stehen, was da ist
  }
}
const clock = (at: string) => new Date(at).toLocaleTimeString(locale.value);

// ── Die gewählte Quelle ──────────────────────────────────────────────────────────────────────────────────

const selected = ref<string>();
/** Eine Quelle, die gerade angelegt wird: Sie entsteht im Kern erst mit ihren Einstellungen – ohne die starten die meisten nicht. */
const pending = ref<Source>();
const shown = computed(() => (pending.value ? [...sources.value, pending.value] : sources.value));
const current = computed(() => shown.value.find((source) => source.id === selected.value));
const isNew = computed(() => current.value?.state === 'new');
const plugin = computed(() => (current.value ? pluginOf(current.value.plugin) : undefined));

/** Was im Formular steht, bis es gespeichert wird. Zugangsdaten stehen nur hier, solange sie eingetippt sind. */
const form = reactive({
  config: {} as Record<string, unknown>,
  json: '',
  jsonProblem: '',
  entered: {} as Record<string, string>,
  clear: {} as Record<string, boolean>,
  otherName: '',
  otherValue: '',
  sure: false,
  busy: false,
  said: '',
  failed: false,
});

function select(id: string | undefined): void {
  selected.value = id;
  const source = current.value;
  Object.assign(form, { config: structuredClone(source ? JSON.parse(JSON.stringify(source.config)) : {}), jsonProblem: '', entered: {}, clear: {}, otherName: '', otherValue: '', sure: false, said: '', failed: false });
  form.json = JSON.stringify(form.config, null, 2);
}

function setConfig(config: Record<string, unknown>): void {
  form.config = config;
  form.json = JSON.stringify(config, null, 2);
  form.jsonProblem = '';
}

function applyJson(): void {
  try {
    const config = JSON.parse(form.json) as unknown;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('{ … }');
    form.config = config as Record<string, unknown>;
    form.jsonProblem = '';
  } catch (cause) {
    form.jsonProblem = t('sources.badJson', { error: cause instanceof Error ? cause.message : String(cause) });
  }
}

/** Die Zugangsangaben der Quelle: die das Plugin nennt, dazu alles, was sonst hinterlegt ist. */
const secretRows = computed(() => {
  const source = current.value;
  if (!source) return [];
  const declared = plugin.value?.secrets ?? [];
  const extra = source.secrets.filter((name) => !declared.some((secret) => secret.key === name));
  return [...declared.map((secret) => ({ key: secret.key, label: own(secret.label, secret.key), hint: own(secret.hint) })), ...extra.map((key) => ({ key, label: key, hint: '' }))].map((row) => ({
    ...row,
    stored: source.secrets.includes(row.key),
  }));
});

const secretChanges = computed(() => {
  const changes: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(form.entered)) if (value) changes[name] = value;
  for (const [name, wanted] of Object.entries(form.clear)) if (wanted && !changes[name]) changes[name] = null;
  if (form.otherName.trim() && form.otherValue) changes[form.otherName.trim()] = form.otherValue;
  return changes;
});
const dirty = computed(() => !!current.value && (isNew.value || JSON.stringify(form.config) !== JSON.stringify(current.value.config) || Object.keys(secretChanges.value).length > 0));

/** Übernimmt, was der Kern nach einer Änderung über die Quelle sagt. */
function adopt(source: Source): void {
  const position = sources.value.findIndex((entry) => entry.id === source.id);
  if (position < 0) sources.value.push(source);
  else sources.value[position] = source;
}

async function calling(call: () => Promise<void>): Promise<void> {
  if (form.busy) return;
  form.busy = true;
  form.said = '';
  form.failed = false;
  try {
    await call();
  } catch (cause) {
    form.said = cause instanceof Error ? cause.message : String(cause);
    form.failed = true;
  } finally {
    form.busy = false;
  }
}

/** Sagt, wie die Quelle nach dem Speichern oder Neustarten dasteht – das ist zugleich die Probe der Verbindung. */
function report(source: Source, fine: string): void {
  form.failed = source.state !== 'running';
  form.said = form.failed ? t('sources.savedFailed', { error: source.error ?? '' }) : fine;
}

function save(): void {
  const id = selected.value;
  if (!id) return;
  void calling(async () => {
    const body = { config: form.config, secrets: secretChanges.value };
    const source = isNew.value ? await postJson<Source>('/sources', { id, plugin: current.value!.plugin, ...body }) : await putJson<Source>(`/sources/${encodeURIComponent(id)}`, body);
    if (pending.value?.id === id) pending.value = undefined;
    adopt(source);
    select(id);
    report(source, t('sources.saved'));
  });
}

function restart(): void {
  const id = selected.value;
  if (!id) return;
  void calling(async () => {
    const source = await postJson<Source>(`/sources/${encodeURIComponent(id)}/restart`, {});
    adopt(source);
    report(source, t('sources.restarted'));
  });
}

function remove(): void {
  const id = selected.value;
  if (!id) return;
  void calling(async () => {
    if (isNew.value) pending.value = undefined;
    else {
      await deleteJson(`/sources/${encodeURIComponent(id)}`);
      sources.value = sources.value.filter((source) => source.id !== id);
    }
    select(undefined);
  });
}

// ── Neue Quelle ──────────────────────────────────────────────────────────────────────────────────────────

const adding = reactive({ plugin: '', id: '', problem: '' });

/** Beginnt eine neue Quelle: Sie steht mit ihrem Formular da und wird mit „Anlegen und starten“ im Kern angelegt. */
function begin(): void {
  const id = adding.id.trim();
  if (sources.value.some((source) => source.id === id)) {
    adding.problem = t('sources.taken', { name: id });
    return;
  }
  pending.value = { id, plugin: adding.plugin, state: 'new', config: initialValues(pluginOf(adding.plugin)?.settings ?? []), secrets: [] };
  Object.assign(adding, { plugin: '', id: '', problem: '' });
  select(id);
}

function go(change: (query: URLSearchParams) => void): void {
  const query = new URLSearchParams(location.search);
  change(query);
  location.search = query.toString().replace(/(^|&)edit=(?=&|$)/, '$1edit');
}
</script>

<template>
  <p v-if="forbidden" class="notice">{{ t('sources.needsAdmin') }}</p>
  <p v-else-if="denied" class="notice">{{ t('app.notUnlocked', { error: problem }) }}</p>
  <p v-else-if="problem" class="notice">{{ problem }}</p>
  <div v-else-if="loaded" class="sources">
    <header class="bar">
      <strong>{{ t('sources.title') }}</strong>
      <span class="spacer" />
      <button type="button" @click="go((query) => query.set('edit', ''))">{{ t('sources.back') }}</button>
      <button type="button" @click="go((query) => query.delete('edit'))">{{ t('editor.close') }}</button>
    </header>

    <div class="work">
      <nav class="list">
        <button v-for="source in shown" :key="source.id" type="button" class="entry" :class="{ chosen: source.id === selected }" @click="select(source.id)">
          <span class="dot" :class="source.state" />
          <span class="names">
            <strong>{{ source.id }}</strong>
            <small>{{ nameOf(source.plugin) }} · {{ t(`sources.${source.state}`) }}<template v-if="source.state === 'running'"> · {{ t('sources.count', { count: source.datapoints ?? 0 }) }}</template></small>
            <small v-if="source.error" class="bad">{{ source.error }}</small>
          </span>
        </button>

        <form class="adding" @submit.prevent="begin">
          <h2>{{ t('sources.add') }}</h2>
          <label>
            {{ t('sources.plugin') }}
            <select v-model="adding.plugin" required>
              <option value="" disabled>…</option>
              <option v-for="entry in plugins" :key="entry.id" :value="entry.id">{{ own(entry.name, entry.id) }}</option>
            </select>
          </label>
          <small v-if="adding.plugin">{{ own(pluginOf(adding.plugin)?.text) }}</small>
          <label>
            {{ t('sources.id') }}
            <input v-model="adding.id" type="text" required maxlength="40" pattern="[a-z][a-z0-9\-]*" spellcheck="false" autocapitalize="off" />
          </label>
          <small>{{ t('sources.idHint') }}</small>
          <p v-if="adding.problem" class="bad" role="alert">{{ adding.problem }}</p>
          <button type="submit" class="primary">{{ t('sources.next') }}</button>
        </form>
      </nav>

      <main class="detail">
        <p v-if="!current" class="hint">{{ t('sources.choose') }}</p>
        <template v-else>
          <h1>
            {{ current.id }} <small>{{ nameOf(current.plugin) }} · <span :class="{ bad: current.state === 'failed' }">{{ t(`sources.${current.state}`) }}</span></small>
          </h1>
          <p class="hint">{{ own(plugin?.text) }}</p>
          <p v-if="current.error" class="said bad" role="alert">{{ current.error }}</p>

          <!-- Was zum Einrichten zu wissen ist – bei einer neuen Quelle gleich aufgeklappt -->
          <details v-if="plugin?.help" class="help" :open="isNew || current.state === 'failed'">
            <summary>{{ t('sources.help') }}</summary>
            <p v-for="(paragraph, index) in own(plugin.help).split('\n')" :key="index">{{ paragraph }}</p>
          </details>

          <section v-if="!isNew">
            <h2>{{ t('sources.notes') }} <small>{{ t('sources.count', { count: current.datapoints ?? 0 }) }}</small></h2>
            <p v-if="!current.notes?.length" class="hint">{{ t('sources.noNotes') }}</p>
            <ul v-else class="notes">
              <li v-for="(note, index) in current.notes" :key="index" :class="note.level">
                <time>{{ clock(note.at) }}</time> {{ note.text }}
              </li>
            </ul>
          </section>

          <section>
            <h2>{{ t('sources.settings') }}</h2>
            <SettingsForm v-if="plugin?.settings?.length" :key="current.id" :type="`plugin.${current.plugin}`" :fields="plugin.settings" :value="form.config" :sources="[]" @update="setConfig" />
            <p v-else class="hint">{{ plugin?.settings ? t('sources.noSettings') : t('sources.undescribed') }}</p>
            <details class="advanced">
              <summary>{{ t('sources.advanced') }}</summary>
              <textarea v-model="form.json" rows="12" spellcheck="false" autocapitalize="off" @change="applyJson" />
              <p v-if="form.jsonProblem" class="bad" role="alert">{{ form.jsonProblem }}</p>
            </details>
          </section>

          <section>
            <h2>{{ t('sources.secrets') }}</h2>
            <p class="hint">{{ t('sources.secretsHint') }}</p>
            <div v-for="row in secretRows" :key="row.key" class="secret">
              <label>
                <span>{{ row.label }} <em :class="{ stored: row.stored }">{{ row.stored ? t('sources.stored') : t('sources.missing') }}</em></span>
                <!-- Der Kern schickt Hinterlegtes nie zurück: Das Feld ist immer leer, bis jemand etwas einträgt -->
                <input v-model="form.entered[row.key]" type="password" autocomplete="new-password" :placeholder="row.stored ? t('sources.keep') : t('sources.enter')" :disabled="form.clear[row.key]" />
              </label>
              <small v-if="row.hint">{{ row.hint }}</small>
              <label v-if="row.stored" class="check"><input v-model="form.clear[row.key]" type="checkbox" /> {{ t('sources.clear') }}</label>
            </div>
            <details class="advanced">
              <summary>{{ t('sources.other') }}</summary>
              <p class="hint">{{ t('sources.otherHint') }}</p>
              <div class="other">
                <label>{{ t('sources.otherName') }} <input v-model="form.otherName" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" /></label>
                <label>{{ t('sources.otherValue') }} <input v-model="form.otherValue" type="password" autocomplete="new-password" /></label>
              </div>
            </details>
          </section>

          <p v-if="form.said" class="said" :class="{ bad: form.failed }" role="status">{{ form.said }}</p>
          <p v-else-if="isNew" class="hint">{{ t('sources.notYet') }}</p>
          <p v-else-if="dirty" class="hint">{{ t('sources.unsaved') }}</p>
          <div class="actions">
            <button type="button" class="primary" :disabled="form.busy || !dirty" @click="save">{{ form.busy ? t('sources.starting') : isNew ? t('sources.create') : t('sources.save') }}</button>
            <button v-if="!isNew" type="button" :disabled="form.busy || dirty" @click="restart">{{ t('sources.restart') }}</button>
            <span class="spacer" />
            <template v-if="form.sure">
              <span>{{ t('sources.removeSure', { name: current.id }) }}</span>
              <button type="button" class="danger" :disabled="form.busy" @click="remove">{{ t('sources.removeYes') }}</button>
              <button type="button" @click="form.sure = false">{{ t('sources.cancel') }}</button>
            </template>
            <button v-else type="button" @click="form.sure = true">{{ t('sources.remove') }}</button>
          </div>
          <p class="hint small">{{ t('sources.runningNote') }}</p>
        </template>
      </main>
    </div>
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
.sources {
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
.work {
  flex: 1;
  min-height: 0;
  display: flex;
}
.list {
  flex: none;
  width: 320px;
  box-sizing: border-box;
  padding: 12px;
  overflow-y: auto;
  background: var(--card);
  border-right: 1px solid var(--line);
}
.detail {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 16px 20px 40px;
  overflow-y: auto;
}
.detail > * {
  max-width: 640px;
}
button,
select,
input,
textarea {
  font: inherit;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 10px;
}
button {
  min-height: 40px;
  font-size: 16px;
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
.entry {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
  text-align: left;
}
.entry.chosen {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.dot {
  flex: none;
  width: 12px;
  height: 12px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--none);
}
.dot.running {
  background: var(--ok);
}
.dot.failed {
  background: var(--alarm);
}
.names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
small,
.hint {
  color: var(--mute);
}
small {
  font-size: 13px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.hint.small {
  font-size: 13px;
}
.bad {
  color: var(--alarm);
}
.adding {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.adding label,
.secret label,
.other label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mute);
  font-size: 14px;
}
h1 {
  margin: 0 0 4px;
  font-size: 24px;
}
h1 small {
  font-size: 15px;
  font-weight: 400;
}
h2 {
  margin: 0 0 8px;
  font-size: 16px;
}
section {
  margin: 16px 0;
  padding: 12px 14px 14px;
  border-radius: 8px;
  background: var(--card);
}
.secret {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.secret em {
  font-style: normal;
  margin-left: 6px;
  color: var(--mute);
}
.secret em.stored {
  color: var(--ok);
}
.secret .check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.other {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.other input {
  min-width: 0;
}
.advanced {
  margin-top: 12px;
}
.advanced summary {
  cursor: pointer;
  color: var(--mute);
  padding: 6px 0;
}
textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: 13px/1.4 ui-monospace, Consolas, monospace;
}
.help {
  margin: 16px 0;
  padding: 10px 14px;
  border-radius: 8px;
  border-left: 4px solid var(--accent);
  background: var(--card);
}
.help summary {
  cursor: pointer;
  font-weight: 600;
}
.help p {
  margin: 8px 0 0;
  overflow-wrap: anywhere;
}
.notes {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
}
.notes li {
  padding: 3px 0;
  overflow-wrap: anywhere;
}
.notes time {
  color: var(--mute);
  margin-right: 6px;
}
.notes .warn,
.notes .error {
  color: var(--alarm);
}
h2 small {
  margin-left: 8px;
  font-weight: 400;
}
.said {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--card);
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* Schmal: die Liste über den Einstellungen */
@media (max-width: 800px) {
  .work {
    flex-direction: column;
    overflow-y: auto;
  }
  .list {
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    overflow: visible;
  }
  .detail {
    overflow: visible;
  }
}
</style>
