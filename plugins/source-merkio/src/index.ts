import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { definePlugin, InvalidInput, explain } from '@culinola/sdk';
import { LoginFailed, MerkioClient } from './client.ts';
import { applyEvent, chooseLists, EventParser, keyed, splitEntry, toEntries, type ListInfo, type MerkioItem, type Wanted } from './merkio.ts';
import { mirrorRecipes } from './recipes.ts';

interface Config {
  /** Adresse der Merkio-API. */
  url: string;
  /** Die Listen, die Culinola zeigt; ohne Angabe alle Einkaufslisten des Kontos. */
  lists?: Wanted[];
  /** Die Rezeptliste, deren Rezepte in einen Ordner für das Rezept-Plugin kommen; ohne Angabe keine. */
  recipes?: Wanted;
  /** So oft wird zusätzlich zum Echtzeitkanal alles neu gelesen. */
  refreshMinutes: number;
}

interface Followed {
  info: ListInfo;
  /** Beendet den Echtzeitkanal dieser Liste. */
  stop: AbortController;
}

interface Shown extends Followed {
  items: MerkioItem[];
}

/** Eine Liste in der Konfiguration: ihr Name, ihre Nummer oder { name, group } – sonst nichts. */
function wishOf(entry: unknown): Wanted | undefined {
  if (typeof entry === 'string' && entry.trim()) return { name: entry };
  if (typeof entry === 'number' && Number.isInteger(entry)) return { id: entry };
  const wish = (entry ?? {}) as { name?: unknown; group?: unknown; id?: unknown };
  const named = typeof wish.name === 'string' && !!wish.name.trim();
  const numbered = typeof wish.id === 'number' && Number.isInteger(wish.id);
  if ((!named && !numbered) || (wish.group !== undefined && typeof wish.group !== 'string')) return undefined;
  return { ...(named ? { name: wish.name as string } : {}), ...(numbered ? { id: wish.id as number } : {}), ...(typeof wish.group === 'string' ? { group: wish.group } : {}) };
}

const RETRY_MS = 60_000;
const RECONNECT_MS = [2_000, 5_000, 15_000, 60_000];
/** Hat der Echtzeitkanal so lange gehalten, gilt sein Ende als gewöhnlich: Merkios Betreiber beendet jede Verbindung nach einer Viertelstunde. */
const STEADY_MS = 5 * 60_000;

/**
 * Einkaufs- und Aufgabenlisten aus Merkio. Culinola führt selbst keine Listen: Es zeigt die
 * aus Merkio, hakt dort ab und trägt dort ein – gepflegt wird weiter am Telefon, und beide
 * Seiten sehen über Merkios Echtzeitkanal sofort denselben Stand.
 *
 * Auf Wunsch kommen auch die Rezepte einer Rezeptliste herüber – nur in diese Richtung: Gepflegt werden
 * sie in Merkio, Culinola legt sie als Dateien in einen Ordner, den das Rezept-Plugin liest.
 */
