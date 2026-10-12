<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Source } from '../widgets/catalog.ts';
import { type Field, blankEntry, datapointIn, editable, shifted, tagsOf, withDatapoint, withValue } from '../widgets/settings.ts';
import DatapointPicker from './DatapointPicker.vue';

const props = defineProps<{
  /** Die Kachelart – danach richten sich die Bezeichnungen. */
  type: string;
  fields: readonly Field[];
  /** Die Einstellungen, die das Formular zeigt. Was es nicht kennt, bleibt darin stehen. */
  value: Record<string, unknown>;
  sources: readonly Source[];
}>();
const emit = defineEmits<{ update: [value: Record<string, unknown>] }>();
const { t, te, locale } = useI18n();

/** Die Bezeichnung einer Einstellung: die der Kachelart, sonst die allgemeine, sonst ihr Name. */
const own = (texts: Record<string, string>) => texts[locale.value] ?? texts['en'] ?? Object.values(texts)[0] ?? '';
function text(field: Field): string {
  if (field.label) return own(field.label);
  const key = field.key;
  if (te(`fields.${props.type}.${key}`)) return t(`fields.${props.type}.${key}`);
  return te(`fields.common.${key}`) ? t(`fields.common.${key}`) : key;
}
function hint(field: Field): string {
  if (field.hint) return own(field.hint);
  const key = field.key;
  return te(`fields.${props.type}.${key}Hint`) ? t(`fields.${props.type}.${key}Hint`) : te(`fields.common.${key}Hint`) ? t(`fields.common.${key}Hint`) : '';
}
const option = (key: string, value: string) => (value === '' ? t('form.usual') : te(`fields.options.${key}.${value}`) ? t(`fields.options.${key}.${value}`) : value);
/** Die Vorgabe einer Auswahl steht nicht in der Konfiguration – es sei denn, das Plugin verlangt die Angabe immer. */
const chosen = (field: Extract<Field, { type: 'select' }>, value: string) => (value === '' || (value === field.options[0] && !field.explicit) ? undefined : value);

/** Ein Beispiel im leeren Feld soll nicht aussehen, als stünde dort schon ein Wert. */
const example = (value: string | number | undefined) => (value === undefined || value === '' ? '' : t('form.example', { value }));
/** Was im leeren Feld steht: die Vorgabe, die dann gilt – sonst ein Beispiel. */
const empty = (field: { placeholder?: string | number; initial?: string | number }) => (field.initial !== undefined ? t('form.default', { value: field.initial }) : example(field.placeholder));

const set = (key: string, value: unknown) => emit('update', withValue(props.value, key, value));
const typed = (event: Event) => (event.target as HTMLInputElement).value;
const number = (event: Event) => (typed(event).trim() === '' ? undefined : Number(typed(event)));

const object = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const entries = (key: string): Record<string, unknown>[] => (Array.isArray(props.value[key]) ? (props.value[key] as unknown[]).map(object) : []);
/** Eine Gruppe ohne Angaben verschwindet ganz aus der Konfiguration. */
const setGroup = (key: string, value: Record<string, unknown>) => set(key, Object.keys(value).length ? value : undefined);

function setEntry(key: string, index: number, value: Record<string, unknown>): void {
  const list = [...entries(key)];
  list[index] = value;
  set(key, list);
}
const titleOf = (entry: Record<string, unknown>, index: number) => {
  const named = [entry['label'], entry['name'], entry['datapoint'], entry['id'], entry['condition'], entry['max']].find((candidate) => typeof candidate === 'string' && candidate);
  return typeof named === 'string' ? named : t('form.entry', { number: index + 1 });
};

/** Die Instanzen des Plugins – und was gerade eingetragen ist, auch wenn es keine davon ist. */
function instances(plugin: string, current: unknown): string[] {
  const running = props.sources.filter((source) => source.plugin === plugin).map((source) => source.id);
  return typeof current === 'string' && current && !running.includes(current) ? [current, ...running] : running;
}
</script>

