import Anthropic from '@anthropic-ai/sdk';
import type { ActionDefinition } from '@culinola/sdk';
import { VALUES_TOOL } from './values.ts';

/** Schnell und günstig – für einen Satz, der einer Aktion zugeordnet wird, reicht das kleine Modell. */
export const DEFAULT_MODEL = 'claude-haiku-5-5';

/** So oft darf das Modell hintereinander Aktionen auslösen, bevor es antworten muss. */
const MAX_ROUNDS = 4;
const MAX_REPLY_CHARS = 400;

export interface Done {
  action: string;
  params: Record<string, unknown>;
  ok: boolean;
  /** Warum die Aktion scheiterte. */
  error?: string;
}

export interface Answer {
  /** Ein kurzer Satz zum Vorlesen. */
  reply: string;
  /** Was dabei ausgelöst wurde. */
  actions: Done[];
  /** Die Werte aus dem Haus, die für die Antwort gelesen wurden – ihre Namen, nicht ihr Stand. */
  values: string[];
}

export interface AskOptions {
  client: Pick<Anthropic, 'messages'>;
  model?: string;
  /** Die Aktionen, die per Sprache auslösbar sind. */
  actions: ActionDefinition[];
  run(name: string, params: Record<string, unknown>): Promise<unknown>;
  /** Werte aus dem Haus, nach denen man fragen kann: das Werkzeug dafür und das Lesen selbst. */
  values?: { tool: Anthropic.Tool; read(names: string[]): string };
  /** Sprache der Antwort: de, en oder fr. */
  language?: string;
  /** Was unmittelbar davor gesagt und geantwortet wurde – für Rückfragen und Wiederholungen. */
  history?: { text: string; reply: string }[];
  now?: Date;
  signal?: AbortSignal;
}

/** Namen von Werkzeugen dürfen keinen Punkt enthalten: aus "timer.start" wird "timer__start". */
export function toolName(action: string): string {
  return action.replace(/\./g, '__');
}

/** Bietet die Aktionen dem Sprachmodell als Werkzeuge an. Heikle Aktionen bleiben draußen. */
export function toolsFromActions(actions: ActionDefinition[]): Anthropic.Tool[] {
  return actions
    .filter((action) => !action.sensitive)
    .map((action) => {
      const params = Object.entries(action.params ?? {});
      return {
        name: toolName(action.name),
        description: action.description,
        input_schema: {
          type: 'object' as const,
          properties: Object.fromEntries(params.map(([name, param]) => [name, { type: param.type, description: param.description }])),
          required: params.filter(([, param]) => param.required).map(([name]) => name),
        },
      };
    });
}

const LANGUAGES: Record<string, { name: string; region: string; lost: string; refused: string }> = {
  de: { name: 'Deutsch', region: 'de-DE', lost: 'Das war mir zu verwickelt. Bitte noch einmal in einem Satz.', refused: 'Dabei kann ich nicht helfen.' },
  en: { name: 'Englisch', region: 'en-GB', lost: 'That was too involved. Please say it again in one sentence.', refused: 'I cannot help with that.' },
  fr: { name: 'Französisch', region: 'fr-FR', lost: 'C’était trop compliqué. Répétez en une phrase, s’il vous plaît.', refused: 'Je ne peux pas vous aider pour cela.' },
};

const VALUES_HINT = `
Fragt jemand nach einem Wert im Haus – wie warm es ist, wie viel Strom fließt, wer zu Hause ist, wann die Sonne untergeht –, lies ihn mit dem Werkzeug ${VALUES_TOOL} und nenne ihn so, wie man es am Küchentisch sagt: gerundet, mit ausgeschriebener Einheit („gut zwölf Grad“, „knapp drei Kilowatt“, „um zwanzig vor sieben“). Nenne nur, wonach gefragt wurde. Hat ein Wert keinen Stand oder ist er veraltet, sag das dazu; gibt es ihn nicht, sag, dass du ihn nicht kennst.
`;

