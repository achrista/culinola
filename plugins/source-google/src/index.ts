import { definePlugin } from '@culinola/sdk';
import { AccessTokens, LoginRequired, readClient, readToken } from './auth.ts';

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  accessRole?: string;
}

/**
 * Anbindung an ein Google-Konto. Dieser erste Stand prüft die Anmeldung und nennt die
 * Kalender des Kontos; Termine und Erinnerungen aus den Kontakten bauen darauf auf.
 */
export default definePlugin({
  id: 'source-google',

  async start(context) {
    const { log } = context;
    context.resources.set('calendars', []);
    try {
      const tokens = new AccessTokens(readClient(context.storageDir), readToken(context.storageDir).refreshToken);
      const response = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,summaryOverride,primary,accessRole)', {
        headers: { Authorization: `Bearer ${await tokens.get()}` },
        signal: AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw new Error(`Google antwortet mit ${response.status}. Ist die Calendar API im Projekt eingeschaltet?`);
      const { items = [] } = (await response.json()) as { items?: CalendarListEntry[] };
      const calendars = items.map((entry) => ({ id: entry.id, name: entry.summaryOverride ?? entry.summary ?? entry.id, primary: entry.primary === true, access: entry.accessRole ?? '' }));
      context.resources.set('calendars', calendars);
      context.datapoints.set({ id: 'state', value: 'angemeldet', label: 'Google: Anmeldung' });
      log.info(`Bei Google angemeldet, ${calendars.length} Kalender sichtbar: ${calendars.map((calendar) => calendar.name).join(', ')}`);
    } catch (error) {
      // Eine fehlende Anmeldung ist kein Absturz: Der Kern läuft weiter und sagt, was zu tun ist.
      context.datapoints.set({ id: 'state', value: error instanceof LoginRequired ? 'nicht angemeldet' : 'gestört', label: 'Google: Anmeldung' });
      log.warn(error instanceof Error ? error.message : String(error));
    }
  },
});