<template>
  <div class="form">
    <template v-for="field in fields" :key="field.key">
      <label v-if="field.type === 'text'" class="row">
        <span>{{ text(field) }}</span>
        <input type="text" :value="value[field.key] ?? ''" :placeholder="empty(field)" @change="set(field.key, typed($event))" />
        <small v-if="hint(field)">{{ hint(field) }}</small>
      </label>

      <label v-else-if="field.type === 'number'" class="row">
        <span>{{ text(field) }}</span>
        <input type="number" inputmode="decimal" :value="value[field.key] ?? ''" :min="field.min" :max="field.max" :step="field.step ?? 'any'" :placeholder="empty(field)" @change="set(field.key, number($event))" />
        <small v-if="hint(field)">{{ hint(field) }}</small>
      </label>

      <label v-else-if="field.type === 'boolean'" class="row check">
        <!-- Steht der Schalter auf dem, was ohnehin gilt, bleibt die Angabe aus der Konfiguration heraus -->
        <input
          type="checkbox"
          :checked="typeof value[field.key] === 'boolean' ? (value[field.key] as boolean) : !!field.fallback"
          @change="set(field.key, ($event.target as HTMLInputElement).checked === !!field.fallback ? undefined : ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ text(field) }}</span>
        <small v-if="hint(field)">{{ hint(field) }}</small>
      </label>

      <div v-else-if="!editable(field, value[field.key])" class="row">
        <span>{{ text(field) }}</span>
        <small>{{ t('form.jsonOnly') }}</small>
      </div>

      <label v-else-if="field.type === 'tags'" class="row">
        <span>{{ text(field) }}</span>
        <input type="text" :value="Array.isArray(value[field.key]) ? (value[field.key] as unknown[]).join(', ') : ''" @change="set(field.key, tagsOf(typed($event)))" />
        <small>{{ hint(field) || t('form.tags') }}</small>
      </label>

      <label v-else-if="field.type === 'select'" class="row">
        <span>{{ text(field) }}</span>
        <!-- Der erste Wert ist die Vorgabe und wird nicht eigens eingetragen -->
        <select :value="value[field.key] ?? field.options[0]" @change="set(field.key, chosen(field, typed($event)))">
          <option v-for="entry in field.options" :key="entry" :value="entry">{{ option(field.key, entry) }}</option>
        </select>
        <small v-if="hint(field)">{{ hint(field) }}</small>
      </label>

      <div v-else-if="field.type === 'datapoint'" class="row">
        <span>{{ text(field) }}</span>
        <DatapointPicker :model-value="datapointIn(value[field.key], field.inner)" :writable="!!field.writable" @update:model-value="set(field.key, withDatapoint(value[field.key], $event, field.inner))" />
        <small v-if="hint(field)">{{ hint(field) }}</small>
      </div>

      <label v-else-if="field.type === 'source'" class="row">
        <span>{{ text(field) }}</span>
        <select :value="value[field.key] ?? ''" @change="set(field.key, typed($event))">
          <option value="">{{ t('form.usual') }}</option>
          <option v-for="entry in instances(field.plugin, value[field.key])" :key="entry" :value="entry">{{ entry }}</option>
        </select>
        <small v-if="hint(field)">{{ hint(field) }}</small>
      </label>

      <details v-else-if="field.type === 'group'" class="group" :open="Object.keys(object(value[field.key])).length > 0">
        <summary>{{ text(field) }}</summary>
        <small v-if="hint(field)">{{ hint(field) }}</small>
        <SettingsForm :type="type" :fields="field.fields" :value="object(value[field.key])" :sources="sources" @update="setGroup(field.key, $event)" />
      </details>

      <fieldset v-else-if="field.type === 'list'" class="list">
        <legend>{{ text(field) }}</legend>
        <small v-if="hint(field)">{{ hint(field) }}</small>
        <details v-for="(entry, index) in entries(field.key)" :key="index" class="entry">
          <summary>
            <span class="what">{{ titleOf(entry, index) }}</span>
            <button type="button" :disabled="index === 0" :aria-label="t('form.up')" :title="t('form.up')" @click.prevent="set(field.key, shifted(entries(field.key), index, -1))">↑</button>
            <button type="button" :disabled="index === entries(field.key).length - 1" :aria-label="t('form.down')" :title="t('form.down')" @click.prevent="set(field.key, shifted(entries(field.key), index, 1))">↓</button>
            <button type="button" :aria-label="t('form.remove')" :title="t('form.remove')" @click.prevent="set(field.key, entries(field.key).filter((_, position) => position !== index))">✕</button>
          </summary>
          <SettingsForm :type="type" :fields="field.fields" :value="entry" :sources="sources" @update="setEntry(field.key, index, $event)" />
        </details>
        <button type="button" class="more" @click="set(field.key, [...entries(field.key), blankEntry(field.fields)])">{{ t('form.add') }}</button>
      </fieldset>
    </template>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row > span,
summary,
legend {
  color: var(--mute);
  font-size: 14px;
}
.row.check {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 2px 8px;
}
.row.check small {
  grid-column: 2;
}
.row.check input {
  width: 20px;
  height: 20px;
}
.row.check > span {
  color: var(--ink);
  font-size: inherit;
}
input[type='text'],
input[type='number'],
select {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  color: var(--ink);
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 6px 8px;
}
small {
  color: var(--mute);
  font-size: 12px;
  line-height: 1.3;
}
input::placeholder {
  color: var(--none);
  font-style: italic;
}
.group,
.list,
.entry {
  margin: 0;
  padding: 6px 8px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
summary {
  cursor: pointer;
  padding: 4px 0;
}
.group[open] > summary,
.entry[open] > summary {
  margin-bottom: 6px;
}
.entry > summary {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ink);
}
.what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button {
  min-width: 34px;
  min-height: 34px;
  border-radius: 6px;
  background: var(--soft);
  border: 1px solid var(--line);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.more {
  align-self: flex-start;
  padding: 6px 12px;
}
</style>