function instructions(language: string, now: Date, values: boolean): string {
  const words = LANGUAGES[language] ?? LANGUAGES['de']!;
  const when = new Intl.DateTimeFormat(words.region, { dateStyle: 'full', timeStyle: 'short' }).format(now);
  return `Du bist die Sprachsteuerung von Culinola, einer Anzeige in der Küche einer Familie. Jemand hat einen kurzen Satz gesprochen; eine Spracherkennung hat ihn in Text umgesetzt und dabei vielleicht Wörter falsch verstanden – deute sie so, wie sie in einer Küche gemeint sein dürften.

Führe aus, was gewünscht ist, mit den Werkzeugen, die dir zur Verfügung stehen. Nennt der Satz mehrere Dinge – etwa drei Sachen für die Einkaufsliste –, rufe das Werkzeug für jedes einzeln auf. Rate keine Angaben, die fehlen: Frag dann in einem Satz nach, statt etwas auszulösen.

Stehen frühere Sätze im Gespräch, ist der letzte eine Antwort auf deine Rückfrage oder eine Wiederholung, weil du etwas nicht verstanden hast – nimm beides zusammen.

Antworte danach mit einem einzigen kurzen Satz auf ${words.name}, der vorgelesen wird: ohne Aufzählung, ohne Sonderzeichen, ohne Kennungen oder Fachwörter. Sag, was du getan hast („Die Eieruhr läuft, acht Minuten.“), oder was nicht ging. Behaupte nichts, was die Werkzeuge nicht bestätigt haben. Passt kein Werkzeug, sag in einem Satz, dass du das nicht kannst, und nenne ein oder zwei Dinge, die gehen.
${values ? VALUES_HINT : ''}
Jetzt ist ${when}.`;
}

/** Was vorgelesen wird, enthält keine Auszeichnung und bleibt kurz. */
function spoken(text: string): string {
  const plain = text
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > MAX_REPLY_CHARS ? `${plain.slice(0, MAX_REPLY_CHARS - 1)}…` : plain;
}

/**
 * Ordnet einen Satz den Aktionen zu, führt sie aus und liefert die Antwort zum Vorlesen.
 * Fehler der Claude-API (Anthropic.APIError) reichen durch.
 */
export async function ask(text: string, options: AskOptions): Promise<Answer> {
  const language = options.language ?? 'de';
  const words = LANGUAGES[language] ?? LANGUAGES['de']!;
  const tools = [...toolsFromActions(options.actions), ...(options.values ? [options.values.tool] : [])];
  const read: string[] = [];
  const actionOf = new Map(options.actions.map((action) => [toolName(action.name), action.name]));
  const done: Done[] = [];
  const messages: Anthropic.MessageParam[] = [
    ...(options.history ?? []).flatMap((turn): Anthropic.MessageParam[] => [
      { role: 'user', content: turn.text },
      { role: 'assistant', content: turn.reply },
    ]),
    { role: 'user', content: text },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await options.client.messages.create(
      {
        model: options.model ?? DEFAULT_MODEL,
        max_tokens: 4000,
        system: instructions(language, options.now ?? new Date(), !!options.values),
        tools,
        messages,
        // Ein Satz, eine Aktion: Hier zählt die kurze Wartezeit mehr als langes Abwägen
        output_config: { effort: 'low' },
      },
      options.signal ? { signal: options.signal } : undefined,
    );
    // Eine abgelehnte Antwort kann ein Werkzeug mitten im Aufruf abschneiden – dann wird nichts davon ausgeführt
    if (response.stop_reason === 'refusal') return { reply: words.refused, actions: done, values: read };

    const uses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !uses.length) {
      const reply = spoken(response.content.map((block) => (block.type === 'text' ? block.text : '')).join(' '));
      return { reply: reply || words.lost, actions: done, values: read };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const action = actionOf.get(use.name);
      const params = (use.input ?? {}) as Record<string, unknown>;
      if (options.values && use.name === VALUES_TOOL) {
        // Werte lesen löst nichts aus – es steht deshalb nicht bei den Aktionen
        const names = (Array.isArray(params['names']) ? params['names'] : []).filter((name): name is string => typeof name === 'string');
        read.push(...names.filter((name) => !read.includes(name)));
        results.push({ type: 'tool_result', tool_use_id: use.id, content: options.values.read(names) });
        continue;
      }
      try {
        if (!action) throw new Error(`Das Werkzeug "${use.name}" gibt es nicht.`);
        const result = await options.run(action, params);
        done.push({ action, params, ok: true });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: result === undefined || result === null ? 'erledigt' : JSON.stringify(result) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        done.push({ action: action ?? use.name, params, ok: false, error: message });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: message, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: words.lost, actions: done, values: read };
}

/** Sagt in einem Satz, warum die Sprachsteuerung gerade nicht antworten kann. */
export function explain(error: unknown): { status: number; message: string } {
  if (error instanceof Anthropic.APIError) {
    const { status } = error;
    if (status === 401 || status === 403) return { status: 503, message: 'Die Claude-API lehnt den hinterlegten Schlüssel ab.' };
    if (status === 400 && /credit balance/i.test(error.message)) return { status: 503, message: 'Das Guthaben für die Claude-API ist aufgebraucht.' };
    if (status === 429 || status === undefined || status >= 500) return { status: 503, message: 'Die Claude-API ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.' };
    return { status: 502, message: `Die Claude-API hat die Anfrage abgelehnt: ${error.message}` };
  }
  return { status: 500, message: error instanceof Error ? error.message : String(error) };
}
