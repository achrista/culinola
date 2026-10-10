import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { definePlugin } from '@culinola/sdk';
import { ask, DEFAULT_MODEL, explain } from './assistant.ts';
import { knownValues, readValues, valuesTool } from './values.ts';

interface Config {
  /** Sprachmodell, das den Satz den Aktionen zuordnet. */
  model: string;
  /** Sprache der Antworten: de, en oder fr. */
  language: string;
  /** Werte, nach denen man zusätzlich fragen kann – oder die anders heißen sollen als auf der Anzeige. */
  values: { id: string; name?: string }[];
  /** Ob man nach allem fragen kann, was auf den Anzeigen steht. */
  layoutValues: boolean;
}

const DATAPOINT_ID = /^[a-z][a-z0-9-]*:[\w.-]+$/;
const REGIONS: Record<string, string> = { de: 'de-DE', en: 'en-GB', fr: 'fr-FR' };
const MAX_TEXT_CHARS = 500;
const MAX_HISTORY = 3;
const TIMEOUT_MS = 30_000;

/**
 * Sprachsteuerung. Die Anzeige schickt den Satz, den der Browser verstanden hat; ein Sprachmodell
 * ordnet ihn den Aktionen zu, die die anderen Plugins angemeldet haben – Eieruhr, Radio, Listen,
 * Rezepte –, führt sie aus und antwortet in einem Satz, den die Anzeige vorliest. Was heikel ist
 * (`sensitive`), lässt sich so nicht auslösen. Fragen nach Werten – „Wie warm ist es draußen?“ –
 * beantwortet es aus dem, was auf den Anzeigen steht.
 */
export default definePlugin<Config>({
  id: 'voice',

  parseConfig(raw) {
    const config = raw as { model?: unknown; language?: unknown; values?: unknown; layoutValues?: unknown };
    const model = config.model ?? DEFAULT_MODEL;
    if (typeof model !== 'string' || !model) throw new Error('"model" muss die Kennung eines Sprachmodells sein.');
    const language = config.language ?? 'de';
    if (typeof language !== 'string' || !['de', 'en', 'fr'].includes(language)) throw new Error('"language" muss de, en oder fr sein.');
    if (config.layoutValues !== undefined && typeof config.layoutValues !== 'boolean') throw new Error('"layoutValues" muss true oder false sein.');
    if (config.values !== undefined && !Array.isArray(config.values)) throw new Error('"values" muss eine Liste von Datenpunkten sein.');
    const values = ((config.values as unknown[] | undefined) ?? []).map((entry) => {
      const wish = (typeof entry === 'string' ? { datapoint: entry } : (entry ?? {})) as { datapoint?: unknown; name?: unknown };
      if (typeof wish.datapoint !== 'string' || !DATAPOINT_ID.test(wish.datapoint) || (wish.name !== undefined && (typeof wish.name !== 'string' || !wish.name.trim()))) {
        throw new Error('Ein Eintrag in "values" ist ein Datenpunkt ("openhab:Mess_TAussen") oder { "datapoint": …, "name": "Außentemperatur" }.');
      }
      return { id: wish.datapoint, ...(typeof wish.name === 'string' ? { name: wish.name.trim() } : {}) };
    });
    return { model, language, values, layoutValues: config.layoutValues !== false };
  },

  start(context) {
    const { log, config } = context;
    const apiKey = context.secrets.get('anthropicApiKey') ?? process.env['ANTHROPIC_API_KEY'];
    context.datapoints.set({ id: 'ready', value: !!apiKey, label: 'Sprachsteuerung eingerichtet' });
    if (!apiKey) log.warn(`Für die Sprachsteuerung fehlt der Schlüssel der Claude-API: { "${context.instanceId}": { "anthropicApiKey": "…" } } in secrets.json.`);

    // Aktivierungswort: Das Sprachmodell dafür läuft im Browser der Anzeige; hier liegt nur seine Datei.
    // Sie wird nicht mitgeliefert – wer das Aktivierungswort nutzen will, legt sie in den Ordner der Instanz.
    const modelFile = join(context.storageDir, 'model.tar.gz');
    context.datapoints.set({ id: 'model', value: existsSync(modelFile), label: 'Sprachmodell für das Aktivierungswort vorhanden' });
    context.routes.get('/model', () => {
      if (!existsSync(modelFile)) return Response.json({ error: 'Es ist kein Sprachmodell hinterlegt.' }, { status: 404 });
      return new Response(Readable.toWeb(createReadStream(modelFile)) as ReadableStream, {
        headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(statSync(modelFile).size), 'Cache-Control': 'private, max-age=604800' },
      });
    });

    context.routes.post('/ask', async (request) => {
      const refuse = (status: number, error: string) => Response.json({ error }, { status });
      const text = typeof (request.body as { text?: unknown } | null)?.text === 'string' ? (request.body as { text: string }).text.replace(/\s+/g, ' ').trim() : '';
      if (!text) return refuse(400, 'Es fehlt der Satz ("text").');
      if (text.length > MAX_TEXT_CHARS) return refuse(400, `Der Satz ist länger als ${MAX_TEXT_CHARS} Zeichen.`);
      // Der vorige Wortwechsel, wenn die Anzeige nachfragt oder jemand wiederholt
      const given = (request.body as { history?: unknown }).history;
      const history = (Array.isArray(given) ? given : [])
        .filter((turn): turn is { text: string; reply: string } => typeof turn?.text === 'string' && typeof turn?.reply === 'string' && !!turn.text.trim() && !!turn.reply.trim())
        .slice(-MAX_HISTORY)
        .map((turn) => ({ text: turn.text.slice(0, MAX_TEXT_CHARS), reply: turn.reply.slice(0, MAX_TEXT_CHARS) }));
      if (!apiKey) return refuse(503, 'Die Sprachsteuerung ist nicht eingerichtet: In secrets.json fehlt der Schlüssel der Claude-API.');

      // Die Anbindung an die Claude-API wird erst geladen, wenn jemand spricht
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      // Wonach man fragen kann: was auf den Anzeigen steht und was eigens genannt ist. Gelesen wird ein Wert erst,
      // wenn das Sprachmodell danach fragt – so verlässt nur das Haus, was die Antwort braucht.
      const known = knownValues(config.values, config.layoutValues ? context.datapoints.shown() : [], context.datapoints.list());
      const tool = valuesTool(known);
      try {
        const answer = await ask(text, {
          client: new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS }),
          model: config.model,
          language: config.language,
          history,
          // Die Sprachsteuerung steuert die anderen, nicht sich selbst
          actions: context.actions.list().filter((action) => !action.name.startsWith(`${context.instanceId}.`)),
          run: (name, params) => context.actions.run(name, params),
          ...(tool ? { values: { tool, read: (names) => readValues(known, names, context.datapoints.list(), { region: REGIONS[config.language] ?? 'de-DE' }) } } : {}),
          signal: request.signal,
        });
        // Ins Protokoll kommt, was ausgelöst wurde – nicht, was gesagt wurde
        const did = [...answer.actions.map((entry) => `${entry.action}${entry.ok ? '' : ' (gescheitert)'}`), ...(answer.values.length ? [`Werte gelesen (${answer.values.join(', ')})`] : [])];
        log.info(`Sprache: ${did.join(', ') || 'keine Aktion'}`);
        return Response.json(answer);
      } catch (error) {
        const { status, message } = explain(error);
        log.warn(`Sprachsteuerung: ${message}`);
        return refuse(status, message);
      }
    });
  },
});
