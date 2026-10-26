import type { AppConfig } from '../../core/src/config.ts';
import { language, localizeLayout, pick } from './language.ts';
import layout from './layout.json';

/**
 * Die Konfiguration der Demo – so, wie sie in `config.json` einer echten Installation stünde. Das Layout ist
 * das der Küche, für die Culinola entstanden ist; nur die Quellen dahinter sind Stellvertreter. Texte und Beispiel-
 * daten gibt es auf Deutsch und Englisch.
 */
export const DEMO_CONFIG: AppConfig = {
  port: 8090,
  site: { language },
  sources: [
    { id: 'openhab', plugin: 'connector-openhab', config: { url: 'http://openhab:8080' } },
    {
      id: 'radio',
      plugin: 'media-radio',
      config: {
        volume: 50,
        stations: [
          { id: 'bayern3', name: 'Bayern 3', kind: 'audio', url: 'https://dispatcher.rndfnk.com/br/br3/live/mp3/mid', image: 'bayern3.png' },
          { id: 'bayern2', name: 'Bayern 2', kind: 'audio', url: 'https://dispatcher.rndfnk.com/br/br2/live/mp3/mid', image: 'bayern2.png' },
          { id: 'antenne', name: 'Antenne Bayern', kind: 'audio', url: 'https://s3-webradio.antenne.de/antenne', image: 'antenne.png' },
          { id: 'rock', name: 'Rock Antenne', kind: 'audio', url: 'https://s2-webradio.rockantenne.de/rockantenne', image: 'rock.png' },
          { id: 'hit-rt1', name: 'Hit Radio RT1', kind: 'audio', url: 'https://rt1.radio/augsburg', image: 'hit-rt1.png' },
        ],
      },
    },
    {
      id: 'video',
      plugin: 'media-video',
      config: {
        streams: [
          { id: 'kamera3', name: pick({ de: 'Haustür', en: 'Front door' }) },
          { id: 'kamera2', name: pick({ de: 'Garten / Süd', en: 'Garden / south' }) },
        ],
      },
    },
    { id: 'news', plugin: 'source-rss', config: { feeds: pick({ de: ['dw-de', 'augsburger-allgemeine', 'tagesschau'], en: ['dw-en', { id: 'dw-germany', name: 'DW Germany', url: 'https://rss.dw.com/xml/rss-en-ger' }] }), refreshMinutes: 15, maxItems: 10 } },
    { id: 'recipes', plugin: 'recipes', config: { shoppingList: pick({ de: 'Einkauf', en: 'Shopping' }) } },
    { id: 'timer', plugin: 'timer' },
    { id: 'google', plugin: 'source-google', config: { calendars: pick({ de: ['primary', 'Schule', 'Abfall'], en: ['primary', 'School', 'Bins'] }) } },
    { id: 'mail', plugin: 'source-mail', config: { accounts: [{ id: 'privat', name: pick({ de: 'Privat', en: 'Home' }), host: 'imap.example.org' }, { id: 'verein', name: pick({ de: 'Verein', en: 'Club' }), host: 'imap.example.org' }] } },
    { id: 'fritzbox', plugin: 'source-fritzbox', config: { host: 'http://fritz.box' } },
    { id: 'merkio', plugin: 'source-merkio', config: { url: 'https://api.merkio.de', lists: [pick({ de: 'Einkauf', en: 'Shopping' })] } },
    { id: 'voice', plugin: 'voice', config: { language } },
    { id: 'prognose', plugin: 'source-solar-forecast', config: { latitude: 48.37, longitude: 10.9, declination: 30, azimuth: 0, kwp: 9.8 } },
    { id: 'astro', plugin: 'source-astro', config: { latitude: 48.37, longitude: 10.9 } },
  ],
  layouts: { main: localizeLayout(layout) as AppConfig['layouts'][string] },
  events: {
    hausglocke: { text: pick({ de: 'Jemand klingelt an der Haustür!', en: 'Someone is at the front door!' }), sound: 'bell', speak: true, video: 'kamera3', seconds: 30 },
    'waschen-fertig': { text: pick({ de: 'Die Waschmaschine ist fertig!', en: 'The washing machine is done!' }), sound: 'chime', when: { datapoint: 'openhab:Waschmaschine_An', equals: 3 } },
  },
};

/** Zugangsdaten, die in der Demo „hinterlegt“ sind – nur ihre Namen zeigt die Oberfläche, nie den Wert. */
export const DEMO_SECRETS: Record<string, Record<string, string>> = {
  openhab: { token: 'demo' },
  mail: { 'privat.password': 'demo', 'verein.password': 'demo' },
  fritzbox: { user: 'demo', password: 'demo' },
  merkio: { email: 'demo', password: 'demo' },
  voice: { anthropicApiKey: 'demo' },
};
