<script setup lang="ts">
import { MAX_GRID, type Place } from '@culinola/sdk';
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { AccessDenied, ApiError, deleteJson, getJson, postJson, putJson } from '../api.ts';
import { astroSource, nightTheme } from '../i18n.ts';
import { type Layout, type LoadedLayout, type Widget, datapointsOf } from '../layout.ts';
import LayoutGrid from '../LayoutGrid.vue';
import { connect, onLayoutChanged, subscribe } from '../store.ts';
import { GROUPS, type Source, catalog, initialConfig, minimumOf, sizeIn, sourceFor } from '../widgets/catalog.ts';
import { settings as settingsOf } from '../widgets/settings.ts';
import SettingsForm from './SettingsForm.vue';
import { HANDLES, type Handle, History, firstFree, isFree, moved, regrid, resized, samePlace, stageSize } from './geometry.ts';

const props = defineProps<{ name: string }>();
const { t, locale } = useI18n();

/** Der Stand im Kern und die Kennung, auf der der Entwurf aufbaut. */
const saved = ref<Layout>();
const base = ref('');
/** Der Entwurf: Was gezeigt und beim Speichern geschickt wird. Angaben, die der Editor nicht kennt, bleiben darin stehen. */
const draft = ref<Layout>();
const selected = ref<number>();
const history = reactive(new History<string>());
const names = ref<string[]>([]);
/** Die eingerichteten Quellen – danach richtet sich, welche Kacheln sich hinzufügen lassen. */
const sources = ref<Source[]>([]);

const problem = ref('');
const denied = ref(false);
const forbidden = ref(false);
/** Der Kern hat inzwischen einen anderen Stand als den, auf dem der Entwurf aufbaut. */
const stale = ref(false);
const saving = ref(false);
const notice = ref('');

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(saved.value));

