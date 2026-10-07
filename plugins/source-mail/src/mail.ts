/** Eine Nachricht in der Liste. */
export interface MailEntry {
  /** Kennung des Kontos aus der Konfiguration. */
  account: string;
  /** Nummer der Nachricht im Postfach. */
  uid: number;
  from: string;
  subject: string;
  /** Zeitpunkt des Eingangs, ISO 8601. */
  date: string;
  unread: boolean;
  attachments: boolean;
  size: number;
}

/** Teil einer Nachricht, wie ihn der Mailserver im Aufbau der Nachricht beschreibt. */
export interface StructureNode {
  type?: string;
  disposition?: string;
  parameters?: Record<string, string>;
  dispositionParameters?: Record<string, string>;
  id?: string;
  childNodes?: StructureNode[];
}

export interface Address {
  name?: string;
  address?: string;
}

/**
 * Ob eine Nachricht Anlagen hat. Bilder, die im Text selbst stehen, zählen nicht dazu –
 * ebenso wenig die Signaturen und Kalenderhinweise, die Mailprogramme mitschicken.
 */
export function hasAttachments(node: StructureNode | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(hasAttachments);
  const type = (node.type ?? '').toLowerCase();
  const disposition = (node.disposition ?? '').toLowerCase();
  const named = !!(node.dispositionParameters?.filename ?? node.parameters?.name);
  if (disposition === 'attachment') return !/^application\/(pgp-signature|pkcs7-signature|x-pkcs7-signature)$/.test(type);
  if (disposition === 'inline' && node.id) return false;
  return named && !type.startsWith('text/') && !type.startsWith('multipart/') && !(type.startsWith('image/') && !!node.id);
}

/** Absender für die Liste: der Name, sonst die Adresse. */
export function senderOf(from: readonly Address[] | undefined): string {
  const first = from?.[0];
  return first?.name?.trim() || first?.address?.trim() || '';
}

/** Alle Konten zusammen, das Neueste zuerst. */
export function newestFirst(entries: readonly MailEntry[], limit: number): MailEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.uid - a.uid).slice(0, limit);
}

/**
 * Rahmen für den HTML-Text einer Nachricht. Er verbietet alles, was eine Nachricht nicht
 * braucht und was dem Absender etwas verraten würde: Skripte, Formulare und jedes Nachladen
 * von außen – auch der unsichtbaren Zählbilder. Bilder, die in der Nachricht selbst stecken, bleiben.
 * Die Anzeige legt das Ganze zusätzlich in einen abgeschotteten Rahmen.
 */
export function mailDocument(html: string): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`,
    '<base target="_blank">',
    '<style>html{color-scheme:light}body{margin:16px;font-family:system-ui,sans-serif;font-size:18px;line-height:1.45;color:#14202b;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>',
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
}
