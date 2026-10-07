/** Art eines wiederkehrenden Tages. Was nicht dazugehört, läuft als „other“ mit seiner eigenen Bezeichnung. */
export type OccasionKind = 'birthday' | 'nameday' | 'wedding' | 'baptism' | 'death' | 'anniversary' | 'other';

/** Ein jährlich wiederkehrender Tag eines Kontakts. */
export interface Occasion {
  /** Kennung des Kontakts bei Google. */
  contact: string;
  name: string;
  kind: OccasionKind;
  /** Bezeichnung aus dem Kontakt, wenn die Art „other“ ist. */
  label?: string;
  day: number;
  month: number;
  /** Jahr des Ereignisses, wenn bekannt – daraus ergibt sich das Alter. */
  year?: number;
  /** Die Person lebt nicht mehr. */
  deceased: boolean;
  phones: { label: string; number: string }[];
}

/** Ein Tag, der gerade ansteht. */
export interface Reminder extends Occasion {
  /** Datum in diesem Durchlauf, JJJJ-MM-TT. */
  date: string;
  /** Tage bis dahin; 0 ist heute, −1 gestern. */
  inDays: number;
  /** Wie oft sich der Tag jährt, wenn das Jahr bekannt ist. */
  years?: number;
}

interface ApiDate {
  year?: number;
  month?: number;
  day?: number;
}

/** Ein Kontakt, wie ihn die Kontakte-Schnittstelle von Google liefert – nur die hier gebrauchten Angaben. */
export interface ApiPerson {
  resourceName?: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  birthdays?: { date?: ApiDate }[];
  events?: { date?: ApiDate; type?: string; formattedType?: string }[];
  memberships?: { contactGroupMembership?: { contactGroupResourceName?: string } }[];
  phoneNumbers?: { value?: string; formattedType?: string }[];
}

export interface ApiGroup {
  resourceName?: string;
  name?: string;
  formattedName?: string;
}

/** Bezeichnungen, an denen die Art eines Ereignisses erkannt wird – deutsch und englisch. */
const KINDS: [RegExp, OccasionKind][] = [
  [/^(geburtstag|birthday)\b/i, 'birthday'],
  [/^(namenstag|name ?day)\b/i, 'nameday'],
  [/^(hochzeitstag|hochzeit|wedding)\b/i, 'wedding'],
  [/^(taufe|tauftag|baptism)\b/i, 'baptism'],
  [/^(todestag|sterbetag|death)\b/i, 'death'],
  [/^(jahrestag|anniversary)\b/i, 'anniversary'],
];

const validDate = (date: ApiDate | undefined): date is ApiDate & { month: number; day: number } => !!date?.month && !!date.day;

/**
 * Liest aus den Kontakten alle wiederkehrenden Tage: den Geburtstag und die Ereignisse.
 *
 * Ein Ereignis darf hinter seiner Art einen Namen tragen – „Geburtstag Bärbel“ an einem
 * Kontakt, der für eine ganze Familie steht. Dann gilt der Tag dieser Person.
 * Als verstorben zählt, wer in der genannten Kontaktgruppe ist oder einen Todestag hat.
 */
