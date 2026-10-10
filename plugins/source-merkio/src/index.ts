import { join } from 'node:path';
import { definePlugin, InvalidInput } from '@culinola/sdk';
import { LoginFailed, MerkioClient } from './client.ts';
import { applyEvent, chooseLists, EventParser, keyed, splitEntry, toEntries, type ListInfo, type MerkioItem, type Wanted } from './merkio.ts';

interface Config {
  /** Adresse der Merkio-API. */
  url: string;
  /** Die Listen, die Culinola zeigt; ohne Angabe alle Einkaufslisten des Kontos. */
  lists?: Wanted[];
  /** So oft wird zusätzlich zum Echtzeitkanal alles neu gelesen. */
  refreshMinutes: number;
}

interface Shown {
  info: ListInfo;
  items: MerkioItem[];
  /** Beendet den Echtzeitkanal dieser Liste. */
  stop: AbortController;
}

const RETRY_MS = 60_000;
const RECONNECT_MS = [2_000, 5_000, 15_000, 60_000];

/**
 * Einkaufs- und Aufgabenlisten aus Merkio. Culinola führt selbst keine Listen: Es zeigt die
 * aus Merkio, hakt dort ab und trägt dort ein – gepflegt wird weiter am Telefon, und beide
 * Seiten sehen über Merkios Echtzeitkanal sofort denselben Stand.
 */
