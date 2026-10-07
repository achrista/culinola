import { describe, expect, it } from 'vitest';
import { type ApiPerson, calendarOccasions, occasions, upcoming } from './reminders.ts';
import { sortEvents, toEvents } from './calendar.ts';

const groups = [
  { resourceName: 'contactGroups/abc', name: 'Verstorben' },
  { resourceName: 'contactGroups/myContacts', name: 'myContacts' },
];
const person = (extra: Partial<ApiPerson>): ApiPerson => ({ resourceName: 'people/c1', names: [{ displayName: 'Anna Beispiel', givenName: 'Anna', familyName: 'Beispiel' }], ...extra });

describe('occasions', () => {
  it('liest Geburtstag und Ereignisse eines Kontakts samt Telefonnummern', () => {
    const list = occasions(
      [
        person({
          birthdays: [{ date: { year: 1980, month: 10, day: 8 } }],
          events: [{ date: { month: 7, day: 26 }, formattedType: 'Namenstag' }, { date: { year: 2005, month: 5, day: 14 }, type: 'anniversary', formattedType: 'Jahrestag' }],
          phoneNumbers: [{ value: '0821 123456', formattedType: 'Privat' }, {}],
        }),
      ],
      groups,
      'Verstorben',
    );
    const phones = [{ label: 'Privat', number: '0821 123456' }];
    expect(list).toEqual([
      { contact: 'people/c1', name: 'Anna Beispiel', kind: 'birthday', day: 8, month: 10, year: 1980, deceased: false, phones },
      { contact: 'people/c1', name: 'Anna Beispiel', kind: 'nameday', day: 26, month: 7, deceased: false, phones },
      { contact: 'people/c1', name: 'Anna Beispiel', kind: 'anniversary', day: 14, month: 5, year: 2005, deceased: false, phones },
    ]);
  });

  it('führt Angehörige an einem Familienkontakt unter eigenem Namen', () => {
    const family = person({ names: [{ displayName: 'Beispiel, Karl & Rosa', givenName: 'Karl & Rosa', familyName: 'Beispiel' }], events: [{ date: { year: 1962, month: 3, day: 2 }, formattedType: 'Geburtstag Rosa' }] });
    expect(occasions([family], groups, 'Verstorben')[0]).toMatchObject({ name: 'Rosa Beispiel', kind: 'birthday', year: 1962, deceased: false });
  });

  it('erkennt Verstorbene an der Kontaktgruppe oder am Todestag', () => {
    const inGroup = person({ birthdays: [{ date: { month: 1, day: 5 } }], memberships: [{ contactGroupMembership: { contactGroupResourceName: 'contactGroups/abc' } }] });
    const withDay = person({ resourceName: 'people/c2', birthdays: [{ date: { year: 1930, month: 2, day: 1 } }], events: [{ date: { year: 2010, month: 6, day: 9 }, formattedType: 'Todestag' }] });
    expect(occasions([inGroup], groups, 'verstorben').map((entry) => entry.deceased)).toEqual([true]);
    expect(occasions([withDay], groups, 'Verstorben').map((entry) => [entry.kind, entry.deceased])).toEqual([['birthday', true], ['death', true]]);
  });

  it('behält eine unbekannte Bezeichnung als Text und lässt Unvollständiges aus', () => {
    const list = occasions(
      [person({ birthdays: [{ date: { year: 1990 } }], events: [{ date: { month: 12, day: 17 }, formattedType: 'Festtag' }, { formattedType: 'ohne Datum' }] }), { names: [{ displayName: 'Ohne Kennung' }] }, { resourceName: 'people/c9' }],
      groups,
      'Verstorben',
    );
    expect(list).toEqual([{ contact: 'people/c1', name: 'Anna Beispiel', kind: 'other', label: 'Festtag', day: 17, month: 12, deceased: false, phones: [] }]);
  });

  it('wertet das Jahr 1900 und früher als unbekannt', () => {
    expect(occasions([person({ birthdays: [{ date: { year: 1900, month: 4, day: 1 } }] })], groups, 'Verstorben')[0]).not.toHaveProperty('year');
  });
});

