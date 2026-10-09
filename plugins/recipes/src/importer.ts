import type { PluginRequest } from '@culinola/sdk';

/** Woraus ein Rezept werden soll: eine Webadresse, eingefügter Text oder eine hochgeladene Datei. */
export type ImportInput = { url: string } | { text: string } | { data: Uint8Array; name: string };

/** Der Aufruf selbst passt nicht – der Aufrufer bekommt die Meldung als seinen Fehler zurück. */
export class ImportRefused extends Error {}

const MAX_URL_CHARS = 2000;
const MAX_NAME_CHARS = 120;

/**
 * Liest aus einem Aufruf, was umgewandelt werden soll. Eine Datei kommt als rohe Bytes, ihr Name
 * als Adresszusatz `name`; Webadresse und Text kommen als JSON (`{ "url": … }` oder `{ "text": … }`).
 */
export function importInput(request: Pick<PluginRequest, 'body' | 'query'>): ImportInput {
  const { body } = request;
  if (body instanceof Uint8Array) {
    if (!body.length) throw new ImportRefused('Die Datei ist leer.');
    // Vom Namen zählt nur die Endung, an der sich die Art der Datei erkennen lässt – Pfade fallen weg
    const name = (request.query['name'] ?? '').split(/[\\/]/).pop()!.trim().slice(-MAX_NAME_CHARS);
    return { data: body, name: name || 'Vorlage' };
  }
  const given = (body ?? {}) as { url?: unknown; text?: unknown };
  if (typeof given.url === 'string' && given.url.trim()) {
    const url = given.url.trim();
    if (url.length > MAX_URL_CHARS || !/^https?:\/\/\S+$/i.test(url)) throw new ImportRefused('Die Webadresse muss mit http:// oder https:// beginnen.');
    return { url };
  }
  if (typeof given.text === 'string' && given.text.trim()) return { text: given.text };
  throw new ImportRefused('Es fehlt eine Webadresse, ein Text oder eine Datei.');
}

/** HTTP-Status zu einem Grund, aus dem die Umwandlung scheiterte. */
export function statusOf(reason: 'access' | 'busy' | 'empty' | 'model' | 'source'): number {
  // 422: Die Vorlage ist angekommen, es lässt sich nur kein Rezept daraus machen
  return reason === 'access' || reason === 'busy' ? 503 : reason === 'model' ? 502 : 422;
}
