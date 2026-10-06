import type { Component } from 'vue';
import ChartCard from './ChartCard.vue';
import ClockCard from './ClockCard.vue';
import SwitchField from './SwitchField.vue';
import ValueTile from './ValueTile.vue';

/** Zuordnung vom Typnamen im Layout zum Widget. */
export const widgets: Record<string, Component> = {
  'value-tile': ValueTile,
  switches: SwitchField,
  chart: ChartCard,
  clock: ClockCard,
};
