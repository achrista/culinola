/** Ein Termin, wie ihn die Anzeige braucht. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** Beginn: Zeitpunkt nach ISO 8601, bei ganztägigen Terminen nur das Datum (JJJJ-MM-TT). */
  start: string;
  /** Ende; bei ganztägigen Terminen der erste Tag danach. */
  end: string;
  allDay: boolean;
  /** Name des Kalenders, aus dem der Termin stammt. */
  calendar: string;
  location?: string;
}

/** Ein Termin, wie ihn die Kalender-Schnittstelle von Google liefert – nur die hier gebrauchten Angaben. */
export interface ApiEvent {
  id?: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

/** Wandelt die Termine eines Kalenders um; abgesagte und solche ohne Zeitangabe fallen weg. */
export function toEvents(items: readonly ApiEvent[], calendar: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const item of items) {
    const start = item.start?.dateTime ?? item.start?.date;
    if (item.status === 'cancelled' || !start) continue;
    events.push({
      id: item.id ?? `${calendar}/${start}/${item.summary ?? ''}`,
      title: item.summary?.trim() ?? '',
      start,
      end: item.end?.dateTime ?? item.end?.date ?? start,
      allDay: !item.start?.dateTime,
      calendar,
      ...(item.location ? { location: item.location } : {}),
    });
  }
  return events;
}

/** Zeitpunkt, an dem ein Termin beginnt; ganztägige beginnen um Mitternacht nach der Uhr des Rechners. */
const startTime = (event: CalendarEvent) => (event.allDay ? new Date(`${event.start}T00:00:00`).getTime() : Date.parse(event.start));

/** Führt die Termine mehrerer Kalender zusammen: nach Beginn, ganztägige am selben Tag zuerst. */
export function sortEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => startTime(a) - startTime(b) || Number(b.allDay) - Number(a.allDay) || a.title.localeCompare(b.title));
}
