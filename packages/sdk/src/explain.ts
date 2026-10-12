/**
 * Sagt, woran ein Netzaufruf gescheitert ist. Node meldet nur „fetch failed“ und nennt die Ursache dahinter –
 * wer eine Quelle einrichtet, braucht aber genau die: falsche Adresse, falscher Port, Gerät aus.
 */
export function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = (error as { cause?: { code?: string; message?: string; hostname?: string; address?: string; port?: number } } | null)?.cause;
  if (!cause) return message;
  const where = cause.address ? ` (${cause.address}${cause.port ? `:${cause.port}` : ''})` : cause.hostname ? ` (${cause.hostname})` : '';
  const known: Record<string, string> = {
    ECONNREFUSED: `Verbindung abgelehnt${where} – unter dieser Adresse und diesem Port antwortet nichts.`,
    ENOTFOUND: `Der Name ist unbekannt${where} – Schreibweise prüfen oder die IP-Adresse eintragen.`,
    EAI_AGAIN: `Der Name lässt sich gerade nicht auflösen${where}.`,
    ETIMEDOUT: `Keine Antwort${where} – ist das Gerät eingeschaltet und im selben Netz?`,
    UND_ERR_CONNECT_TIMEOUT: `Keine Antwort${where} – ist das Gerät eingeschaltet und im selben Netz?`,
    EHOSTUNREACH: `Der Rechner ist nicht erreichbar${where}.`,
    ECONNRESET: `Die Verbindung wurde von der Gegenseite beendet${where}.`,
  };
  const detail = (cause.code && known[cause.code]) || cause.message || cause.code;
  return detail && detail !== message ? `${message}: ${detail}` : message;
}
