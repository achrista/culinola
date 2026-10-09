import { definePlugin } from '@culinola/sdk';
import { ask, DEFAULT_MODEL, explain } from './assistant.ts';

interface Config {
  /** Sprachmodell, das den Satz den Aktionen zuordnet. */
  model: string;
  /** Sprache der Antworten: de, en oder fr. */
  language: string;
}

const MAX_TEXT_CHARS = 500;
const TIMEOUT_MS = 30_000;

/**
 * Sprachsteuerung. Die Anzeige schickt den Satz, den der Browser verstanden hat; ein Sprachmodell
 * ordnet ihn den Aktionen zu, die die anderen Plugins angemeldet haben – Eieruhr, Radio, Listen,
 * Rezepte –, führt sie aus und antwortet in einem Satz, den die Anzeige vorliest. Was heikel ist
 * (`sensitive`), lässt sich so nicht auslösen.
 */
export default definePlugin<Config>({
  id: 'voice',

  parseConfig(raw) {
    const config = raw as { model?: unknown; language?: unknown };
    const model = config.model ?? DEFAULT_MODEL;
    if (typeof model !== 'string' || !model) throw new Error('"model" muss die Kennung eines Sprachmodells sein.');
    const language = config.language ?? 'de';
    if (typeof language !== 'string' || !['de', 'en', 'fr'].includes(language)) throw new Error('"language" muss de, en oder fr sein.');
    return { model, language };
  },

  start(context) {
    const { log, config } = context;
    const apiKey = context.secrets.get('anthropicApiKey') ?? process.env['ANTHROPIC_API_KEY'];
    context.datapoints.set({ id: 'ready', value: !!apiKey, label: 'Sprachsteuerung eingerichtet' });
    if (!apiKey) log.warn(`Für die Sprachsteuerung fehlt der Schlüssel der Claude-API: { "${context.instanceId}": { "anthropicApiKey": "…" } } in secrets.json.`);

    context.routes.post('/ask', async (request) => {
      const refuse = (status: number, error: string) => Response.json({ error }, { status });
      const text = typeof (request.body as { text?: unknown } | null)?.text === 'string' ? (request.body as { text: string }).text.replace(/\s+/g, ' ').trim() : '';
      if (!text) return refuse(400, 'Es fehlt der Satz ("text").');
      if (text.length > MAX_TEXT_CHARS) return refuse(400, `Der Satz ist länger als ${MAX_TEXT_CHARS} Zeichen.`);
      if (!apiKey) return refuse(503, 'Die Sprachsteuerung ist nicht eingerichtet: In secrets.json fehlt der Schlüssel der Claude-API.');

      // Die Anbindung an die Claude-API wird erst geladen, wenn jemand spricht
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      try {
        const answer = await ask(text, {
          client: new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS }),
          model: config.model,
          language: config.language,
          // Die Sprachsteuerung steuert die anderen, nicht sich selbst
          actions: context.actions.list().filter((action) => !action.name.startsWith(`${context.instanceId}.`)),
          run: (name, params) => context.actions.run(name, params),
          signal: request.signal,
        });
        // Ins Protokoll kommt, was ausgelöst wurde – nicht, was gesagt wurde
        log.info(`Sprache: ${answer.actions.map((entry) => `${entry.action}${entry.ok ? '' : ' (gescheitert)'}`).join(', ') || 'keine Aktion'}`);
        return Response.json(answer);
      } catch (error) {
        const { status, message } = explain(error);
        log.warn(`Sprachsteuerung: ${message}`);
        return refuse(status, message);
      }
    });
  },
});