export default definePlugin<Config>({
  id: 'source-merkio',

  parseConfig(raw) {
    const config = raw as { url?: unknown; lists?: unknown; refreshMinutes?: unknown };
    const url = config.url ?? 'https://api.merkio.de';
    if (typeof url !== 'string' || !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('"url" muss die Adresse der Merkio-API sein, etwa https://api.merkio.de.');
    const refreshMinutes = config.refreshMinutes ?? 5;
    if (typeof refreshMinutes !== 'number' || !(refreshMinutes >= 1 && refreshMinutes <= 1440)) throw new Error('"refreshMinutes" muss eine Zahl von 1 bis 1440 sein.');
    let lists: Wanted[] | undefined;
    if (config.lists !== undefined) {
      if (!Array.isArray(config.lists)) throw new Error('"lists" muss eine Liste von Listennamen sein.');
      lists = config.lists.map((entry: unknown): Wanted => {
        if (typeof entry === 'string' && entry.trim()) return { name: entry };
        if (typeof entry === 'number' && Number.isInteger(entry)) return { id: entry };
        const wish = (entry ?? {}) as { name?: unknown; group?: unknown; id?: unknown };
        const named = typeof wish.name === 'string' && !!wish.name.trim();
        const numbered = typeof wish.id === 'number' && Number.isInteger(wish.id);
        if ((!named && !numbered) || (wish.group !== undefined && typeof wish.group !== 'string')) throw new Error('Ein Eintrag in "lists" ist der Name einer Liste oder { "name": …, "group": … }.');
        return { ...(named ? { name: wish.name as string } : {}), ...(numbered ? { id: wish.id as number } : {}), ...(typeof wish.group === 'string' ? { group: wish.group } : {}) };
      });
    }
    return { url, refreshMinutes, ...(lists ? { lists } : {}) };
  },

  start(context) {
    const { log, config } = context;
    const shown = new Map<string, Shown>();
    let state = '';

    const setState = (next: string) => {
      if (next === state) return;
      state = next;
      // ok – verbunden · nogroup – angemeldet, aber in keiner Gruppe · login – Anmeldung fehlt oder wird abgelehnt · offline – Merkio nicht erreichbar
      context.datapoints.set({ id: 'state', value: next, label: 'Merkio: Verbindung' });
    };
    const publish = () => {
      const lists = [...shown].map(([id, { info, items }]) => ({ id, name: info.name, group: info.group, type: info.type, items: toEntries(items) }));
      context.resources.set('lists', lists);
      context.datapoints.set({ id: 'open', value: lists.reduce((sum, list) => sum + list.items.filter((entry) => !entry.checked).length, 0), label: 'Merkio: offene Einträge' });
      // Die Anzeige erfährt über diesen Datenpunkt, dass sich eine Liste geändert hat
      context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Merkio: letzte Änderung' });
    };
    publish();

    const email = context.secrets.get('email') ?? context.secrets.get('user');
    const password = context.secrets.get('password');
    if (!email || !password) {
      // Eine fehlende Anmeldung ist kein Absturz: Der Kern läuft weiter und sagt, was zu tun ist.
      setState('login');
      log.warn(`In secrets.json fehlen die Zugangsdaten: { "${context.instanceId}": { "email": "…", "password": "…" } }`);
      return;
    }
    const client = new MerkioClient({ url: config.url, email, password, tokenFile: join(context.storageDir, 'token.json'), signal: context.signal });

    const adopt = (key: string, items: MerkioItem[] | undefined) => {
      const list = shown.get(key);
      if (!list || !items) return false;
      list.items = items;
      publish();
      return true;
    };
    const loadItems = async (key: string) => {
      const list = shown.get(key);
      if (list) adopt(key, (await client.request<{ items: MerkioItem[] }>('GET', `/lists/${list.info.id}/items`)).items);
    };

    /** Hört auf den Echtzeitkanal einer Liste und verbindet sich nach einem Abbruch neu. */
    const listen = async (key: string, list: Shown) => {
      const signal = AbortSignal.any([context.signal, list.stop.signal]);
      for (let attempt = 0; !signal.aborted; attempt++) {
        try {
          const stream = await client.stream(`/lists/${list.info.id}/events`, signal);
          // Was während der Unterbrechung geschah, holt ein frischer Abruf nach
          if (attempt > 0) await loadItems(key);
          attempt = 0;
          const parser = new EventParser();
          const decoder = new TextDecoder();
          for await (const chunk of stream) {
            for (const { event, data } of parser.push(decoder.decode(chunk, { stream: true }))) {
              let changed: MerkioItem[] | undefined;
              try {
                changed = applyEvent(list.items, event, JSON.parse(data));
              } catch {
                // Eine unlesbare Meldung ist wie eine unbekannte: Die Liste wird neu gelesen.
              }
              if (!adopt(key, changed)) await loadItems(key);
            }
          }
        } catch (error) {
          if (signal.aborted) return;
          if (attempt === 0) log.warn(`Echtzeitkanal der Liste "${list.info.name}" unterbrochen: ${error instanceof Error ? error.message : String(error)}`);
        }
        await new Promise<void>((resume) => {
          const timer = setTimeout(resume, RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]);
          signal.addEventListener('abort', () => (clearTimeout(timer), resume()), { once: true });
        });
      }
    };

    let announced = '';
    /**
     * Liest Gruppen und Listen und gleicht ab, was gezeigt wird; neue Listen bekommen ihren Echtzeitkanal.
     * Gibt zurück, ob das Konto überhaupt einer Gruppe angehört.
     */
    const discover = async (): Promise<boolean> => {
      const { groups } = await client.request<{ groups: { id: number; name: string }[] }>('GET', '/groups');
      const available: ListInfo[] = [];
      for (const group of groups) {
        const { lists } = await client.request<{ lists: { id: number; name: string; type: string }[] }>('GET', `/groups/${group.id}/lists`);
        available.push(...lists.map((list) => ({ id: list.id, name: list.name, type: list.type, group: group.name })));
      }
      context.resources.set('available', available);
      const { chosen, missing } = chooseLists(available, config.lists);
      const wanted = keyed(chosen);

      for (const [key, list] of shown) {
        if (wanted.get(key)?.id === list.info.id) continue;
        list.stop.abort();
        shown.delete(key);
      }
      for (const [key, info] of wanted) {
        const known = shown.get(key);
        if (known) known.info = info;
        else {
          const list: Shown = { info, items: [], stop: new AbortController() };
          shown.set(key, list);
          await loadItems(key);
          void listen(key, list);
        }
      }

      const summary = `${groups.length}|${[...wanted.values()].map((list) => `${list.name} (${list.group})`).join(', ') || 'keine Liste'}|${missing.join(', ')}`;
      if (summary !== announced) {
        announced = summary;
        // Ein frisches Konto sieht nichts, bis es einer Gruppe beigetreten ist und dort bestätigt wurde
        if (!groups.length) log.warn('Bei Merkio angemeldet, aber das Konto ist in keiner Gruppe Mitglied. In Merkio mit diesem Konto der Gruppe beitreten und den Beitritt dort bestätigen lassen.');
        else log.info(`Bei Merkio angemeldet. Listen: ${summary.split('|')[1]}`);
        if (groups.length && missing.length) log.warn(`Nicht gefunden: ${missing.join(', ')}. Vorhanden sind: ${available.map((list) => `${list.name} (${list.group}, ${list.type})`).join(', ') || 'keine Listen'}`);
      }
      return groups.length > 0;
    };

    let timer: NodeJS.Timeout | undefined;
    const cycle = async () => {
      let wait = config.refreshMinutes * 60_000;
      try {
        const member = await discover();
        await Promise.all([...shown.keys()].map(loadItems));
        setState(member ? 'ok' : 'nogroup');
        // Der Beitritt wird am Telefon bestätigt; bis dahin öfter nachsehen
        if (!member) wait = Math.min(wait, RETRY_MS);
      } catch (error) {
        if (context.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof LoginFailed) {
          if (state !== 'login') log.warn(`${message} Zugangsdaten in secrets.json unter "${context.instanceId}" prüfen.`);
          setState('login');
        } else {
          if (state !== 'offline') log.warn(`Merkio nicht erreichbar: ${message}`);
          setState('offline');
          wait = Math.min(wait, RETRY_MS);
        }
      }
      if (!context.signal.aborted) timer = setTimeout(() => void cycle(), wait);
    };
    void cycle();
    context.signal.addEventListener('abort', () => clearTimeout(timer));

    const find = (id: number) => [...shown].find(([, list]) => list.items.some((item) => item.id === id));

    context.actions.register(
      {
        name: 'lists.check',
        description: 'Hakt einen Eintrag einer Einkaufs- oder Aufgabenliste ab oder nimmt den Haken wieder weg.',
        params: {
          item: { type: 'number', description: 'Nummer des Eintrags', required: true },
          checked: { type: 'boolean', description: 'true hakt ab, false nimmt den Haken weg; ohne Angabe wird abgehakt' },
        },
      },
      async ({ item, checked }) => {
        const hit = typeof item === 'number' ? find(item) : undefined;
        if (!hit) throw new InvalidInput(`Der Eintrag ${String(item)} steht auf keiner der gezeigten Listen.`);
        const [key, list] = hit;
        const { item: updated } = await client.request<{ item: MerkioItem }>('PATCH', `/items/${item as number}`, { checked: checked !== false });
        adopt(key, applyEvent(list.items, 'item_updated', updated));
        return { list: key, item: updated.id, checked: !!updated.checked };
      },
    );

    context.actions.register(
      {
        name: 'lists.add',
        description: 'Setzt einen Eintrag auf eine Einkaufs- oder Aufgabenliste, etwa "2 kg Mehl". Steht er dort schon abgehakt, wird er wieder offen.',
        params: {
          text: { type: 'string', description: 'Der Eintrag, auf Wunsch mit Menge und Einheit davor', required: true },
          quantity: { type: 'string', description: 'Menge als Text, etwa "2" oder "0.5" – nur, wenn sie nicht schon im Eintrag steht' },
          unit: { type: 'string', description: 'Einheit zur Menge, etwa "kg" oder "Packung"' },
          list: { type: 'string', description: 'Kennung oder Name der Liste; ohne Angabe die erste' },
        },
      },
      async ({ text, list, quantity, unit }) => {
        const wanted = typeof list === 'string' ? list.trim().toLowerCase() : '';
        const hit = [...shown].find(([key, entry]) => !wanted || key === wanted || entry.info.name.toLowerCase() === wanted);
        if (!hit) throw new InvalidInput(wanted ? `Die Liste "${String(list)}" wird nicht gezeigt.` : 'Es ist keine Liste eingerichtet.');
        const [key, target] = hit;
        // Kommen Menge und Einheit eigens mit, ist der Text allein der Name – sonst stehen sie vielleicht davor
        const given = typeof quantity === 'string' && quantity.trim() ? quantity.trim().slice(0, 50) : undefined;
        const measure = typeof unit === 'string' && unit.trim() ? unit.trim().slice(0, 20) : undefined;
        const entry =
          given || measure
            ? { name: (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim().slice(0, 255), ...(given ? { quantity: given } : {}), ...(measure ? { unit: measure } : {}) }
            : splitEntry(typeof text === 'string' ? text : '');
        if (!entry.name) throw new InvalidInput('Der Eintrag ist leer.');

        // Was schon abgehakt auf der Liste steht, kommt zurück, statt doppelt zu erscheinen
        const again = target.items.find((item) => item.name.trim().toLowerCase() === entry.name.toLowerCase());
        if (again && !again.checked) return { list: key, item: again.id, added: false };
        const { item: saved } = again
          ? await client.request<{ item: MerkioItem }>('PATCH', `/items/${again.id}`, { checked: false, ...(entry.quantity ? { quantity: entry.quantity, unit: entry.unit ?? null } : {}) })
          : await client.request<{ item: MerkioItem }>('POST', `/lists/${target.info.id}/items`, entry);
        adopt(key, applyEvent(target.items, again ? 'item_updated' : 'item_created', saved));
        log.info(`Auf die Liste "${target.info.name}" gesetzt: ${entry.name}`);
        return { list: key, item: saved.id, added: true };
      },
    );
  },
});
