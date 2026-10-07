import { definePlugin } from '@culinola/sdk';
import { AccessTokens, LoginRequired, readClient, readToken } from './auth.ts';
import { type ApiEvent, type CalendarEvent, sortEvents, toEvents } from './calendar.ts';
import { type ApiGroup, type ApiPerson, type ApiYearlyEvent, calendarOccasions, type Occasion, occasions, upcoming } from './reminders.ts';

interface Config {
  /** Kalender, deren Termine gezeigt werden: Name oder Kennung; "primary" ist der Hauptkalender des Kontos. */
  calendars: string[];
  /** Kalender, deren jährlich wiederkehrende ganztägige Termine als Erinnerungen gelten – für Tage, die an keinem Kontakt hängen. */
  reminderCalendars: string[];
  /** So viele Tage voraus werden Termine geholt. */
  days: number;
  /** So viele Tage vor einem Geburtstag oder anderen Tag aus den Kontakten erscheint die Erinnerung. */
  leadDays: number;
  /** Kontaktgruppe (Label), deren Mitglieder als verstorben gelten. */
  deceasedGroup: string;
  refreshMinutes: number;
}

interface CalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  accessRole?: string;
}

const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const PEOPLE = 'https://people.googleapis.com/v1';
/** Kontakte ändern sich selten; sie werden seltener geholt als die Termine. */
const CONTACTS_EVERY_MS = 6 * 60 * 60 * 1000;