export default definePlugin<Config>({
  id: 'source-merkio',
  name: { de: 'Merkio', en: 'Merkio' },
  text: { de: 'Einkaufs- und Aufgabenlisten aus Merkio, zum Abhaken und Ergänzen; auf Wunsch auch die Rezepte.', en: 'Shopping and to-do lists from Merkio, to tick off and add to; optionally the recipes as well.' },
  help: { de: 'Adresse der API: https://api.merkio.de ist eingetragen und bleibt so, solange Merkio nicht selbst betrieben wird.\nE-Mail-Adresse und Kennwort eines Merkio-Kontos. Am besten bekommt die Anzeige ein eigenes Konto, das Mitglied der Familiengruppe ist.\nListen: leer lassen zeigt alle Einkaufslisten des Kontos.\nRezeptliste: Die Rezepte daraus zeigt das Rezept-Plugin, wenn dort „Merkio“ als Herkunft gewählt ist. Gepflegt werden sie dann nur in Merkio.', en:'Address of the API: https://api.merkio.de is filled in and stays that way unless you run Merkio yourself.\nE-mail address and password of a Merkio account. Preferably the display gets its own account that is a member of the family group.\nLists: leaving it empty shows all shopping lists of the account.\nRecipe list: the recipes plugin shows its recipes when “Merkio” is chosen as origin there. They are then maintained in Merkio only.' },
  settings: [
    { key: 'url', type: 'text', label: { de: 'Adresse der API', en: 'Address of the API' }, hint: { de: 'Die Adresse von Merkio; nur für eine eigene Merkio-Installation zu ändern.', en: 'The address of Merkio; only to be changed for your own Merkio installation.' }, initial: 'https://api.merkio.de' },
    { key: 'lists', type: 'tags', label: { de: 'Listen', en: 'Lists' }, hint: { de: 'Namen der Listen; leer zeigt alle Einkaufslisten des Kontos. Gibt es einen Namen in mehreren Gruppen, die Gruppe in Klammern dazu: „Einkauf (Familie)“.', en: 'Names of the lists; empty shows all shopping lists of the account. If a name exists in several groups, add the group in brackets: “Einkauf (Familie)”.' } },
    { key: 'recipes', type: 'text', label: { de: 'Rezeptliste', en: 'Recipe list' }, hint: { de: 'Name der Rezeptliste in Merkio, deren Rezepte Culinola zeigt – beim Rezept-Plugin dazu „Merkio“ als Herkunft wählen. Gibt es den Namen in mehreren Gruppen, sagt es das Protokoll; dann die Gruppe in Klammern dazu: „Rezepte (Familie)“. Leer: keine.', en: 'Name of the recipe list in Merkio whose recipes Culinola shows – choose “Merkio” as origin in the recipes plugin as well. If the name exists in several groups, the log says so; then add the group in brackets: “Rezepte (Familie)”. Empty: none.' } },
    { key: 'refreshMinutes', type: 'number', label: { de: 'Abruf alle … Minuten', en: 'Fetch every … minutes' }, min: 1, max: 1440, placeholder: 5 },
  ],
  secrets: [
    { key: 'email', label: { de: 'E-Mail-Adresse', en: 'E-mail address' } },
    { key: 'password', label: { de: 'Kennwort', en: 'Password' } },
  ],

  parseConfig(raw) {
    const config = raw as { url?: unknown; lists?: unknown; recipes?: unknown; refreshMinutes?: unknown };
    const url = config.url ?? 'https://api.merkio.de';
    if (typeof url !== 'string' || !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error('"url" muss die Adresse der Merkio-API sein, etwa https://api.merkio.de.');
    const refreshMinutes = config.refreshMinutes ?? 5;
    if (typeof refreshMinutes !== 'number' || !(refreshMinutes >= 1 && refreshMinutes <= 1440)) throw new Error('"refreshMinutes" muss eine Zahl von 1 bis 1440 sein.');
    let lists: Wanted[] | undefined;
    if (config.lists !== undefined) {
      if (!Array.isArray(config.lists)) throw new Error('"lists" muss eine Liste von Listennamen sein.');
      lists = config.lists.map((entry: unknown): Wanted => {
        const wish = wishOf(entry);
        if (!wish) throw new Error('Ein Eintrag in "lists" ist der Name einer Liste oder { "name": …, "group": … }.');
        return wish;
      });
    }
    // Ein leeres Feld heißt: keine Rezepte
    const recipes = config.recipes === undefined || config.recipes === '' ? undefined : wishOf(config.recipes);
    if (config.recipes !== undefined && config.recipes !== '' && !recipes) throw new Error('"recipes" ist der Name einer Rezeptliste oder { "name": …, "group": … }.');
    return { url, refreshMinutes, ...(lists ? { lists } : {}), ...(recipes ? { recipes } : {}) };
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

    // Die Rezepte liegen als Dateien in einem Ordner, den das Rezept-Plugin liest. Was schon dort liegt,
    // bleibt auch dann sichtbar, wenn Merkio gerade nicht erreichbar ist.
    const recipeFolder = join(context.storageDir, 'rezepte');
    if (config.recipes) {
      mkdirSync(recipeFolder, { recursive: true });
      context.datapoints.set({ id: 'recipeFolder', value: recipeFolder, label: 'Merkio: Ordner der Rezepte' });
    }

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

    /**
     * Hört auf den Echtzeitkanal einer Liste und verbindet sich nach einem Abbruch neu. Jede Meldung geht an
     * `handle`; nach einer Unterbrechung holt `catchUp` nach, was in der Lücke geschah.
     */
    const listen = async (list: Followed, handle: (event: string, data: string) => Promise<void>, catchUp: () => Promise<void>) => {
      const signal = AbortSignal.any([context.signal, list.stop.signal]);
      // Jede Störung steht einmal im Protokoll, nicht jeder Versuch
      let warned = false;
      for (let attempt = 0; !signal.aborted; attempt++) {
        let opened = 0;
        try {
          const stream = await client.stream(`/lists/${list.info.id}/events`, signal);
          opened = Date.now();
          // Was während der Unterbrechung geschah, holt ein frischer Abruf nach
          if (attempt > 0) await catchUp();
          attempt = 0;
          warned = false;
          const parser = new EventParser();
          const decoder = new TextDecoder();
          for await (const chunk of stream) {
            for (const { event, data } of parser.push(decoder.decode(chunk, { stream: true }))) await handle(event, data);
          }
        } catch (error) {
          if (signal.aborted) return;
          // Nach langer Verbindung ist das Ende kein Fehler: Gemeldet wird erst, wenn sich der Kanal nicht wieder öffnen lässt
          const routine = opened > 0 && Date.now() - opened >= STEADY_MS;
          if (!routine && !warned) {
            warned = true;
            log.warn(`Echtzeitkanal der Liste "${list.info.name}" unterbrochen: ${explain(error)}`);
          }
        }
        await new Promise<void>((resume) => {
          const timer = setTimeout(resume, RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]);
          signal.addEventListener('abort', () => (clearTimeout(timer), resume()), { once: true });
        });
      }
    };

    let recipeList: Followed | undefined;
    let mirroring: Promise<void> | undefined;
    let again = false;
    let failures = '';
    /** Gleicht den Rezeptordner ab. Kommt während eines Abgleichs eine Änderung, folgt gleich ein weiterer. */
    const mirror = (): Promise<void> => {
      if (mirroring) {
        again = true;
        return mirroring;
      }
      mirroring = (async () => {
        do {
          again = false;
          const list = recipeList;
          if (!list) return;
          const { items } = await client.request<{ items: MerkioItem[] }>('GET', `/lists/${list.info.id}/items`);
          const { written, removed, failed, photoless } = await mirrorRecipes(recipeFolder, list.info.id, items, (path) => client.file(path));
          if (written.length || removed.length) log.info(`Rezepte aus Merkio: ${items.length} in der Liste, ${written.length} neu oder geändert, ${removed.length} entfernt`);
          // Ein Rezept, das sich nicht holen lässt, steht einmal im Protokoll, nicht bei jedem Abruf
          const now = [...failed, '|', ...photoless].join('\n');
          if (now !== failures) {
            if (failed.length) log.warn(`${failed.length} Rezepte nicht übernommen, beim nächsten Abruf neuer Versuch: ${failed.join('; ')}`);
            if (photoless.length) log.warn(`${photoless.length} Rezepte ohne Foto übernommen, das Foto wird beim nächsten Abruf neu versucht: ${photoless.join('; ')}`);
          }
          failures = now;
        } while (again);
      })().finally(() => (mirroring = undefined));
      return mirroring;
    };
    /** Folgt der gefundenen Rezeptliste; ist sie verschwunden, bleibt der Ordner, wie er ist. */
    const followRecipes = (info: ListInfo | undefined) => {
      if (recipeList && recipeList.info.id === info?.id) {
        recipeList.info = info;
        return;
      }
      recipeList?.stop.abort();
      recipeList = info ? { info, stop: new AbortController() } : undefined;
      // Merkio meldet Änderungen an Rezepten mit dem ganzen Rezept; einfacher und sicher ist, abzugleichen
      if (recipeList) void listen(recipeList, mirror, mirror);
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
      const { chosen, missing, ambiguous } = chooseLists(available, config.lists);
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
          void listen(
            list,
            async (event, data) => {
              let changed: MerkioItem[] | undefined;
              try {
                changed = applyEvent(list.items, event, JSON.parse(data));
              } catch {
                // Eine unlesbare Meldung ist wie eine unbekannte: Die Liste wird neu gelesen.
              }
              if (!adopt(key, changed)) await loadItems(key);
            },
            () => loadItems(key),
          );
        }
      }

      const lost = [...missing];
      const unclear = [...ambiguous];
      if (config.recipes) {
        const found = chooseLists(available.filter((list) => list.type === 'recipes'), [config.recipes]);
        followRecipes(found.chosen[0]);
        lost.push(...found.missing.map((described) => `Rezeptliste ${described}`));
        unclear.push(...found.ambiguous.map((text) => `Rezeptliste ${text}`));
      }

      const summary = `${groups.length}|${[...wanted.values()].map((list) => `${list.name} (${list.group})`).join(', ') || 'keine Liste'}${recipeList ? `; Rezepte: ${recipeList.info.name} (${recipeList.info.group})` : ''}|${lost.join(', ')}|${unclear.join(' ')}`;
      if (summary !== announced) {
        announced = summary;
        // Ein frisches Konto sieht nichts, bis es einer Gruppe beigetreten ist und dort bestätigt wurde
        if (!groups.length) log.warn('Bei Merkio angemeldet, aber das Konto ist in keiner Gruppe Mitglied. In Merkio mit diesem Konto der Gruppe beitreten und den Beitritt dort bestätigen lassen.');
        else log.info(`Bei Merkio angemeldet. Listen: ${summary.split('|')[1]}`);
        if (groups.length && lost.length) log.warn(`Nicht gefunden: ${lost.join(', ')}. Vorhanden sind: ${available.map((list) => `${list.name} (${list.group}, ${list.type})`).join(', ') || 'keine Listen'}`);
        if (unclear.length) log.warn(unclear.join(' '));
      }
      return groups.length > 0;
    };

    let timer: NodeJS.Timeout | undefined;
    const cycle = async () => {
      let wait = config.refreshMinutes * 60_000;
      try {
        const member = await discover();
        await Promise.all([...shown.keys()].map(loadItems));
        await mirror();
        setState(member ? 'ok' : 'nogroup');
        // Der Beitritt wird am Telefon bestätigt; bis dahin öfter nachsehen
        if (!member) wait = Math.min(wait, RETRY_MS);
      } catch (error) {
        if (context.signal.aborted) return;
        const message = explain(error);
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
        // Wer die Liste falsch benannt hat, erfährt gleich, welche es gibt
        const names = [...shown.values()].map((entry) => `"${entry.info.name}"`).join(', ');
        if (!hit) throw new InvalidInput(wanted ? `Die Liste "${String(list)}" gibt es in Merkio nicht, oder sie wird hier nicht gezeigt. Gezeigt ${shown.size === 1 ? 'wird' : 'werden'}: ${names || 'keine'}.` : 'Es ist keine Liste eingerichtet.');
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
