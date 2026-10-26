import { definePlugin, explain } from '@culinola/sdk';
import catalogFile from './catalog.json' with { type: 'json' };
import { embeddable, type NewsItem, parseFeed } from './parse.ts';

interface Feed {
  id: string;
  name: string;
  url: string;
}

interface Config {
  feeds: Feed[];
  refreshMinutes: number;
  /** So viele Meldungen je Feed werden bereitgehalten. */
  maxItems: number;
}

/** Mitgelieferte Auswahl von Feeds; in der Konfiguration genügt dann die Kennung. */
const catalog = catalogFile as (Feed & { language: string; scope: string })[];

const FEED_ID = /^[a-z0-9][a-z0-9-]*$/;
const TIMEOUT_MS = 15_000;
const EMBED_CHECK_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Culinola)';

export default definePlugin<Config>({
  id: 'source-rss',
  name: { de: 'Nachrichten', en: 'News' },
  text: { de: 'Meldungen aus RSS-Feeds.', en: 'Stories from RSS feeds.' },
  settings: [
    { key: 'feeds', type: 'list', label: { de: 'Feeds', en: 'Feeds' }, hint: { de: 'Feeds aus dem mitgelieferten Katalog stehen nur mit ihrer Kennung da und lassen sich unter „Erweitert“ ändern.', en: 'Feeds from the built-in catalogue appear by id only and can be changed under “Advanced”.' }, fields: [{ key: 'id', type: 'text', label: { de: 'Kennung', en: 'Id' }, hint: { de: 'Kleinbuchstaben, Ziffern, Bindestriche.', en: 'Lower-case letters, digits, hyphens.' } }, { key: 'name', type: 'text', label: { de: 'Name', en: 'Name' } }, { key: 'url', type: 'text', label: { de: 'Adresse des Feeds', en: 'Address of the feed' }, placeholder: 'https://…' }] },
    { key: 'refreshMinutes', type: 'number', label: { de: 'Abruf alle … Minuten', en: 'Fetch every … minutes' }, min: 2, max: 1440, placeholder: 10 },
    { key: 'maxItems', type: 'number', label: { de: 'Meldungen je Feed', en: 'Stories per feed' }, min: 1, max: 50, placeholder: 10 },
  ],

  parseConfig(raw) {
    const config = raw as { feeds?: unknown; refreshMinutes?: number; maxItems?: number };
    if (!Array.isArray(config.feeds) || config.feeds.length === 0) throw new Error('"feeds" fehlt oder ist leer.');
    const feeds: Feed[] = [];
    for (const entry of config.feeds as (string | Partial<Feed>)[]) {
      if (typeof entry === 'string') {
        const known = catalog.find((candidate) => candidate.id === entry);
        if (!known) throw new Error(`Feed "${entry}" steht nicht im Katalog. Bekannt sind: ${catalog.map((candidate) => candidate.id).join(', ')}`);
        feeds.push({ id: known.id, name: known.name, url: known.url });
      } else {
        if (!FEED_ID.test(entry.id ?? '')) throw new Error(`Feed "${entry.name ?? '?'}": "id" fehlt oder enthält anderes als Kleinbuchstaben, Ziffern und Bindestriche.`);
        if (!entry.name) throw new Error(`Feed "${entry.id}": "name" fehlt.`);
        if (!/^https?:\/\//.test(entry.url ?? '')) throw new Error(`Feed "${entry.id}": "url" fehlt oder beginnt nicht mit http:// bzw. https://.`);
        feeds.push({ id: entry.id!, name: entry.name, url: entry.url! });
      }
    }
    if (new Set(feeds.map((feed) => feed.id)).size !== feeds.length) throw new Error('Eine Feed-Kennung ist doppelt vergeben.');
    return { feeds, refreshMinutes: Math.max(2, config.refreshMinutes ?? 10), maxItems: Math.min(50, Math.max(1, config.maxItems ?? 10)) };
  },

  start(context) {
    const { config, log } = context;
    const items = new Map<string, NewsItem[]>();
    const embed = new Map<string, { allowed: boolean; checked: number }>();
    const failing = new Set<string>();

    const publish = () => {
      context.resources.set(
        'feeds',
        config.feeds.map((feed) => ({ id: feed.id, name: feed.name, embed: embed.get(feed.id)?.allowed ?? false, items: items.get(feed.id) ?? [] })),
      );
      // Die Anzeige erfährt über diesen Datenpunkt, dass es Neues zu holen gibt
      context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Letzter Abruf der Nachrichten' });
    };

    const get = (url: string) => fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(TIMEOUT_MS)]) });

    /** Prüft einmal am Tag an der neuesten Meldung, ob der Anbieter das Anzeigen in einer anderen Seite erlaubt. */
    const checkEmbed = async (feed: Feed, link: string) => {
      if (Date.now() - (embed.get(feed.id)?.checked ?? 0) < EMBED_CHECK_MS) return;
      try {
        const response = await get(link);
        await response.body?.cancel();
        embed.set(feed.id, { allowed: response.ok && embeddable(response.headers), checked: Date.now() });
      } catch {
        embed.set(feed.id, { allowed: false, checked: Date.now() });
      }
    };

    const refresh = async (feed: Feed) => {
      try {
        const response = await get(feed.url);
        if (!response.ok) throw new Error(`Adresse antwortet mit ${response.status}`);
        const parsed = parseFeed(await response.text())
          .sort((a, b) => b.published - a.published)
          .slice(0, config.maxItems);
        items.set(feed.id, parsed);
        if (parsed[0]) await checkEmbed(feed, parsed[0].link);
        if (failing.delete(feed.id)) log.info(`Feed "${feed.name}" ist wieder erreichbar.`);
      } catch (error) {
        if (context.signal.aborted) return;
        // Bei einer Störung bleiben die zuletzt geholten Meldungen stehen; gemeldet wird sie einmal.
        if (!failing.has(feed.id)) log.warn(`Feed "${feed.name}" nicht abrufbar: ${explain(error)}`);
        failing.add(feed.id);
      }
    };

    const refreshAll = async () => {
      await Promise.all(config.feeds.map(refresh));
      publish();
    };

    publish();
    void refreshAll().then(() => log.info(`${config.feeds.length} Feeds abgerufen: ${config.feeds.map((feed) => `${feed.name} (${items.get(feed.id)?.length ?? 0})`).join(', ')}`));
    const timer = setInterval(() => void refreshAll(), config.refreshMinutes * 60_000);
    context.signal.addEventListener('abort', () => clearInterval(timer));

    context.resources.set(
      'catalog',
      catalog.map(({ id, name, language, scope }) => ({ id, name, language, scope })),
    );
  },
});
