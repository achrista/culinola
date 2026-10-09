import type { Component } from 'vue';
import CalendarCard from './CalendarCard.vue';
import CallCard from './CallCard.vue';
import ChartCard from './ChartCard.vue';
import ChecklistCard from './ChecklistCard.vue';
import ClockCard from './ClockCard.vue';
import ImageCard from './ImageCard.vue';
import MailCard from './MailCard.vue';
import MediaWindow from './MediaWindow.vue';
import NewsCard from './NewsCard.vue';
import NoteCard from './NoteCard.vue';
import PresenceCard from './PresenceCard.vue';
import RadioBar from './RadioBar.vue';
import RecipeCard from './RecipeCard.vue';
import ReminderCard from './ReminderCard.vue';
import SwitchField from './SwitchField.vue';
import ValueTile from './ValueTile.vue';
import VideoTile from './VideoTile.vue';
import VoiceButton from './VoiceButton.vue';
import WeatherCard from './WeatherCard.vue';

/** Zuordnung vom Typnamen im Layout zum Widget. */
export const widgets: Record<string, Component> = {
  'value-tile': ValueTile,
  switches: SwitchField,
  chart: ChartCard,
  checklist: ChecklistCard,
  calendar: CalendarCard,
  calls: CallCard,
  clock: ClockCard,
  note: NoteCard,
  presence: PresenceCard,
  news: NewsCard,
  radio: RadioBar,
  recipes: RecipeCard,
  reminders: ReminderCard,
  video: VideoTile,
  voice: VoiceButton,
  weather: WeatherCard,
  'media-window': MediaWindow,
  image: ImageCard,
  mail: MailCard,
};
