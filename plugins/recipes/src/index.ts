import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { definePlugin, InvalidInput } from '@culinola/sdk';
import { ImportRefused, importInput, statusOf } from './importer.ts';
import { inside, parseRecipe, recipeId, type RecipeInfo } from './library.ts';

interface Config {
  /** Ordner mit den Rezepten; ohne Angabe der eigene Ordner der Instanz im Datenordner. */
  folder?: string;
  /** Sprache, in der neue Rezepte geschrieben werden: de, en oder fr. */
  importLanguage?: string;
  /** Sprachmodell für das Umwandeln neuer Rezepte; ohne Angabe das des Import-Werkzeugs. */
  importModel?: string;
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

  parseConfig(raw) {
    const config = raw as { folder?: unknown; importLanguage?: unknown; importModel?: unknown };
    if (config.folder !== undefined && (typeof config.folder !== 'string' || !config.folder)) throw new Error('"folder" muss ein Ordnerpfad sein.');
    if (config.importLanguage !== undefined && !['de', 'en', 'fr'].includes(config.importLanguage as string)) throw new Error('"importLanguage" muss de, en oder fr sein.');
    if (config.importModel !== undefined && (typeof config.importModel !== 'string' || !config.importModel)) throw new Error('"importModel" muss die Kennung eines Sprachmodells sein.');
    return {
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
        log.warn(`Vermerk zum Kochen nicht speicherbar: ${error instanceof Error ? error.message : String(error)}`);
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
          if (!reported.has(way)) log.warn(`Rezept "${way}" nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
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

    context.actions.register(
      {
        name: 'recipes.cook',
        description: 'Merkt ein Rezept als „wird gerade gekocht“ vor: Es bleibt auf der Anzeige stehen, bis es fertig gemeldet wird.',
        params: { recipe: { type: 'string', description: 'Kennung oder Titel des Rezepts; vom Titel genügt ein eindeutiger Teil', required: true } },
      },
      ({ recipe }) => {
        const wanted = String(recipe).trim().toLowerCase();
        const all = [...recipes.values()];
        const named = all.filter((known) => known.title.toLowerCase() === wanted);
        const similar = named.length ? named : all.filter((known) => wanted.length >= 3 && known.title.toLowerCase().includes(wanted));
        const entry = recipes.get(String(recipe)) ?? (similar.length === 1 ? similar[0] : undefined);
        if (!entry) throw new InvalidInput(similar.length > 1 ? `"${String(recipe)}" passt auf mehrere Rezepte: ${similar.slice(0, 5).map((known) => known.title).join(', ')}.` : `Das Rezept "${String(recipe)}" gibt es nicht.`);
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