/** Anbindung an ein Google-Konto: Termine aus Kalendern und Erinnerungen aus den Kontakten. */
export default definePlugin<Config>({
  id: 'source-google',

  parseConfig(raw) {
    const config = raw as Partial<Config>;
    if (config.calendars !== undefined && (!Array.isArray(config.calendars) || config.calendars.some((entry) => typeof entry !== 'string' || !entry))) throw new Error('"calendars" muss eine Liste von Kalendernamen sein.');
    const number = (value: unknown, fallback: number, min: number, max: number, name: string) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'number' || value < min || value > max) throw new Error(`"${name}" muss eine Zahl von ${min} bis ${max} sein.`);
      return value;
    };
    return {
      calendars: config.calendars?.length ? config.calendars : ['primary'],
      reminderCalendars: Array.isArray(config.reminderCalendars) ? config.reminderCalendars.filter((entry): entry is string => typeof entry === 'string' && !!entry) : ['Erinnerungen'],
      days: number(config.days, 14, 1, 366, 'days'),
      leadDays: number(config.leadDays, 3, 0, 60, 'leadDays'),
      deceasedGroup: typeof config.deceasedGroup === 'string' && config.deceasedGroup ? config.deceasedGroup : 'Verstorben',
      refreshMinutes: number(config.refreshMinutes, 10, 2, 1440, 'refreshMinutes'),
    };
  },

  async start(context) {
    const { config, log } = context;
    context.resources.set('calendars', []);
    context.resources.set('events', []);
    context.resources.set('reminders', []);

    let tokens: AccessTokens;
    try {
      tokens = new AccessTokens(readClient(context.storageDir), readToken(context.storageDir).refreshToken);
    } catch (error) {
      // Eine fehlende Anmeldung ist kein Absturz: Der Kern läuft weiter und sagt, was zu tun ist.
      context.datapoints.set({ id: 'state', value: 'nicht angemeldet', label: 'Google: Anmeldung' });
      log.warn(error instanceof Error ? error.message : String(error));
      return;
    }

    const get = async <T>(url: string): Promise<T> => {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${await tokens.get()}` }, signal: AbortSignal.any([context.signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) throw new Error(`Google antwortet mit ${response.status} auf ${new URL(url).pathname}. Sind Calendar API und People API im Projekt eingeschaltet?`);
      return (await response.json()) as T;
    };

    let chosen: { id: string; name: string }[] = [];
    let yearly: { id: string; name: string }[] = [];
    let known: Occasion[] = [];
    let contactsRead = 0;
    let trouble = '';

    const loadCalendars = async () => {
      const { items = [] } = await get<{ items?: CalendarListEntry[] }>(`${CALENDAR}/users/me/calendarList?fields=items(id,summary,summaryOverride,primary,accessRole)`);
      const all = items.map((entry) => ({ id: entry.id, name: entry.summaryOverride ?? entry.summary ?? entry.id, primary: entry.primary === true, access: entry.accessRole ?? '' }));
      context.resources.set('calendars', all);
      chosen = [];
      for (const wanted of config.calendars) {
        const hit = all.find((entry) => (wanted === 'primary' ? entry.primary : entry.id === wanted || entry.name.toLowerCase() === wanted.toLowerCase()));
        if (hit) chosen.push({ id: hit.id, name: hit.name });
        else log.warn(`Kalender "${wanted}" gibt es in diesem Konto nicht. Vorhanden sind: ${all.map((entry) => entry.name).join(', ')}`);
      }
      yearly = all.filter((entry) => config.reminderCalendars.some((wanted) => entry.id === wanted || entry.name.toLowerCase() === wanted.toLowerCase())).map((entry) => ({ id: entry.id, name: entry.name }));
      log.info(`Bei Google angemeldet. Termine aus: ${chosen.map((entry) => entry.name).join(', ') || 'keinem Kalender'}${yearly.length ? `; Erinnerungen zusätzlich aus: ${yearly.map((entry) => entry.name).join(', ')}` : ''}`);
    };

    const loadEvents = async () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + config.days * 86_400_000);
      const lists = await Promise.all(
        chosen.map(async (calendar): Promise<CalendarEvent[]> => {
          const query = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '250', fields: 'items(id,status,summary,location,start,end)' });
          const { items = [] } = await get<{ items?: ApiEvent[] }>(`${CALENDAR}/calendars/${encodeURIComponent(calendar.id)}/events?${query}`);
          return toEvents(items, calendar.name);
        }),
      );
      context.resources.set('events', sortEvents(lists.flat()));
    };

    const loadContacts = async () => {
      const people: ApiPerson[] = [];
      let page = '';
      do {
        const data = await get<{ connections?: ApiPerson[]; nextPageToken?: string }>(`${PEOPLE}/people/me/connections?personFields=names,birthdays,events,memberships,phoneNumbers&pageSize=1000${page ? `&pageToken=${page}` : ''}`);
        people.push(...(data.connections ?? []));
        page = data.nextPageToken ?? '';
      } while (page);
      const { contactGroups = [] } = await get<{ contactGroups?: ApiGroup[] }>(`${PEOPLE}/contactGroups?pageSize=500`);
      const fromCalendars = await Promise.all(
        yearly.map(async (calendar) => {
          // Ohne Auflösung der Wiederholungen: Gebraucht wird der Termin selbst mit seiner Regel, nicht jedes einzelne Jahr
          const { items = [] } = await get<{ items?: ApiYearlyEvent[] }>(`${CALENDAR}/calendars/${encodeURIComponent(calendar.id)}/events?singleEvents=false&maxResults=2500&fields=items(id,status,summary,description,start,recurrence)`);
          return calendarOccasions(items);
        }),
      );
      known = [...occasions(people, contactGroups, config.deceasedGroup), ...fromCalendars.flat()];
      contactsRead = Date.now();
    };

    const refresh = async () => {
      try {
        if (!chosen.length) await loadCalendars();
        await loadEvents();
        if (Date.now() - contactsRead > CONTACTS_EVERY_MS) await loadContacts();
        // Die anstehenden Tage werden bei jedem Durchlauf neu bestimmt – um Mitternacht ändert sich die Liste von selbst
        context.resources.set('reminders', upcoming(known, new Date(), config.leadDays));
        context.datapoints.set({ id: 'state', value: 'angemeldet', label: 'Google: Anmeldung' });
        if (trouble) log.info('Google ist wieder erreichbar.');
        trouble = '';
      } catch (error) {
        if (context.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        // Die zuletzt geholten Termine bleiben stehen; gemeldet wird eine Störung einmal.
        if (message !== trouble) log.warn(message);
        trouble = message;
        context.datapoints.set({ id: 'state', value: error instanceof LoginRequired ? 'nicht angemeldet' : 'gestört', label: 'Google: Anmeldung' });
      }
      // Die Anzeige erfährt über diesen Datenpunkt, dass es Neues zu holen gibt
      context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Google: letzter Abruf' });
    };

    await refresh();
    if (known.length) log.info(`${known.length} wiederkehrende Tage aus Kontakten und Kalendern gelesen.`);
    const timer = setInterval(() => void refresh(), config.refreshMinutes * 60_000);
    context.signal.addEventListener('abort', () => clearInterval(timer));
  },
});
