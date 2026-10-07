import type { AddressObject, ParsedMail } from 'mailparser';
import { mailDocument } from './mail.ts';
import { rtfToText } from './rtf.ts';

/** Eine Nachricht zum Lesen: Kopfangaben, Text und die Namen der Anlagen – nicht die Anlagen selbst. */
export interface ReadableMessage {
  subject: string;
  from: string;
  to: string;
  /** Zeitpunkt, ISO 8601. */
  date: string;
  /** Vollständige, entschärfte HTML-Seite, wenn die Nachricht HTML enthält. */
  html?: string;
  text: string;
  attachments: { name: string; size: number }[];
}

const people = (field: AddressObject | AddressObject[] | undefined) => (Array.isArray(field) ? field : field ? [field] : []).map((entry) => entry.text).join(', ');

/** Bereitet eine zerlegte Nachricht für die Anzeige auf. */
export function readableMessage(mail: ParsedMail, fallbackDate: string): ReadableMessage {
  // Manche Programme schicken den Text nur im Rich-Text-Format. Dann steht er als Beilage da und wird hier zum Text der Nachricht.
  const rich = mail.html || mail.text?.trim() ? undefined : mail.attachments.find((entry) => /^(text|application)\/(rtf|richtext)$/i.test(entry.contentType) || /\.rtf$/i.test(entry.filename ?? ''));
  return {
    subject: mail.subject ?? '',
    from: mail.from?.text ?? '',
    to: people(mail.to),
    date: (mail.date ?? new Date(fallbackDate)).toISOString(),
    ...(mail.html ? { html: mailDocument(mail.html) } : {}),
    text: rich ? rtfToText(rich.content.toString('latin1')) : (mail.text ?? ''),
    // Bilder im Text sind keine Anlagen
    attachments: mail.attachments.filter((entry) => !entry.related && entry !== rich).map((entry) => ({ name: entry.filename ?? entry.contentType, size: entry.size })),
  };
}
