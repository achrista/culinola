<script setup lang="ts">
import type { DatapointValue } from '@culinola/sdk';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { isOn } from '../state.ts';
import { datapoints } from '../store.ts';

interface Person {
  datapoint: string;
  label?: string;
}

/**
 * Wer zu Hause ist: je Person ein Feld mit Namen und „daheim“ oder „weg“.
 * Die Anwesenheit selbst stellt die Quelle fest – ein Schalter, ein Text oder eine Zahl.
 */
const props = defineProps<{
  config: {
    items: Person[];
    /** Texte, die „daheim“ bedeuten, wenn die Quelle keinen Schalter liefert. */
    home?: string[];
  };
}>();

const { t } = useI18n();
const HOME = ['home', 'daheim', 'zuhause', 'zu hause', 'anwesend', 'present', 'on', 'da'];

/** Ob jemand da ist – oder unbekannt, solange die Quelle nichts meldet. */
function stateOf(value: DatapointValue | undefined): 'home' | 'away' | 'unknown' {
  if (value === undefined || value === null) return 'unknown';
  if (typeof value === 'string') return (props.config.home ?? HOME).some((word) => word.toLowerCase() === value.trim().toLowerCase()) ? 'home' : 'away';
  return isOn(value) ? 'home' : 'away';
}
const people = computed(() =>
  (props.config.items ?? []).map((person) => {
    const datapoint = datapoints.get(person.datapoint);
    return { id: person.datapoint, name: person.label ?? datapoint?.label ?? person.datapoint, state: stateOf(datapoint?.value) };
  }),
);
</script>

<template>
  <section class="presence">
    <!-- Die innere Hülle trägt die Aufteilung, damit sie sich nach der Größe der Kachel richten kann -->
    <div class="people" :style="{ '--count': people.length, '--half': Math.ceil(people.length / 2) }">
      <div v-for="person in people" :key="person.id" class="person" :class="person.state">
        <strong>{{ person.name }}</strong>
        <span>{{ t(`presence.${person.state}`) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.presence {
  container-type: size;
  min-width: 0;
  min-height: 0;
}
.people {
  height: 100%;
  display: grid;
  /* Flache Kachel: alle nebeneinander. Hohe Kachel: zwei Reihen, damit die Felder ungefähr quadratisch bleiben. */
  grid-template-columns: repeat(var(--count), minmax(0, 1fr));
  gap: var(--gap);
}
@container (min-height: 120px) and (max-aspect-ratio: 22 / 10) {
  .people {
    grid-template-columns: repeat(var(--half), minmax(0, 1fr));
  }
}
.person {
  min-width: 0;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  line-height: 1.2;
  /* Ein Streifen in der Farbe des Zustands statt einer grellen Fläche */
  border-bottom: 5px solid var(--none);
}
.person strong {
  max-width: 100%;
  font-size: clamp(15px, 26cqh, 24px);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.person span {
  font-size: clamp(13px, 18cqh, 17px);
  color: var(--mute);
}
.home {
  background: color-mix(in srgb, var(--ok) 16%, var(--card));
  border-bottom-color: var(--ok);
}
.home span {
  color: var(--ok);
  font-weight: 600;
}
.away {
  border-bottom-color: var(--alarm);
}
.away strong {
  color: var(--mute);
}
.unknown {
  opacity: 0.6;
}
</style>
