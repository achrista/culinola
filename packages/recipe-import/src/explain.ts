import Anthropic from '@anthropic-ai/sdk';
import { ConversionError } from './convert.ts';
import { EmptySourceError } from './source.ts';

export interface Explanation {
  /**
   * Woran es lag: `access` – der Zugang zur Claude-API fehlt oder reicht nicht; `busy` – die API ist
   * gerade nicht erreichbar oder ausgelastet; `empty` – die Vorlage enthält nichts Lesbares;
   * `model` – das Modell lieferte nichts Verwertbares; `source` – die Vorlage ließ sich nicht lesen.
   */
  reason: 'access' | 'busy' | 'empty' | 'model' | 'source';
  message: string;
}

/** Ordnet einen Fehler der Umwandlung ein und sagt in einem Satz, was zu tun ist. */
export function explainError(error: unknown): Explanation {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof EmptySourceError) return { reason: 'empty', message: detail };
  if (error instanceof ConversionError) return { reason: 'model', message: detail };
  if (error instanceof Anthropic.APIError) {
    const { status } = error;
    if (status === 401 || status === 403) return { reason: 'access', message: 'Die Claude-API lehnt den hinterlegten Schlüssel ab.' };
    if (status === 400 && /credit balance/i.test(detail)) return { reason: 'access', message: 'Das Guthaben für die Claude-API ist aufgebraucht.' };
    if (status === 429) return { reason: 'busy', message: 'Die Claude-API nimmt gerade keine weiteren Anfragen an. Bitte später noch einmal versuchen.' };
    if (status === undefined || status >= 500) return { reason: 'busy', message: 'Die Claude-API ist gerade nicht erreichbar. Bitte später noch einmal versuchen.' };
    if (status === 413) return { reason: 'source', message: 'Die Vorlage ist für die Claude-API zu groß.' };
    return { reason: 'model', message: `Die Claude-API hat die Anfrage abgelehnt: ${detail}` };
  }
  return { reason: 'source', message: detail };
}
