import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { definePlugin, InvalidInput, explain } from '@culinola/sdk';
import { ImportRefused, importInput, statusOf } from './importer.ts';
import { amountText, ingredientsOf, toShoppingItems, yieldOf } from './ingredients.ts';
import { inside, parseRecipe, recipeId, type RecipeInfo } from './library.ts';

interface Config {
  /** Ordner mit den Rezepten; ohne Angabe der eigene Ordner der Instanz im Datenordner. */
  folder?: string;
  /** Sprache, in der neue Rezepte geschrieben werden: de, en oder fr. */
  importLanguage?: string;
  /** Sprachmodell für das Umwandeln neuer Rezepte; ohne Angabe das des Import-Werkzeugs. */
  importModel?: string;
  /** Name der Einkaufsliste, auf die Zutaten gesetzt werden; ohne Angabe die erste, die gezeigt wird. */
  shoppingList?: string;
}

interface Entry extends RecipeInfo {
  id: string;
  file: string;
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const MAX_DEPTH = 4;
const MAX_RECIPE_BYTES = 1_000_000;
const SETTLE_MS = 500;
const POLL_MS = 60_000;
/** So lange bleibt ein Rezept als „wird gekocht“ stehen, wenn niemand es abmeldet. */
const COOKING_MS = 6 * 3_600_000;

export default definePlugin<Config>({
  id: 'recipes',
  name: { de: 'Rezepte', en: 'Recipes' },
  text: { de: 'Rezepte aus einem Ordner mit Markdown-Dateien; neue lassen sich aus Text, Foto oder Webseite hinzufügen.', en: 'Recipes from a folder of Markdown files; new ones can be added from text, photo or web page.' },
  help: { de: 'Der Schlüssel der Claude-API wird nur für das Hinzufügen neuer Rezepte gebraucht. Er wird unter https://platform.claude.com bei den API-Schlüsseln erzeugt und beginnt mit „sk-ant-“. Jede Umwandlung kostet einen kleinen Betrag nach Verbrauch.', en: 'The Claude API key is only needed for adding new recipes. It is created at https://platform.claude.com under API keys and starts with “sk-ant-”. Every conversion costs a small amount by usage.' },
  settings: [
    { key: 'folder', type: 'text', label: { de: 'Ordner', en: 'Folder' }, hint: { de: 'Leer gilt der Ordner der Quelle im Datenordner.', en: 'Empty means the folder of the source inside the data folder.' } },
    { key: 'shoppingList', type: 'text', label: { de: 'Einkaufsliste', en: 'Shopping list' }, hint: { de: 'Name der Liste, auf die Zutaten gesetzt werden; leer die erste, die gezeigt wird.', en: 'Name of the list ingredients go on; empty means the first one shown.' } },
    { key: 'importLanguage', type: 'select', label: { de: 'Sprache neuer Rezepte', en: 'Language of new recipes' }, options: ['', 'de', 'en', 'fr'] },
    { key: 'importModel', type: 'text', label: { de: 'Sprachmodell für neue Rezepte', en: 'Language model for new recipes' } },
  ],
  secrets: [
    { key: 'anthropicApiKey', label: { de: 'Schlüssel der Claude-API', en: 'Claude API key' }, hint: { de: 'Nur für das Hinzufügen neuer Rezepte.', en: 'Only for adding new recipes.' } },
  ],

  parseConfig(raw) {
    const config = raw as { folder?: unknown; importLanguage?: unknown; importModel?: unknown; shoppingList?: unknown };
    if (config.folder !== undefined && (typeof config.folder !== 'string' || !config.folder)) throw new Error('"folder" muss ein Ordnerpfad sein.');
    if (config.importLanguage !== undefined && !['de', 'en', 'fr'].includes(config.importLanguage as string)) throw new Error('"importLanguage" muss de, en oder fr sein.');
    if (config.importModel !== undefined && (typeof config.importModel !== 'string' || !config.importModel)) throw new Error('"importModel" muss die Kennung eines Sprachmodells sein.');
    if (config.shoppingList !== undefined && (typeof config.shoppingList !== 'string' || !config.shoppingList.trim())) throw new Error('"shoppingList" muss der Name einer Einkaufsliste sein.');
    return {
      ...(typeof config.shoppingList === 'string' ? { shoppingList: config.shoppingList.trim() } : {}),
      ...(typeof config.folder === 'string' ? { folder: config.folder } : {}),
      ...(typeof config.importLanguage === 'string' ? { importLanguage: config.importLanguage } : {}),
      ...(typeof config.importModel === 'string' ? { importModel: config.importModel } : {}),
    };
  },

  start(context) {
    const { log } = context;
    const folder = resolve(context.config.folder ?? context.storageDir);
    mkdirSync(folder, { recursive: true });

    let recipes = new Map<string, Entry>();

    // „Das koche ich gerade“: Dieses Rezept bleibt auf allen Anzeigen stehen, statt im Wechsel zu verschwinden.
    // Der Vermerk liegt im Kern, damit er ein Neuladen übersteht, und endet nach einigen Stunden von selbst.
    const cookingFile = join(context.storageDir, '.kochen.json');
    let cooking: { id: string; since: number } | undefined;
    let release: NodeJS.Timeout | undefined;
    const setCooking = (next: { id: string; since: number } | undefined, save = true) => {
      cooking = next;
      clearTimeout(release);
      if (next) release = setTimeout(() => setCooking(undefined), Math.max(0, next.since + COOKING_MS - Date.now()));
      context.datapoints.set({ id: 'cooking', value: next?.id ?? '', label: 'Rezept, das gerade gekocht wird' });
      if (!save) return;
      try {
        writeFileSync(cookingFile, JSON.stringify(next ?? {}));
      } catch (error) {
        log.warn(`Vermerk zum Kochen nicht speicherbar: ${explain(error)}`);
      }
    };
    try {
      const saved = JSON.parse(readFileSync(cookingFile, 'utf8')) as { id?: unknown; since?: unknown };
      if (typeof saved.id === 'string' && typeof saved.since === 'number' && saved.since + COOKING_MS > Date.now()) cooking = { id: saved.id, since: saved.since };
    } catch {
      // Ohne gespeicherten Vermerk wird nichts gekocht.
    }
    context.signal.addEventListener('abort', () => clearTimeout(release));
    const reported = new Set<string>();

    const files = (dir: string, depth = 0): string[] => {
      const found: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory() && depth < MAX_DEPTH) found.push(...files(path, depth + 1));
        else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(path);
      }
      return found;
    };

    const scan = () => {
      const next = new Map<string, Entry>();
      const before = new Map([...recipes.values()].map((entry) => [entry.file, entry]));
      for (const file of files(folder)) {
        const way = relative(folder, file);
        try {
          if (statSync(file).size > MAX_RECIPE_BYTES) throw new Error('Datei ist größer als 1 MB');
          const { markdown: _markdown, problem, ...info } = parseRecipe(file, readFileSync(file, 'utf8'));
          if (problem && !reported.has(`${way}|${problem}`)) {
            reported.add(`${way}|${problem}`);
            log.warn(`Rezept "${way}": ${problem}`);
          }
          let id = recipeId(way) || 'rezept';
          for (let count = 2; next.has(id); count++) id = `${recipeId(way)}-${count}`;
          // Ohne eigene Angabe ordnet der Unterordner das Rezept ein
          const folderName = way.split(/[\\/]/).length > 1 ? way.split(/[\\/]/)[0]! : undefined;
          next.set(id, { id, file, ...info, ...(info.category || !folderName ? {} : { category: folderName }) });
        } catch (error) {
          if (!reported.has(way)) log.warn(`Rezept "${way}" nicht lesbar: ${explain(error)}`);
          reported.add(way);
          // Die Datei ist noch da, nur gerade nicht lesbar – etwa weil ein anderes Programm sie festhält.
          // Dann bleibt das Rezept mit seinem letzten Stand in der Liste, statt zu verschwinden.
          const known = before.get(file);
          if (known && !next.has(known.id)) next.set(known.id, known);
        }
      }
      recipes = next;
      // Ein Rezept, das es nicht mehr gibt, kann niemand mehr kochen
      if (cooking && !recipes.has(cooking.id)) setCooking(undefined);
      context.resources.set(
        'list',
        [...recipes.values()].map(({ file: _file, ...entry }) => entry).sort((a, b) => a.title.localeCompare(b.title)),
      );
      context.datapoints.set({ id: 'count', value: recipes.size, label: 'Anzahl der Rezepte' });
      // Die Anzeige erfährt über diesen Datenpunkt, dass sich der Rezeptordner geändert hat
      context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Letzte Änderung der Rezepte' });
    };

    scan();
    log.info(`${recipes.size} Rezepte in ${folder}`);
    setCooking(cooking, false);

    /** Findet ein Rezept über seine Kennung oder seinen Titel; vom Titel genügt ein eindeutiger Teil. */
    const find = (recipe: unknown): Entry => {
      const wanted = String(recipe).trim().toLowerCase();
      const all = [...recipes.values()];
      const named = all.filter((known) => known.title.toLowerCase() === wanted);
      const similar = named.length ? named : all.filter((known) => wanted.length >= 3 && known.title.toLowerCase().includes(wanted));
      const entry = recipes.get(String(recipe)) ?? (similar.length === 1 ? similar[0] : undefined);
      if (!entry) throw new InvalidInput(similar.length > 1 ? `"${String(recipe)}" passt auf mehrere Rezepte: ${similar.slice(0, 5).map((known) => known.title).join(', ')}.` : `Das Rezept "${String(recipe)}" gibt es nicht.`);
      return entry;
    };

    // Zutaten auf die Einkaufsliste. Culinola führt selbst keine Listen: Die Einträge gehen über die Aktion
    // "lists.add" an das Plugin, das die Liste führt – etwa Merkio. Gibt es keines, wird nichts angeboten.
    const canShop = () => context.actions.list().some((action) => action.name === 'lists.add');
    const shopping = (entry: Entry, amount?: number) => {
      const recipe = parseRecipe(entry.file, readFileSync(entry.file, 'utf8'));
      const base = yieldOf(recipe.servings);
      const wanted = amount && amount > 0 && amount <= 1000 ? amount : base.amount;
      const items = toShoppingItems(ingredientsOf(recipe.markdown), wanted / base.amount).map((item) => ({ ...item, amount: amountText(item) }));
      return { id: entry.id, title: entry.title, ready: canShop(), base: base.amount, amount: wanted, unit: base.unit, counted: base.counted, items, ...(context.config.shoppingList ? { list: context.config.shoppingList } : {}) };
    };
    /** Setzt die Zutaten auf die Liste – alle oder nur die genannten – und zählt, was neu daraufkam. */
    const shop = async (entry: Entry, amount?: number, only?: string[]) => {
      if (!canShop()) throw new InvalidInput('Es ist keine Einkaufsliste eingerichtet.');
      const { items, title } = shopping(entry, amount);
      const chosen = only ? items.filter((item) => only.some((name) => name.toLowerCase() === item.name.toLowerCase())) : items;
      if (!chosen.length) throw new InvalidInput(items.length ? 'Es ist keine Zutat ausgewählt.' : `Im Rezept "${title}" stehen keine lesbaren Zutaten.`);
      const result = { recipe: title, added: 0, known: 0, failed: [] as string[] };
      // Der Reihe nach: So stehen die Zutaten auf der Liste in der Reihenfolge des Rezepts
      for (const item of chosen) {
        try {
          const done = (await context.actions.run('lists.add', {
            text: item.name,
            ...(item.quantity ? { quantity: item.quantity } : {}),
            ...(item.unit ? { unit: item.unit } : {}),
            ...(context.config.shoppingList ? { list: context.config.shoppingList } : {}),
          })) as { added?: boolean } | undefined;
          if (done?.added === false) result.known++;
          else result.added++;
        } catch (error) {
          // Eine Liste, die es nicht gibt, scheitert bei jeder Zutat gleich – das ist ein Fehler der Einrichtung
          if (error instanceof InvalidInput && !result.added && !result.known && item === chosen[0]) throw error;
          result.failed.push(item.name);
        }
      }
      log.info(`Zutaten auf die Einkaufsliste: ${title} (${result.added} neu, ${result.known} schon da${result.failed.length ? `, ${result.failed.length} gescheitert` : ''})`);
      return result;
    };
    context.actions.register(
      {
        name: 'recipes.shop',
        description: 'Setzt alle Zutaten eines Rezepts auf die Einkaufsliste, auf Wunsch umgerechnet auf eine andere Menge.',
        params: {
          recipe: { type: 'string', description: 'Kennung oder Titel des Rezepts; ohne Angabe das Rezept, das gerade gekocht wird' },
          amount: { type: 'number', description: 'Wofür eingekauft wird, in der Angabe des Rezepts – etwa 6, wenn es für 6 statt 4 Portionen reichen soll' },
        },
      },
      ({ recipe, amount }) => {
        const entry = recipe === undefined ? (cooking ? recipes.get(cooking.id) : undefined) : find(recipe);
        if (!entry) throw new InvalidInput('Es wird gerade kein Rezept gekocht – welches ist gemeint?');
        return shop(entry, typeof amount === 'number' ? amount : undefined);
      },
    );
    context.routes.get('/shopping/:id', (request) => {
      const entry = recipes.get(request.params.id ?? '');
      if (!entry || !existsSync(entry.file)) return Response.json({ error: 'Rezept nicht gefunden.' }, { status: 404 });
      return Response.json(shopping(entry, Number(request.query['amount']) || undefined));
    });
    context.routes.post('/shopping/:id', async (request) => {
      const entry = recipes.get(request.params.id ?? '');
      if (!entry || !existsSync(entry.file)) return Response.json({ error: 'Rezept nicht gefunden.' }, { status: 404 });
      const body = (request.body ?? {}) as { amount?: unknown; names?: unknown };
      const names = Array.isArray(body.names) ? body.names.filter((name): name is string => typeof name === 'string') : undefined;
      try {
        return Response.json(await shop(entry, typeof body.amount === 'number' ? body.amount : undefined, names));
      } catch (error) {
        if (error instanceof InvalidInput) return Response.json({ error: error.message }, { status: 400 });
        throw error;
      }
    });

    context.actions.register(
      {
        name: 'recipes.cook',
        description: 'Merkt ein Rezept als „wird gerade gekocht“ vor: Es bleibt auf der Anzeige stehen, bis es fertig gemeldet wird.',
        params: { recipe: { type: 'string', description: 'Kennung oder Titel des Rezepts; vom Titel genügt ein eindeutiger Teil', required: true } },
      },
      ({ recipe }) => {
        const entry = find(recipe);
        setCooking({ id: entry.id, since: Date.now() });
        log.info(`Wird gekocht: ${entry.title}`);
        return { recipe: entry.title };
      },
    );
    context.actions.register({ name: 'recipes.finish', description: 'Meldet das Kochen als beendet: Die Anzeige zeigt wieder wechselnde Rezepte.' }, () => setCooking(undefined));

    // Änderungen im Ordner kommen oft in Schüben; gelesen wird, wenn Ruhe eingekehrt ist.
    let settle: NodeJS.Timeout | undefined;
    const rescan = () => {
      clearTimeout(settle);
      settle = setTimeout(scan, SETTLE_MS);
    };
    try {
      const watcher = watch(folder, { recursive: true }, rescan);
      watcher.on('error', () => undefined);
      context.signal.addEventListener('abort', () => watcher.close());
    } catch {
      // Wo das System den Ordner nicht beobachten kann, wird er regelmäßig neu gelesen.
      const timer = setInterval(scan, POLL_MS);
      context.signal.addEventListener('abort', () => clearInterval(timer));
    }
    context.signal.addEventListener('abort', () => clearTimeout(settle));

    context.routes.get('/text/:id', (request) => {
      const entry = recipes.get(request.params.id ?? '');
      if (!entry || !existsSync(entry.file)) return Response.json({ error: 'Rezept nicht gefunden.' }, { status: 404 });
      const { problem: _problem, ...recipe } = parseRecipe(entry.file, readFileSync(entry.file, 'utf8'));
      return Response.json({ ...recipe, id: entry.id, ...(recipe.category || !entry.category ? {} : { category: entry.category }) });
    });

    // Bilder, auf die ein Rezept verweist – gesucht wird vom Ordner des Rezepts aus, nie außerhalb des Rezeptordners.
    context.routes.get('/file/:id/*', (request) => {
      const entry = recipes.get(request.params.id ?? '');
      const wanted = request.params['*'] ?? '';
      const file = entry && wanted ? inside(folder, relative(folder, dirname(entry.file)), wanted) : undefined;
      const contentType = file ? IMAGE_TYPES[extname(file).toLowerCase()] : undefined;
      if (!file || !contentType || !existsSync(file) || !statSync(file).isFile()) return Response.json({ error: 'Bild nicht gefunden.' }, { status: 404 });
      return new Response(new Uint8Array(readFileSync(file)), { headers: { 'Content-Type': contentType, 'Cache-Control': 'private, max-age=3600' } });
    });

    // Neue Rezepte: Eine Webadresse, ein Text oder eine Datei geht an das Sprachmodell und kommt als
    // Rezept in den Ordner zurück. Der Schlüssel dafür steht bei den Zugangsdaten der Instanz.
    const apiKey = context.secrets.get('anthropicApiKey') ?? process.env['ANTHROPIC_API_KEY'];
    context.datapoints.set({ id: 'importReady', value: !!apiKey, label: 'Neue Rezepte lassen sich umwandeln' });
    let importing = false;
    context.routes.post('/import', async (request) => {
      const refuse = (status: number, error: string) => Response.json({ error }, { status });
      let input;
      try {
        input = importInput(request);
      } catch (error) {
        if (error instanceof ImportRefused) return refuse(400, error.message);
        throw error;
      }
      if (!apiKey) return refuse(503, 'Für das Umwandeln fehlt der Schlüssel der Claude-API (in secrets.json: "anthropicApiKey" bei dieser Instanz).');
      // Das Werkzeug samt Anbindung an die Claude-API wird erst geladen, wenn jemand ein Rezept hinzufügt
      const { convertRecipe, explainError, saveRecipe } = await import('@culinola/recipe-import');
      if (importing) return refuse(429, 'Es wird gerade ein anderes Rezept umgewandelt.');
      importing = true;
      try {
        const language = context.config.importLanguage ?? 'de';
        const result = await convertRecipe(input, { apiKey, language, signal: request.signal, ...(context.config.importModel ? { model: context.config.importModel } : {}) });
        if (!result.recipes.length) return refuse(422, 'In der Vorlage wurde kein Rezept gefunden.');
        const saved = result.recipes.map((converted) => saveRecipe(folder, converted, language));
        scan();
        log.info(`Rezept hinzugefügt: ${saved.map((entry) => entry.file).join(', ')} (${result.usage.inputTokens} Eingabe- und ${result.usage.outputTokens} Ausgabe-Token)`);
        const added = saved.map((entry) => ({ title: entry.title, id: [...recipes.values()].find((known) => known.file === join(folder, entry.file))?.id }));
        return Response.json({ recipes: added, warnings: result.warnings });
      } catch (error) {
        const { reason, message } = explainError(error);
        log.warn(`Rezept nicht umgewandelt: ${message}`);
        return refuse(statusOf(reason), message);
      } finally {
        importing = false;
      }
    });
  },
});