export function occasions(people: readonly ApiPerson[], groups: readonly ApiGroup[], deceasedGroup: string): Occasion[] {
  const deceasedIds = new Set(groups.filter((group) => (group.name ?? group.formattedName ?? '').toLowerCase() === deceasedGroup.toLowerCase()).map((group) => group.resourceName));
  const result: Occasion[] = [];

  for (const person of people) {
    const name = person.names?.[0];
    const display = name?.displayName?.trim();
    if (!person.resourceName || !display) continue;

    const events = (person.events ?? []).filter((event) => validDate(event.date)).map((event) => {
      const text = (event.formattedType ?? event.type ?? '').trim();
      const kind = KINDS.find(([pattern]) => pattern.test(text));
      // Was nach der Art noch folgt, ist der Name der Person, der dieser Tag gilt
      const who = kind ? text.replace(kind[0], '').trim() : '';
      return { date: event.date as ApiDate & { month: number; day: number }, kind: kind?.[1] ?? ('other' as const), text, who };
    });
    const deceased = (person.memberships ?? []).some((entry) => deceasedIds.has(entry.contactGroupMembership?.contactGroupResourceName)) || events.some((event) => event.kind === 'death' && !event.who);
    const phones = (person.phoneNumbers ?? []).filter((phone) => phone.value).map((phone) => ({ label: phone.formattedType ?? '', number: phone.value! }));
    const add = (kind: OccasionKind, date: ApiDate & { month: number; day: number }, who: string, label?: string) =>
      result.push({
        contact: person.resourceName!,
        name: who ? [who, name?.familyName].filter(Boolean).join(' ') : display,
        kind,
        ...(label ? { label } : {}),
        day: date.day,
        month: date.month,
        ...(date.year && date.year > 1900 ? { year: date.year } : {}),
        // Der Vermerk „verstorben“ gilt der Person des Kontakts, nicht den Angehörigen, die an ihm mitgeführt werden
        deceased: who ? false : deceased,
        phones,
      });

    const birthday = person.birthdays?.[0]?.date;
    if (validDate(birthday)) add('birthday', birthday, '');
    for (const event of events) add(event.kind, event.date, event.who, event.kind === 'other' ? event.text || undefined : undefined);
  }
  return result;
}

/** Ein Termin eines Kalenders, wie ihn Google ohne Auflösung der Wiederholungen liefert. */
export interface ApiYearlyEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string };
  recurrence?: string[];
}

/**
 * Liest wiederkehrende Tage aus einem Kalender: jeden ganztägigen Termin, der sich jährlich
 * wiederholt. Der Titel nennt Art und Namen („Namenstag Andreas“, „Hochzeitstag Karl & Rosa“);
 * steht in der Beschreibung „Jahr: 1959“, lässt sich daraus das Jubiläum errechnen.
 */
export function calendarOccasions(items: readonly ApiYearlyEvent[]): Occasion[] {
  const result: Occasion[] = [];
  for (const item of items) {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.start?.date ?? '');
    const title = item.summary?.trim();
    if (item.status === 'cancelled' || !date || !title || !item.recurrence?.some((rule) => /FREQ=YEARLY/i.test(rule))) continue;
    const kind = KINDS.find(([pattern]) => pattern.test(title));
    const who = kind ? title.replace(kind[0], '').trim() : '';
    const year = Number(/\b(?:Jahr|year):\s*(\d{4})\b/i.exec(item.description ?? '')?.[1]);
    result.push({
      contact: `calendar/${item.id ?? title}`,
      // Ohne erkennbare Art steht der ganze Titel als Bezeichnung da
      name: who || title,
      kind: kind && who ? kind[1] : 'other',
      ...(kind && who ? {} : { label: '' }),
      day: Number(date[3]),
      month: Number(date[2]),
      ...(year > 1900 ? { year } : {}),
      deceased: /\b(verstorben|deceased)\b/i.test(item.description ?? ''),
      phones: [],
    });
  }
  return result;
}

const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Wählt die Tage aus, die anstehen: von gestern bis `leadDays` Tage voraus.
 * Der 29. Februar fällt in Jahren ohne Schalttag auf den 28.
 */
export function upcoming(list: readonly Occasion[], today: Date, leadDays: number): Reminder[] {
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const reminders: Reminder[] = [];
  for (const occasion of list) {
    // Um den Jahreswechsel liegt der nächste Termin im Nachbarjahr
    for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
      const day = occasion.month === 2 && occasion.day === 29 && !leap(year) ? 28 : occasion.day;
      const inDays = Math.round((Date.UTC(year, occasion.month - 1, day) - base) / 86_400_000);
      if (inDays < -1 || inDays > leadDays) continue;
      const years = occasion.year ? year - occasion.year : undefined;
      reminders.push({ ...occasion, date: iso(year, occasion.month, day), inDays, ...(years !== undefined && years > 0 ? { years } : {}) });
    }
  }
  return reminders.sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
}