describe('calendarOccasions', () => {
  const yearly = ['RRULE:FREQ=YEARLY'];

  it('liest jährliche ganztägige Termine mit Art, Namen und Jahr', () => {
    const list = calendarOccasions([
      { id: 'a', summary: 'Namenstag Andreas', start: { date: '2026-11-30' }, recurrence: yearly },
      { id: 'b', summary: 'Hochzeitstag Karl & Rosa', description: 'Jahr: 1959\nverstorben\nAus ACInfo übernommen.', start: { date: '2026-10-03' }, recurrence: yearly },
      { id: 'c', summary: 'Einzug ins Haus', description: 'year: 2014', start: { date: '2026-04-14' }, recurrence: ['RRULE:FREQ=YEARLY;INTERVAL=1'] },
    ]);
    expect(list).toEqual([
      { contact: 'calendar/a', name: 'Andreas', kind: 'nameday', day: 30, month: 11, deceased: false, phones: [] },
      { contact: 'calendar/b', name: 'Karl & Rosa', kind: 'wedding', day: 3, month: 10, year: 1959, deceased: true, phones: [] },
      { contact: 'calendar/c', name: 'Einzug ins Haus', kind: 'other', label: '', day: 14, month: 4, year: 2014, deceased: false, phones: [] },
    ]);
  });

  it('lässt alles andere aus: einmalige, wöchentliche, abgesagte Termine und solche mit Uhrzeit', () => {
    expect(
      calendarOccasions([
        { id: '1', summary: 'Einmalig', start: { date: '2026-05-01' } },
        { id: '2', summary: 'Wöchentlich', start: { date: '2026-05-01' }, recurrence: ['RRULE:FREQ=WEEKLY'] },
        { id: '3', summary: 'Abgesagt', status: 'cancelled', start: { date: '2026-05-01' }, recurrence: yearly },
        { id: '4', summary: 'Mit Uhrzeit', start: {}, recurrence: yearly },
        { id: '5', start: { date: '2026-05-01' }, recurrence: yearly },
      ]),
    ).toEqual([]);
  });

  it('nimmt einen Titel, der nur aus der Art besteht, als Ganzes', () => {
    expect(calendarOccasions([{ id: 'x', summary: 'Hochzeitstag', start: { date: '2026-08-08' }, recurrence: yearly }])[0]).toMatchObject({ name: 'Hochzeitstag', kind: 'other' });
  });
});

describe('upcoming', () => {
  const day = (month: number, date: number, year?: number) => ({ contact: 'people/c1', name: `${date}.${month}.`, kind: 'birthday' as const, day: date, month, ...(year ? { year } : {}), deceased: false, phones: [] });

  it('zeigt von gestern bis zur Vorlaufzeit, das Nächste zuerst, mit Alter', () => {
    const list = [day(10, 12), day(10, 10, 1980), day(10, 6), day(10, 7, 2000), day(10, 5), day(10, 11)];
    const result = upcoming(list, new Date(2026, 9, 7), 3);
    expect(result.map((entry) => [entry.name, entry.inDays, entry.date, entry.years])).toEqual([
      ['6.10.', -1, '2026-10-06', undefined],
      ['7.10.', 0, '2026-10-07', 26],
      ['10.10.', 3, '2026-10-10', 46],
    ]);
  });

  it('reicht über den Jahreswechsel, in beide Richtungen', () => {
    expect(upcoming([day(1, 2, 1990), day(12, 30)], new Date(2026, 11, 31), 3).map((entry) => [entry.date, entry.inDays, entry.years])).toEqual([['2026-12-30', -1, undefined], ['2027-01-02', 2, 37]]);
    expect(upcoming([day(12, 31, 1950)], new Date(2027, 0, 1), 3).map((entry) => [entry.date, entry.inDays, entry.years])).toEqual([['2026-12-31', -1, 76]]);
  });

  it('legt den 29. Februar in Jahren ohne Schalttag auf den 28.', () => {
    expect(upcoming([day(2, 29, 2000)], new Date(2027, 1, 27), 3).map((entry) => entry.date)).toEqual(['2027-02-28']);
    expect(upcoming([day(2, 29, 2000)], new Date(2028, 1, 27), 3).map((entry) => entry.date)).toEqual(['2028-02-29']);
  });

  it('nennt kein Alter im Jahr des Ereignisses selbst', () => {
    expect(upcoming([day(10, 7, 2026)], new Date(2026, 9, 7), 3)[0]).not.toHaveProperty('years');
  });
});

describe('Kalender', () => {
  it('wandelt Termine um und lässt abgesagte und zeitlose aus', () => {
    const events = toEvents(
      [
        { id: 'a', summary: ' Zahnarzt ', start: { dateTime: '2026-10-08T09:30:00+02:00' }, end: { dateTime: '2026-10-08T10:00:00+02:00' }, location: 'Praxis' },
        { id: 'b', summary: 'Urlaub', start: { date: '2026-10-08' }, end: { date: '2026-10-12' } },
        { id: 'c', status: 'cancelled', summary: 'Abgesagt', start: { date: '2026-10-08' } },
        { id: 'd', summary: 'Ohne Zeit' },
        { start: { date: '2026-10-09' } },
      ],
      'Familie',
    );
    expect(events).toEqual([
      { id: 'a', title: 'Zahnarzt', start: '2026-10-08T09:30:00+02:00', end: '2026-10-08T10:00:00+02:00', allDay: false, calendar: 'Familie', location: 'Praxis' },
      { id: 'b', title: 'Urlaub', start: '2026-10-08', end: '2026-10-12', allDay: true, calendar: 'Familie' },
      { id: 'Familie/2026-10-09/', title: '', start: '2026-10-09', end: '2026-10-09', allDay: true, calendar: 'Familie' },
    ]);
  });

  it('ordnet nach Beginn und stellt ganztägige Termine eines Tages voran', () => {
    const at = (id: string, start: string, allDay = false) => ({ id, title: id, start, end: start, allDay, calendar: 'x' });
    const sorted = sortEvents([at('abends', '2026-10-08T19:00:00+02:00'), at('morgen', '2026-10-09', true), at('ganztags', '2026-10-08', true), at('früh', '2026-10-08T07:00:00+02:00')]);
    expect(sorted.map((event) => event.id)).toEqual(['ganztags', 'früh', 'abends', 'morgen']);
  });
});
