import type { PluginContext, PluginDefinition } from '@culinola/sdk';
import radio from '@culinola/plugin-media-radio';
import recipes from '@culinola/plugin-recipes';
import astro from '@culinola/plugin-source-astro';
import rss from '@culinola/plugin-source-rss';
import timer from '@culinola/plugin-timer';
import demo from '../../../../plugins/connector-demo/src/index.ts';
import catalog from '../catalog.json';
import { startAgenda, startCalls, startLists, startMail } from './family.ts';
import { startForecast, startHouse } from './house.ts';
import { startVideo, withTitles } from './media.ts';
import { startVoice } from './voice.ts';

type Start = (context: PluginContext<unknown>) => void;

/** Was ein Plugin über sich sagt, mit einem Start, der in der Demo an seine Stelle tritt. */
function standIn(id: keyof typeof catalog, start: Start): PluginDefinition<unknown> {
  return { ...(catalog[id] as PluginDefinition<unknown>), id, start };
}

/** Plugins, die Geräte im eigenen Netz brauchen: Sie lassen sich in der Demo anlegen, starten aber nicht. */
const needsHome: Start = () => {
  throw new Error('Dieses Plugin braucht ein Gerät im eigenen Netz und läuft deshalb in der Demo nicht.');
};

/**
 * Die Plugins der Demo. Eieruhr, Rezepte, Nachrichten, Sonne und Mond und das Radio sind die echten Plugins –
 * sie laufen im Browser wie im Kern. Was Haustechnik, Postfächer oder Konten braucht, ersetzen Stellvertreter
 * mit erfundenen Daten in derselben Form.
 */
export function demoPlugins(clips: Record<string, string>): Record<string, PluginDefinition<unknown>> {
  return {
    'connector-demo': demo as PluginDefinition<unknown>,
    'connector-homeassistant': standIn('connector-homeassistant', needsHome),
    'connector-homematic': standIn('connector-homematic', needsHome),
    'connector-mqtt': standIn('connector-mqtt', needsHome),
    'connector-openhab': standIn('connector-openhab', startHouse),
    'media-radio': withTitles(radio as PluginDefinition<unknown>),
    'media-video': standIn('media-video', (context) => startVideo(context, clips)),
    recipes: recipes as PluginDefinition<unknown>,
    'source-astro': astro as PluginDefinition<unknown>,
    'source-fritzbox': standIn('source-fritzbox', startCalls),
    'source-google': standIn('source-google', startAgenda),
    'source-mail': standIn('source-mail', startMail),
    'source-merkio': standIn('source-merkio', startLists),
    'source-rss': rss as PluginDefinition<unknown>,
    'source-solar-forecast': standIn('source-solar-forecast', startForecast),
    timer: timer as PluginDefinition<unknown>,
    voice: standIn('voice', startVoice),
  };
}
