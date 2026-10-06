import type { Component } from 'vue';
import ChartCard from './ChartCard.vue';
import ClockCard from './ClockCard.vue';
import MediaWindow from './MediaWindow.vue';
import NewsCard from './NewsCard.vue';
import NoteCard from './NoteCard.vue';
import RadioBar from './RadioBar.vue';
import RecipeCard from './RecipeCard.vue';
import SwitchField from './SwitchField.vue';
import ValueTile from './ValueTile.vue';
import VideoTile from './VideoTile.vue';
import WeatherCard from './WeatherCard.vue';

/** Zuordnung vom Typnamen im Layout zum Widget. */
export const widgets: Record<string, Component> = {
  'value-tile': ValueTile,
  switches: SwitchField,
  chart: ChartCard,
  clock: ClockCard,
  note: NoteCard,
  news: NewsCard,
  radio: RadioBar,
  recipes: RecipeCard,
  video: VideoTile,
  weather: WeatherCard,
  'media-window': MediaWindow,
};