// Der Entwurf liegt im Browser und übersteht ein Neuladen; gespeichert wird nur ausdrücklich
const DRAFT_KEY = `culinola.entwurf.${props.name}`;
function keepDraft(): void {
  try {
    if (dirty.value) localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: base.value, layout: draft.value }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ohne Speicher gibt es den Entwurf nur, solange die Seite offen ist
  }
}
function keptDraft(): { base: string; layout: Layout } | undefined {
  try {
    const kept = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as { base?: unknown; layout?: Layout } | null;
    return kept && typeof kept.base === 'string' && Array.isArray(kept.layout?.widgets) && kept.layout.grid ? { base: kept.base, layout: kept.layout } : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLayout(): Promise<{ layout: Layout; rev: string }> {
  const { rev, ...layout } = await getJson<LoadedLayout>(`/layouts/${encodeURIComponent(props.name)}`);
  return { layout, rev: rev ?? '' };
}

function follow(layout: Layout): void {
  const ids = datapointsOf(layout);
  if (nightTheme.value) ids.add(`${astroSource.value}:night`);
  subscribe([...ids], props.name);
}

/** Übernimmt den Stand des Kerns; ein Entwurf geht dabei verloren. */
function adopt(loaded: { layout: Layout; rev: string }): void {
  saved.value = loaded.layout;
  base.value = loaded.rev;
  draft.value = clone(loaded.layout);
  history.clear();
  selected.value = undefined;
  stale.value = false;
  keepDraft();
  follow(loaded.layout);
}

let stopListening: (() => void) | undefined;
onMounted(async () => {
  try {
    const access = await getJson<{ role?: string }>('/access');
    if (access.role !== 'admin') {
      forbidden.value = true;
      return;
    }
    const loaded = await fetchLayout();
    const kept = keptDraft();
    adopt(loaded);
    if (kept) {
      draft.value = kept.layout;
      // Der Entwurf stammt von einem älteren Stand: Wer weitermacht, entscheidet, was gilt
      stale.value = dirty.value && kept.base !== loaded.rev;
      keepDraft();
    }
    connect();
    stopListening = onLayoutChanged(() => void refresh());
    names.value = (await getJson<{ id: string }[]>('/layouts')).map((entry) => entry.id);
    sources.value = (await getJson<{ sources: (Source & { state: string })[] }>('/status')).sources.filter((source) => source.state === 'running');
  } catch (cause) {
    denied.value = cause instanceof AccessDenied;
    problem.value = cause instanceof Error ? cause.message : String(cause);
  }
});
onUnmounted(() => stopListening?.());

/** Der Kern meldet eine Änderung: ohne eigenen Entwurf übernehmen, sonst nachfragen. */
async function refresh(): Promise<void> {
  if (saving.value) return;
  try {
    const loaded = await fetchLayout();
    if (loaded.rev === base.value) return;
    if (dirty.value) stale.value = true;
    else adopt(loaded);
  } catch {
    // Ist der Kern gerade nicht erreichbar, zeigt sich das beim Speichern
  }
}

/** Jede Änderung am Entwurf läuft hier durch – so lässt sie sich zurücknehmen. */
function change(apply: (layout: Layout) => void): void {
  if (!draft.value) return;
  history.record(JSON.stringify(draft.value));
  apply(draft.value);
  notice.value = '';
  keepDraft();
  // Neue oder anders eingestellte Kacheln brauchen womöglich andere Datenpunkte
  follow(draft.value);
}

function restore(state: string | undefined): void {
  if (state === undefined) return;
  draft.value = JSON.parse(state) as Layout;
  if (selected.value !== undefined && selected.value >= draft.value.widgets.length) selected.value = undefined;
  keepDraft();
  follow(draft.value);
}
const undo = () => restore(history.undo(JSON.stringify(draft.value)));
const redo = () => restore(history.redo(JSON.stringify(draft.value)));

function discard(): void {
  if (!saved.value || !dirty.value) return;
  const before = clone(saved.value);
  // Auch das Verwerfen ist ein Schritt, der sich zurücknehmen lässt
  history.record(JSON.stringify(draft.value));
  draft.value = before;
  selected.value = undefined;
  keepDraft();
}

async function save(force = false): Promise<void> {
  if (!draft.value || saving.value) return;
  saving.value = true;
  problem.value = '';
  try {
    const sent = clone(draft.value);
    const result = await putJson<{ rev: string }>(`/layouts/${encodeURIComponent(props.name)}`, force ? { layout: sent, force: true } : { layout: sent, rev: base.value });
    saved.value = sent;
    base.value = result.rev;
    stale.value = false;
    history.clear();
    keepDraft();
    notice.value = t('editor.saved');
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409 && typeof cause.body['rev'] === 'string') stale.value = true;
    else problem.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}

async function reload(): Promise<void> {
  try {
    adopt(await fetchLayout());
  } catch (cause) {
    problem.value = cause instanceof Error ? cause.message : String(cause);
  }
}

// ── Ziehen ───────────────────────────────────────────────────────────────────────────────────────────────

interface Drag {
  index: number;
  /** Verschieben oder der Griff, an dem gezogen wird. */
  kind: 'move' | Handle;
  startX: number;
  startY: number;
  /** Breite und Höhe einer Rastereinheit auf dem Bildschirm. */
  pitch: [number, number];
  origin: Place;
  target: Place;
  free: boolean;
}
const drag = ref<Drag>();
const overlay = ref<HTMLElement>();

/** Was die Bühne zeigt: den Entwurf – und während des Ziehens die Kachel schon am Ziel, solange es frei ist. */
const shown = computed<Layout | undefined>(() => {
  const layout = draft.value;
  const active = drag.value;
  if (!layout || !active?.free) return layout;
  return { ...layout, widgets: layout.widgets.map((widget, index) => (index === active.index ? { ...widget, at: active.target } : widget)) };
});

function pitch(): [number, number] {
  const element = overlay.value!;
  const grid = draft.value!.grid;
  const box = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const scale = box.width / element.offsetWidth;
  const padding = parseFloat(style.paddingLeft) || 0;
  const gap = parseFloat(style.columnGap) || 0;
  return [((element.offsetWidth - 2 * padding + gap) / grid.columns) * scale, ((element.offsetHeight - 2 * padding + gap) / grid.rows) * scale];
}

function startDrag(index: number, event: PointerEvent): void {
  selected.value = index;
  if (event.button !== 0 || !draft.value) return;
  const handle = (event.target as HTMLElement).dataset['handle'] as Handle | undefined;
  const origin = [...draft.value.widgets[index]!.at] as Place;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag.value = { index, kind: handle ?? 'move', startX: event.clientX, startY: event.clientY, pitch: pitch(), origin, target: origin, free: true };
  event.preventDefault();
}

function moveDrag(event: PointerEvent): void {
  const active = drag.value;
  if (!active || !draft.value) return;
  const dx = Math.round((event.clientX - active.startX) / active.pitch[0]);
  const dy = Math.round((event.clientY - active.startY) / active.pitch[1]);
  const grid = draft.value.grid;
  // Kleiner als ihre kleinste sinnvolle Größe lässt sich eine Kachel nicht ziehen
  active.target = active.kind === 'move' ? moved(active.origin, dx, dy, grid) : resized(active.origin, active.kind, dx, dy, grid, minimumOf(draft.value.widgets[active.index]!.type, grid));
  active.free = isFree(draft.value.widgets, active.index, active.target, grid);
}

function endDrag(): void {
  const active = drag.value;
  drag.value = undefined;
  if (!active) return;
  // Auf einer anderen Kachel losgelassen: Die Kachel springt zurück
  if (!active.free) notice.value = t('editor.occupied');
  else if (!samePlace(active.origin, active.target)) change((layout) => void (layout.widgets[active.index]!.at = active.target));
}

/** Setzt die gewählte Kachel an einen neuen Platz, wenn er frei ist – für Tastatur und Zahlenfelder. */
function placeSelected(at: Place): boolean {
  const index = selected.value;
  const layout = draft.value;
  if (index === undefined || !layout) return false;
  const current = layout.widgets[index]!.at;
  if (samePlace(current, at)) return true;
  if (!isFree(layout.widgets, index, at, layout.grid)) {
    notice.value = t('editor.occupied');
    return false;
  }
  change((changing) => void (changing.widgets[index]!.at = at));
  return true;
}

function remove(): void {
  const index = selected.value;
  if (index === undefined) return;
  change((layout) => void layout.widgets.splice(index, 1));
  selected.value = undefined;
}

const current = computed(() => (selected.value === undefined ? undefined : draft.value?.widgets[selected.value]));
const nameOf = (type: string) => (catalog[type] ? t(`catalog.${type}.name`) : type);

/** Die Kachelarten zum Hinzufügen, nach Gruppen – mit dem Hinweis, welche Quelle einer fehlt. */
const offered = computed(() =>
  GROUPS.map((group) => ({
    group,
    entries: Object.entries(catalog)
      .filter(([, info]) => info.group === group)
      .map(([type, info]) => ({ type, icon: info.icon, needed: sourceFor(type, sources.value).needed })),
  })),
);

/** Legt eine Kachel auf die erste freie Stelle und wählt sie; passt sie nirgends hin, sagt der Editor das. */
function insert(widget: Omit<Widget, 'at'>, sizes: readonly (readonly [number, number])[]): void {
  const layout = draft.value;
  if (!layout) return;
  const at = sizes.map((size) => firstFree(layout.widgets, size, layout.grid)).find((place) => place);
  if (!at) {
    notice.value = t('editor.noRoom', { name: nameOf(widget.type) });
    return;
  }
  change((changing) => void changing.widgets.push({ ...widget, at }));
  selected.value = layout.widgets.length - 1;
}

function add(type: string): void {
  const layout = draft.value;
  const info = catalog[type];
  if (!layout || !info) return;
  const config = initialConfig(type, sources.value);
  // In ihrer üblichen Größe – und wenn dafür kein Platz ist, in ihrer kleinsten
  insert({ type, ...(config ? { config } : {}) }, [sizeIn(info.size, layout.grid), sizeIn(info.min, layout.grid)]);
}

/** Verdoppelt die gewählte Kachel samt Einstellungen – und allem, was der Editor an ihr nicht kennt. */
function copy(): void {
  const widget = current.value;
  if (!widget) return;
  const { at, ...rest } = clone(widget);
  insert(rest, [[at[2], at[3]]]);
}

// Einstellungen als JSON – bis jede Einstellung ihr Formularfeld hat, und für alles, was nie eines bekommt
const settings = ref('');
const settingsProblem = ref('');
watch(
  () => [selected.value, JSON.stringify(current.value?.config ?? {})],
  () => {
    settings.value = current.value ? JSON.stringify(current.value.config ?? {}, null, 2) : '';
    settingsProblem.value = '';
  },
  { immediate: true },
);

/** Die Einstellungen der gewählten Kachel als Objekt – für das Formular. */
const currentConfig = computed<Record<string, unknown>>(() => {
  const config = current.value?.config;
  return config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
});

/** Übernimmt, was das Formular geändert hat; eine Kachel ohne Angaben trägt gar keine Einstellungen. */
function setConfig(config: Record<string, unknown>): void {
  const index = selected.value;
  if (index === undefined || JSON.stringify(config) === JSON.stringify(currentConfig.value)) return;
  change((layout) => {
    if (Object.keys(config).length) layout.widgets[index]!.config = config;
    else delete layout.widgets[index]!.config;
  });
}

function applySettings(): void {
  const index = selected.value;
  if (index === undefined) return;
  let config: unknown;
  try {
    config = JSON.parse(settings.value);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('{ … }');
  } catch (cause) {
    settingsProblem.value = t('editor.badJson', { error: cause instanceof Error ? cause.message : String(cause) });
    return;
  }
  settingsProblem.value = '';
  setConfig(config as Record<string, unknown>);
}
const FIELDS = ['x', 'y', 'w', 'h'] as const;

function setField(position: number, event: Event): void {
  const input = event.target as HTMLInputElement;
  const at = [...current.value!.at] as Place;
  at[position] = Math.round(Number(input.value));
  // Was nicht passt, wird nicht übernommen – das Feld zeigt wieder den geltenden Wert
  if (!Number.isFinite(at[position]) || !placeSelected(at)) input.value = String(current.value!.at[position]);
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (command && key === 'z') (event.shiftKey ? redo : undo)();
  else if (command && key === 'y') redo();
  else if (command && key === 's') void save();
  else if (event.key === 'Escape') selected.value = undefined;
  else if (current.value && (event.key === 'Delete' || event.key === 'Backspace')) remove();
  else if (current.value && event.key.startsWith('Arrow')) {
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const grid = draft.value!.grid;
    // Mit Umschalttaste ändern die Pfeile die Größe: Die rechte untere Ecke wandert
    placeSelected(event.shiftKey ? resized(current.value.at, 'se', dx, dy, grid, minimumOf(current.value.type, grid)) : moved(current.value.at, dx, dy, grid));
  } else return;
  event.preventDefault();
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

// ── Layouts verwalten ────────────────────────────────────────────────────────────────────────────────────

interface TemplateInfo {
  id: string;
  name: Record<string, string>;
  text: Record<string, string>;
}
const manageOpen = ref(false);
const templates = ref<TemplateInfo[]>([]);
const manage = reactive({ name: '', start: 'empty', rename: '', sure: false, problem: '', busy: false });
const inLanguage = (texts: Record<string, string>) => texts[locale.value] ?? texts['en'] ?? Object.values(texts)[0] ?? '';

async function openManage(): Promise<void> {
  manageOpen.value = !manageOpen.value;
  if (!manageOpen.value) return;
  formatOpen.value = false;
  Object.assign(manage, { name: '', start: 'empty', rename: props.name, sure: false, problem: '' });
  try {
    templates.value = await getJson<TemplateInfo[]>('/templates');
  } catch {
    // Ohne Vorlagen bleiben „leer“ und „Kopie“
  }
}

/** Ruft den Kern und zeigt, was er beanstandet – etwa einen Namen, den es schon gibt. */
async function managing(call: () => Promise<unknown>, then: () => void): Promise<void> {
  if (manage.busy) return;
  manage.busy = true;
  manage.problem = '';
  try {
    await call();
    then();
  } catch (cause) {
    manage.problem = cause instanceof Error ? cause.message : String(cause);
  } finally {
    manage.busy = false;
  }
}

function createLayout(): void {
  const id = manage.name.trim();
  // Die Kopie nimmt, was hier steht – auch den ungespeicherten Entwurf
  const start = manage.start === 'copy' ? { layout: clone(draft.value) } : manage.start === 'empty' ? {} : { template: manage.start.slice('template:'.length) };
  void managing(
    () => postJson('/layouts', { id, ...start }),
    () => go((query) => query.set('layout', id)),
  );
}

function renameLayout(): void {
  const id = manage.rename.trim();
  if (id === props.name) return;
  void managing(
    () => postJson(`/layouts/${encodeURIComponent(props.name)}/rename`, { id }),
    () => go((query) => query.set('layout', id)),
  );
}

function deleteLayout(): void {
  void managing(
    () => deleteJson(`/layouts/${encodeURIComponent(props.name)}`),
    () => {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Ohne Speicher gab es auch keinen Entwurf
      }
      go((query) => query.set('layout', names.value.find((entry) => entry !== props.name) ?? 'main'));
    },
  );
}

// ── Raster und Format ────────────────────────────────────────────────────────────────────────────────────

const formatOpen = ref(false);
const format = reactive({ columns: 0, rows: 0, rescale: true, width: 0, height: 0 });
const formatProblem = ref('');

function openFormat(): void {
  formatOpen.value = !formatOpen.value;
  if (!formatOpen.value || !draft.value) return;
  manageOpen.value = false;
  const [width, height] = draft.value.screen ?? [16, 9];
  Object.assign(format, { ...draft.value.grid, rescale: true, width, height });
  formatProblem.value = '';
}

function applyFormat(): void {
  const layout = draft.value;
  if (!layout) return;
  const grid = { columns: Number(format.columns), rows: Number(format.rows) };
  const count = (value: number) => Number.isInteger(value) && value >= 1 && value <= MAX_GRID;
  if (!count(grid.columns) || !count(grid.rows)) return void (formatProblem.value = t('editor.gridRange', { max: MAX_GRID }));
  const screen: [number, number] = [Number(format.width), Number(format.height)];
  if (!screen.every((side) => Number.isFinite(side) && side > 0)) return void (formatProblem.value = t('editor.screenRange'));

  const places = layout.widgets.map((widget) => widget.at);
  const sameGrid = grid.columns === layout.grid.columns && grid.rows === layout.grid.rows;
  // Ohne Umrechnen bleiben die Kacheln stehen; dann müssen sie nur noch ins neue Raster passen
  const next = sameGrid || !format.rescale ? { places, exact: true, valid: places.every((at) => isFree([], -1, at, grid)) } : regrid(places, layout.grid, grid);
  if (!next.valid) return void (formatProblem.value = t('editor.gridCollides', grid));
  formatProblem.value = '';
  const sameScreen = JSON.stringify(layout.screen ?? [16, 9]) === JSON.stringify(screen);
  if (sameGrid && sameScreen) return void (formatOpen.value = false);
  change((changing) => {
    changing.grid = grid;
    changing.widgets.forEach((widget, index) => (widget.at = next.places[index]!));
    if (!sameScreen) changing.screen = screen;
  });
  formatOpen.value = false;
  if (!next.exact) notice.value = t('editor.gridRounded');
}

// ── Bühne ────────────────────────────────────────────────────────────────────────────────────────────────

const area = ref<HTMLElement>();
const room = ref<[number, number]>([0, 0]);
const size = computed(() => stageSize(draft.value?.screen));
/** Maßstab, in dem der Zielbildschirm in den freien Platz passt. */
const scale = computed(() => {
  const [width, height] = size.value;
  const fit = Math.min(room.value[0] / width, room.value[1] / height);
  return fit > 0 ? Math.min(fit, 1) : 0.5;
});
let watcher: ResizeObserver | undefined;
watch(area, (element) => {
  watcher?.disconnect();
  if (!element) return;
  watcher = new ResizeObserver(() => (room.value = [element.clientWidth - 32, element.clientHeight - 32]));
  watcher.observe(element);
});
onUnmounted(() => watcher?.disconnect());

const place = (at: Place) => ({ gridColumn: `${at[0] + 1} / span ${at[2]}`, gridRow: `${at[1] + 1} / span ${at[3]}` });

/** Dieselbe Seite mit anderem Layout oder ohne Bearbeiten; Farbschema und andere Zusätze bleiben. */
function go(change: (query: URLSearchParams) => void): void {
  const query = new URLSearchParams(location.search);
  change(query);
  location.search = query.toString().replace(/(^|&)edit=(?=&|$)/, '$1edit');
}
</script>

<template>
  <p v-if="forbidden" class="notice">{{ t('editor.needsAdmin') }}</p>
  <p v-else-if="denied" class="notice">{{ t('app.notUnlocked', { error: problem }) }}</p>
  <p v-else-if="!draft && problem" class="notice">{{ t('app.layoutFailed', { error: problem }) }}</p>
  <div v-else-if="draft && shown" class="editor">
    <header class="bar">
      <label class="pick">
        {{ t('editor.layout') }}
        <select :value="name" @change="go((query) => query.set('layout', ($event.target as HTMLSelectElement).value))">
          <option v-for="entry in names.length ? names : [name]" :key="entry" :value="entry">{{ entry }}</option>
        </select>
      </label>
      <button type="button" class="plain" :aria-expanded="manageOpen" @click="openManage">{{ t('editor.manage') }} ▾</button>
      <button type="button" class="plain" :aria-expanded="formatOpen" :title="t('editor.format')" @click="openFormat">
        {{ t('editor.grid', { columns: draft.grid.columns, rows: draft.grid.rows }) }} · {{ size[0] }} × {{ size[1] }} ▾
      </button>
      <span class="spacer" />
      <button type="button" class="tool" :disabled="!history.past.length" :title="t('editor.undo')" :aria-label="t('editor.undo')" @click="undo">↶</button>
      <button type="button" class="tool" :disabled="!history.future.length" :title="t('editor.redo')" :aria-label="t('editor.redo')" @click="redo">↷</button>
      <button type="button" class="plain" :disabled="!dirty" @click="discard">{{ t('editor.discard') }}</button>
      <button type="button" class="primary" :disabled="!dirty || saving || stale" @click="save()">{{ t('editor.save') }}</button>
      <button type="button" class="plain" @click="go((query) => query.set('edit', 'sources'))">{{ t('editor.sources') }}</button>
      <button type="button" class="plain" @click="go((query) => query.set('edit', 'settings'))">{{ t('system.title') }}</button>
      <button type="button" class="plain" @click="go((query) => query.delete('edit'))">{{ t('editor.close') }}</button>
    </header>

    <div v-if="manageOpen" class="format">
      <form @submit.prevent="createLayout">
        <fieldset :disabled="manage.busy">
          <legend>{{ t('editor.newLayout') }}</legend>
          <label :title="t('editor.nameHint')">{{ t('editor.newName') }} <input v-model="manage.name" type="text" required maxlength="40" pattern="[a-z][a-z0-9\-]*" spellcheck="false" autocapitalize="off" /></label>
          <label>
            {{ t('editor.startFrom') }}
            <select v-model="manage.start">
              <option value="empty">{{ t('editor.startEmpty') }}</option>
              <option value="copy">{{ t('editor.startCopy', { name }) }}</option>
              <option v-for="template in templates" :key="template.id" :value="`template:${template.id}`" :title="inLanguage(template.text)">{{ t('editor.startTemplate', { name: inLanguage(template.name) }) }}</option>
            </select>
          </label>
          <button type="submit" class="primary">{{ t('editor.create') }}</button>
        </fieldset>
      </form>
      <form @submit.prevent="renameLayout">
        <fieldset :disabled="manage.busy">
          <legend>{{ t('editor.thisLayout') }}</legend>
          <label :title="t('editor.nameHint')">{{ t('editor.newName') }} <input v-model="manage.rename" type="text" required maxlength="40" pattern="[a-z][a-z0-9\-]*" spellcheck="false" autocapitalize="off" :disabled="dirty" /></label>
          <button type="submit" class="plain" :disabled="dirty || manage.rename.trim() === name">{{ t('editor.rename') }}</button>
          <template v-if="manage.sure">
            <span>{{ t('editor.deleteSure', { name }) }}</span>
            <button type="button" class="danger" @click="deleteLayout">{{ t('editor.deleteYes') }}</button>
            <button type="button" class="plain" @click="manage.sure = false">{{ t('editor.cancel') }}</button>
          </template>
          <button v-else type="button" class="plain" :disabled="names.length < 2" :title="names.length < 2 ? t('editor.lastLayout') : ''" @click="manage.sure = true">{{ t('editor.delete') }}</button>
        </fieldset>
      </form>
      <p class="explain">{{ t('editor.nameHint') }} {{ dirty ? t('editor.saveFirst') : t('editor.renameWarn', { name }) }}</p>
      <p v-if="manage.problem" class="explain bad" role="alert">{{ manage.problem }}</p>
    </div>

    <form v-if="formatOpen" class="format" @submit.prevent="applyFormat">
      <fieldset>
        <legend>{{ t('editor.format') }}</legend>
        <label>{{ t('editor.columns') }} <input v-model.number="format.columns" type="number" inputmode="numeric" min="1" :max="MAX_GRID" /></label>
        <label>{{ t('editor.rows') }} <input v-model.number="format.rows" type="number" inputmode="numeric" min="1" :max="MAX_GRID" /></label>
        <label class="check" :title="t('editor.rescaleHint')"><input v-model="format.rescale" type="checkbox" /> {{ t('editor.rescale') }}</label>
      </fieldset>
      <fieldset :title="t('editor.screenHint')">
        <legend>{{ t('editor.screen') }}</legend>
        <label>{{ t('editor.screenWidth') }} <input v-model.number="format.width" type="number" inputmode="decimal" min="1" step="any" /></label>
        <label>{{ t('editor.screenHeight') }} <input v-model.number="format.height" type="number" inputmode="decimal" min="1" step="any" /></label>
      </fieldset>
      <button type="submit" class="primary">{{ t('editor.apply') }}</button>
      <p class="explain">{{ t('editor.rescaleHint') }} {{ t('editor.screenHint') }}</p>
      <p v-if="formatProblem" class="explain bad" role="alert">{{ formatProblem }}</p>
    </form>

    <div v-if="stale" class="banner" role="alert">
      <span>{{ t('editor.stale') }}</span>
      <button type="button" class="plain" @click="reload">{{ t('editor.takeTheirs') }}</button>
      <button type="button" class="plain" :disabled="saving" @click="save(true)">{{ t('editor.keepMine') }}</button>
    </div>
    <div v-else-if="problem" class="banner" role="alert">
      <span>{{ t('editor.saveFailed', { error: problem }) }}</span>
    </div>

    <div class="work">
      <div ref="area" class="area" @pointerdown.self="selected = undefined">
        <div class="frame" :style="{ width: `${size[0] * scale}px`, height: `${size[1] * scale}px` }">
          <div class="stage" :style="{ width: `${size[0]}px`, height: `${size[1]}px`, transform: `scale(${scale})`, '--k': scale, '--columns': draft.grid.columns, '--rows': draft.grid.rows }">
            <!-- Die echten Kacheln mit echten Werten; bedienen lassen sie sich hier nicht -->
            <LayoutGrid :layout="shown" inert />
            <div class="raster" />
            <div
              ref="overlay"
              class="overlay"
              :style="{ gridTemplateColumns: `repeat(${draft.grid.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${draft.grid.rows}, minmax(0, 1fr))` }"
              @pointerdown.self="selected = undefined"
            >
              <div
                v-for="(widget, index) in shown.widgets"
                :key="index"
                class="grab"
                :class="{ selected: index === selected, dragging: drag?.index === index }"
                :style="place(widget.at)"
                :title="nameOf(widget.type)"
                @pointerdown="startDrag(index, $event)"
                @pointermove="moveDrag"
                @pointerup="endDrag"
                @pointercancel="drag = undefined"
              >
                <template v-if="index === selected">
                  <span v-for="handle in HANDLES" :key="handle" class="handle" :class="handle" :data-handle="handle" />
                </template>
              </div>
              <div v-if="drag && !drag.free" class="ghost" :style="place(drag.target)" />
            </div>
          </div>
        </div>
      </div>

      <aside class="panel">
        <p v-if="notice" class="hint said" role="status">{{ notice }}</p>
        <template v-if="current">
          <h2>{{ nameOf(current.type) }}</h2>
          <p v-if="!catalog[current.type]" class="hint">{{ t('editor.unknownType') }}</p>
          <template v-if="catalog[current.type]">
            <h3>{{ t('editor.settings') }}</h3>
            <SettingsForm v-if="settingsOf[current.type]?.length" :key="selected ?? -1" :type="current.type" :fields="settingsOf[current.type]!" :value="currentConfig" :sources="sources" @update="setConfig" />
            <p v-else class="hint">{{ t('form.none') }}</p>
          </template>
          <h3>{{ t('editor.place') }}</h3>
          <div class="fields">
            <label v-for="(field, position) in FIELDS" :key="field">
              {{ t(`editor.at.${field}`) }}
              <input type="number" inputmode="numeric" :min="position < 2 ? 0 : 1" :value="current.at[position]" @change="setField(position, $event)" />
            </label>
          </div>
          <div class="actions">
            <button type="button" class="plain" @click="copy">{{ t('editor.copy') }}</button>
            <button type="button" class="plain" @click="remove">{{ t('editor.remove') }}</button>
          </div>
          <details class="advanced">
            <summary>{{ t('editor.advanced') }}</summary>
            <textarea v-model="settings" rows="10" spellcheck="false" autocapitalize="off" />
            <p v-if="settingsProblem" class="hint bad" role="alert">{{ settingsProblem }}</p>
            <button type="button" class="plain" @click="applySettings">{{ t('editor.apply') }}</button>
          </details>
        </template>
        <p v-else class="hint">{{ t('editor.hint') }}</p>
        <p v-if="dirty" class="hint">{{ t('editor.unsaved') }}</p>

        <h2 class="adding">{{ t('editor.add') }}</h2>
        <section v-for="entry in offered" :key="entry.group">
          <h3>{{ t(`editor.group.${entry.group}`) }}</h3>
          <!-- Kacheln, deren Quelle nicht eingerichtet ist, stehen ausgegraut da und sagen, was ihnen fehlt -->
          <button v-for="kind in entry.entries" :key="kind.type" type="button" class="kind" :disabled="!!kind.needed" @click="add(kind.type)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="kind.icon" /></svg>
            <span>
              <strong>{{ t(`catalog.${kind.type}.name`) }}</strong>
              <small>{{ kind.needed ? t('editor.needs', { plugin: kind.needed }) : t(`catalog.${kind.type}.text`) }}</small>
            </span>
          </button>
        </section>
      </aside>
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
.editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--soft);
}
.bar,
.banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.banner {
  background: var(--warn);
  color: #1c1400;
}
.spacer {
  flex: 1;
}
.format {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 12px 10px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.format fieldset {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 0;
  padding: 4px 10px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.format legend {
  padding: 0 4px;
  color: var(--mute);
  font-size: 13px;
}
.format label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.format input[type='number'] {
  width: 84px;
}
.format input[type='text'] {
  width: 150px;
}
.danger {
  background: var(--alarm);
  border-color: var(--alarm);
  color: #ffffff;
  font-weight: 600;
}
.format input[type='checkbox'] {
  width: 20px;
  height: 20px;
}
.explain {
  flex-basis: 100%;
  margin: 0;
  color: var(--mute);
  font-size: 14px;
}
.explain.bad {
  color: var(--alarm);
}
.pick {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
select,
input {
  font: inherit;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
}
button {
  min-height: 40px;
  padding: 6px 14px;
  border-radius: 6px;
  background: var(--soft);
  border: 1px solid var(--line);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.tool {
  min-width: 44px;
  font-size: 20px;
  line-height: 1;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.banner button {
  background: rgba(255, 255, 255, 0.75);
  border-color: rgba(0, 0, 0, 0.25);
  color: #1c1400;
}

.work {
  flex: 1;
  min-height: 0;
  display: flex;
}
.area {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.frame {
  flex: none;
  box-shadow: 0 0 0 1px var(--line), 0 6px 24px rgba(0, 0, 0, 0.25);
}
.stage {
  position: relative;
  transform-origin: 0 0;
  background: var(--bg);
  overflow: hidden;
}

/* Das Raster: Linien in der Mitte der Fugen zwischen den Rastereinheiten */
.raster {
  position: absolute;
  inset: calc(16px - var(--gap) / 2);
  pointer-events: none;
  --line-width: calc(1px / var(--k));
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--ink) 22%, transparent) var(--line-width), transparent var(--line-width)),
    linear-gradient(to bottom, color-mix(in srgb, var(--ink) 22%, transparent) var(--line-width), transparent var(--line-width));
  background-size: calc(100% / var(--columns)) calc(100% / var(--rows));
  box-shadow: inset calc(-1 * var(--line-width)) calc(-1 * var(--line-width)) color-mix(in srgb, var(--ink) 22%, transparent);
}

/* Die Schicht zum Greifen liegt als gleiches Raster über den Kacheln und fängt jede Berührung ab */
.overlay {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  padding: 16px;
  display: grid;
  gap: var(--gap);
  touch-action: none;
  user-select: none;
}
.grab {
  position: relative;
  cursor: grab;
  border-radius: var(--radius);
  touch-action: none;
}
.grab:hover {
  box-shadow: inset 0 0 0 calc(2px / var(--k)) color-mix(in srgb, var(--accent) 45%, transparent);
}
.grab.selected {
  box-shadow: inset 0 0 0 calc(3px / var(--k)) var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  z-index: 1;
}
.grab.dragging {
  cursor: grabbing;
}
.ghost {
  pointer-events: none;
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--alarm) 35%, transparent);
  box-shadow: inset 0 0 0 calc(3px / var(--k)) var(--alarm);
  z-index: 2;
}

/* Griffe: großzügig für den Finger, sichtbar als kleiner Punkt in der Mitte */
.handle {
  --grip: calc(28px / var(--k));
  position: absolute;
  width: var(--grip);
  height: var(--grip);
  margin: calc(var(--grip) / -2);
  touch-action: none;
}
.handle::after {
  content: '';
  position: absolute;
  inset: 30%;
  border-radius: 50%;
  background: var(--card);
  box-shadow: 0 0 0 calc(2px / var(--k)) var(--accent);
}
.handle.n,
.handle.s {
  left: 50%;
  cursor: ns-resize;
}
.handle.e,
.handle.w {
  top: 50%;
  cursor: ew-resize;
}
.handle.n,
.handle.ne,
.handle.nw {
  top: 0;
}
.handle.s,
.handle.se,
.handle.sw {
  top: 100%;
}
.handle.w,
.handle.nw,
.handle.sw {
  left: 0;
}
.handle.e,
.handle.ne,
.handle.se {
  left: 100%;
}
.handle.ne,
.handle.sw {
  cursor: nesw-resize;
}
.handle.nw,
.handle.se {
  cursor: nwse-resize;
}

.panel {
  flex: none;
  width: 340px;
  box-sizing: border-box;
  padding: 12px;
  overflow-y: auto;
  background: var(--card);
  border-left: 1px solid var(--line);
}
.panel h2 {
  margin: 0 0 12px;
  font-size: 18px;
  overflow-wrap: anywhere;
}
.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mute);
  font-size: 14px;
}
.fields input {
  width: 100%;
  box-sizing: border-box;
}
.hint {
  color: var(--mute);
}
.hint.said {
  margin-top: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--soft);
  color: var(--ink);
}
.hint.bad {
  color: var(--alarm);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.advanced {
  margin-top: 12px;
}
.advanced summary {
  cursor: pointer;
  color: var(--mute);
  padding: 6px 0;
}
.advanced textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font: 13px/1.4 ui-monospace, Consolas, monospace;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
}
.adding {
  margin-top: 20px !important;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.panel h3 {
  margin: 14px 0 6px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mute);
}
.kind {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
  padding: 8px 10px;
  text-align: left;
}
.kind svg {
  flex: none;
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.kind span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.kind small {
  color: var(--mute);
  font-size: 13px;
  line-height: 1.25;
}

/* Schmal (Tablet hochkant, Handy): die Seitenleiste wandert unter die Bühne */
@media (max-width: 800px) {
  .work {
    flex-direction: column;
  }
  .panel {
    width: auto;
    max-height: 34%;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
