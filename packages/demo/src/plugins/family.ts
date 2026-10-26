import { InvalidInput, type PluginContext } from '@culinola/sdk';
import { listKey, splitEntry, toEntries, type MerkioItem } from '../../../../plugins/source-merkio/src/merkio.ts';
import { pick } from '../language.ts';
import { ago, at, day } from './curves.ts';

// Die Familie der Demo – alle Namen, Nummern und Nachrichten sind erfunden, auf Deutsch und Englisch. Die Daten
// haben dieselbe Form, in der sie die echten Plugins liefern: Google, E-Mail, FRITZ!Box und Merkio.

/** Kalender und Erinnerungen an Stelle von Google. */
export function startAgenda(context: PluginContext<unknown>): void {
  const [family, school, bins] = pick({ de: ['Familie', 'Schule', 'Abfall'], en: ['Family', 'School', 'Bins'] });
  const event = (id: string, title: Record<'de' | 'en', string>, start: string, end: string, calendar: string, allDay = false, location?: Record<'de' | 'en', string>) => ({ id, title: pick(title), start, end, allDay, calendar, ...(location ? { location: pick(location) } : {}) });
  context.resources.set('calendars', [
    { id: 'familie', name: family, primary: true, access: 'owner' },
    { id: 'schule', name: school, primary: false, access: 'reader' },
    { id: 'muell', name: bins, primary: false, access: 'reader' },
  ]);
  context.resources.set('events', [
    event('1', { de: 'Herbstferien', en: 'Autumn half term' }, day(-2), day(5), school!, true),
    event('2', { de: 'Elternabend 4b', en: 'Parents’ evening 4b' }, at(0, '19:30'), at(0, '21:00'), school!, false, { de: 'Grundschule', en: 'Primary school' }),
    event('3', { de: 'Gelber Sack', en: 'Recycling collection' }, day(1), day(2), bins!, true),
    event('4', { de: 'Zahnarzt Lena', en: 'Dentist Lena' }, at(1, '08:45'), at(1, '09:30'), family!, false, { de: 'Praxis am Markt', en: 'Market Square Practice' }),
    event('5', { de: 'Chorprobe', en: 'Choir practice' }, at(1, '19:30'), at(1, '21:00'), family!),
    event('6', { de: 'Wochenmarkt', en: 'Farmers’ market' }, at(2, '08:00'), at(2, '09:00'), family!),
    event('7', { de: 'Kinderturnen', en: 'Kids’ gym' }, at(2, '16:00'), at(2, '17:00'), family!, false, { de: 'Turnhalle', en: 'Sports hall' }),
    event('8', { de: 'Oma und Opa zum Kaffee', en: 'Grandma and Grandpa for coffee' }, at(3, '15:00'), at(3, '18:00'), family!),
    event('9', { de: 'Restmüll', en: 'General waste' }, day(4), day(5), bins!, true),
    event('10', { de: 'Reifenwechsel', en: 'Tyre change' }, at(5, '10:00'), at(5, '11:00'), family!, false, { de: 'Autohaus', en: 'Garage' }),
  ]);
  const year = new Date().getFullYear();
  const phones = [{ label: pick({ de: 'Mobil', en: 'Mobile' }), number: '0151 5550100' }];
  const reminder = (name: string, kind: string, inDays: number, extra: object = {}) => ({ contact: `demo/${name}`, name, kind, date: day(inDays), inDays, deceased: false, phones, ...extra });
  context.resources.set('reminders', [
    reminder(pick({ de: 'Tante Rosa', en: 'Aunt Rose' }), 'birthday', 0, { years: 71, phones: [{ label: pick({ de: 'Privat', en: 'Home' }), number: '0821 5550101' }] }),
    reminder('Jonas', 'birthday', 2, { years: year - 2014 }),
    pick({ de: reminder('Marlene', 'nameday', 3, { phones: [] }), en: reminder('Emma', 'birthday', 3, { years: 9, phones: [] }) }),
    reminder(pick({ de: 'Karl & Hanne', en: 'Charles & Hannah' }), 'wedding', 6, { years: 40 }),
    reminder(pick({ de: 'Haus', en: 'House' }), 'other', 9, { label: pick({ de: 'Einzug', en: 'Moving in' }), years: 12, phones: [] }),
  ]);
  context.datapoints.set({ id: 'state', value: 'angemeldet', label: 'Google: Anmeldung' });
  context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Google: letzter Abruf' });
}

interface Mail {
  account: string;
  uid: number;
  from: string;
  subject: string;
  minutesAgo: number;
  unread: boolean;
  html?: string;
  text: string;
  files: { name: string; size: number }[];
}

const MAILS_DE: Mail[] = [
  { account: 'privat', uid: 31, from: 'Kita Sonnenschein', subject: 'Laternenumzug am 11. November', minutesAgo: 18, unread: true, html: '<p>Liebe Eltern,</p><p>am <b>11. November</b> ziehen wir um 17 Uhr mit unseren Laternen durch den Park. Danach gibt es Punsch und Brezen im Garten der Kita.</p><p>Wer mag, bringt bitte einen Kuchen mit – die Liste hängt an der Pinnwand.</p><p>Herzliche Grüße<br>Ihr Kita-Team</p>', text: '', files: [{ name: 'Laternenlieder.pdf', size: 248_120 }] },
  { account: 'privat', uid: 30, from: 'Paketdienst', subject: 'Ihre Sendung kommt heute zwischen 14 und 16 Uhr', minutesAgo: 95, unread: true, text: 'Guten Tag,\n\nIhre Sendung wird heute zwischen 14:00 und 16:00 Uhr zugestellt. Sind Sie nicht zu Hause, legen wir sie an den vereinbarten Ablageort.\n\nIhr Paketdienst', files: [] },
  { account: 'verein', uid: 12, from: 'Gesangverein', subject: 'Chorprobe: bitte Noten mitbringen', minutesAgo: 60 * 5, unread: false, text: 'Hallo zusammen,\n\nam Donnerstag proben wir die Stücke für das Adventskonzert. Bitte die neuen Noten (im Anhang) ausgedruckt mitbringen.\n\nViele Grüße\nder Vorstand', files: [{ name: 'Adventskonzert-Noten.pdf', size: 1_204_331 }] },
  { account: 'privat', uid: 29, from: 'Tante Rosa', subject: 'Fotos vom Apfelpflücken', minutesAgo: 60 * 22, unread: false, text: 'Ihr Lieben,\n\nhier die Bilder vom Sonntag. Der Apfelkuchen war ein Gedicht – das Rezept schicke ich noch!\n\nEure Rosa', files: [{ name: 'aepfel-1.jpg', size: 2_411_724 }, { name: 'aepfel-2.jpg', size: 1_874_001 }] },
  { account: 'privat', uid: 28, from: 'Stadtwerke', subject: 'Ihr Zählerstand für die Jahresabrechnung', minutesAgo: 60 * 48, unread: false, text: 'Sehr geehrte Kundin, sehr geehrter Kunde,\n\nbitte teilen Sie uns bis zum 15. des Monats Ihren Zählerstand mit.\n\nMit freundlichen Grüßen\nIhre Stadtwerke', files: [] },
  { account: 'verein', uid: 11, from: 'Sportverein', subject: 'Hallenzeiten im Winter', minutesAgo: 60 * 24 * 4, unread: false, text: 'Ab November trainieren wir dienstags schon um 18 Uhr.', files: [] },
  { account: 'privat', uid: 27, from: 'Bücherei', subject: 'Erinnerung: Rückgabe in drei Tagen', minutesAgo: 60 * 24 * 6, unread: false, text: 'Die Leihfrist für „Das große Backbuch“ endet in drei Tagen.', files: [] },
];

const MAILS_EN: Mail[] = [
  { account: 'privat', uid: 31, from: 'Sunshine Nursery', subject: 'Lantern walk on 11 November', minutesAgo: 18, unread: true, html: '<p>Dear parents,</p><p>on <b>11 November</b> at 5 pm we will walk through the park with our lanterns. Afterwards there will be hot punch and pretzels in the nursery garden.</p><p>If you like, please bring a cake – the list is on the notice board.</p><p>Best wishes<br>Your nursery team</p>', text: '', files: [{ name: 'Lantern-songs.pdf', size: 248_120 }] },
  { account: 'privat', uid: 30, from: 'Parcel service', subject: 'Your parcel arrives today between 2 and 4 pm', minutesAgo: 95, unread: true, text: 'Hello,\n\nyour parcel will be delivered today between 2:00 and 4:00 pm. If you are not at home, we will leave it at your chosen safe place.\n\nYour parcel service', files: [] },
  { account: 'verein', uid: 12, from: 'Choir', subject: 'Rehearsal: please bring your sheet music', minutesAgo: 60 * 5, unread: false, text: 'Hello everyone,\n\non Thursday we rehearse the pieces for the Advent concert. Please bring the new sheet music (attached) printed out.\n\nBest wishes\nThe committee', files: [{ name: 'Advent-concert-music.pdf', size: 1_204_331 }] },
  { account: 'privat', uid: 29, from: 'Aunt Rose', subject: 'Photos from apple picking', minutesAgo: 60 * 22, unread: false, text: 'My dears,\n\nhere are the pictures from Sunday. The apple cake was a dream – I will send you the recipe!\n\nLove, Rose', files: [{ name: 'apples-1.jpg', size: 2_411_724 }, { name: 'apples-2.jpg', size: 1_874_001 }] },
  { account: 'privat', uid: 28, from: 'City utilities', subject: 'Your meter reading for the annual bill', minutesAgo: 60 * 48, unread: false, text: 'Dear customer,\n\nplease send us your meter reading by the 15th of the month.\n\nKind regards\nYour city utilities', files: [] },
  { account: 'verein', uid: 11, from: 'Sports club', subject: 'Winter training times', minutesAgo: 60 * 24 * 4, unread: false, text: 'From November we train on Tuesdays at 6 pm.', files: [] },
  { account: 'privat', uid: 27, from: 'Library', subject: 'Reminder: return due in three days', minutesAgo: 60 * 24 * 6, unread: false, text: 'The loan period for “The Big Baking Book” ends in three days.', files: [] },
];

/** Postfächer an Stelle von IMAP. */
export function startMail(context: PluginContext<unknown>): void {
  const frame = (html: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head><body style="font-family:sans-serif;font-size:18px;line-height:1.5">${html}</body></html>`;
  const mails = pick({ de: MAILS_DE, en: MAILS_EN }).map((mail) => ({ ...mail, date: ago(mail.minutesAgo) }));
  context.resources.set(
    'messages',
    mails.map(({ account, uid, from, subject, date, unread, files }) => ({ account, uid, from, subject, date, unread, attachments: files.length > 0, size: 20_000 })),
  );
  context.resources.set('accounts', [{ id: 'privat', name: pick({ de: 'Privat', en: 'Home' }) }, { id: 'verein', name: pick({ de: 'Verein', en: 'Club' }) }]);
  context.datapoints.set({ id: 'unread', value: mails.filter((mail) => mail.unread).length, label: 'Ungelesene Nachrichten' });
  context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Letzter Abruf der Postfächer' });
  context.routes.get('/message/:account/:uid', (request) => {
    const mail = mails.find((entry) => entry.account === request.params['account'] && String(entry.uid) === request.params['uid']);
    if (!mail) return Response.json({ error: 'Nachricht nicht gefunden.' }, { status: 404 });
    return Response.json({ account: mail.account, uid: mail.uid, subject: mail.subject, from: `${mail.from} <post@example.org>`, to: 'family@example.org', date: mail.date, ...(mail.html ? { html: frame(mail.html) } : {}), text: mail.text, attachments: mail.files });
  });
}

/** Anrufliste an Stelle der FRITZ!Box. */
export function startCalls(context: PluginContext<unknown>): void {
  const call = (id: string, kind: string, name: string, number: string, minutesAgo: number, minutes: number, extra: object = {}) => ({ id, kind, name, number, date: ago(minutesAgo), minutes, device: pick({ de: 'Küche', en: 'Kitchen' }), voicemail: false, ...extra });
  context.resources.set('calls', [
    call('9', 'missed', '', '0821 5550177', 42, 0, { place: 'Augsburg' }),
    call('8', 'incoming', pick({ de: 'Tante Rosa', en: 'Aunt Rose' }), '0821 5550101', 60 * 3, 18),
    call('7', 'outgoing', pick({ de: 'Praxis am Markt', en: 'Market Square Practice' }), '0821 5550123', 60 * 6, 3),
    call('6', 'incoming', 'Jonas', '0151 5550100', 60 * 26, 7),
    call('5', 'rejected', '', '0900 5550199', 60 * 30, 0, { place: pick({ de: 'Sonderrufnummer', en: 'Premium-rate number' }) }),
    call('4', 'missed', pick({ de: 'Opa Karl', en: 'Grandpa Charles' }), '08231 555012', 60 * 49, 0),
    call('3', 'outgoing', pick({ de: 'Autohaus', en: 'Garage' }), '0821 5550145', 60 * 75, 5),
    call('2', 'incoming', '', '089 5550133', 60 * 24 * 4, 2, { place: pick({ de: 'München', en: 'Munich' }) }),
  ]);
  context.datapoints.set({ id: 'ringing', value: '', label: 'Anrufer, solange es klingelt' });
  context.datapoints.set({ id: 'state', value: 'verbunden', label: 'FRITZ!Box' });
  context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Letzter Abruf der Anrufliste' });
}

type Seed = [name: string, quantity?: string | undefined, unit?: string | undefined, checked?: boolean];

const SHOPPING_DE: Seed[] = [['Milch', '2', 'l'], ['Butter'], ['Eier', '10'], ['Äpfel', '1', 'kg'], ['Haferflocken'], ['Tomaten', '500', 'g'], ['Brezen', '4'], ['Kaffee', undefined, undefined, true], ['Spülmaschinentabs', undefined, undefined, true]];
const SHOPPING_EN: Seed[] = [['Milk', '2', 'l'], ['Butter'], ['Eggs', '10'], ['Apples', '1', 'kg'], ['Rolled oats'], ['Tomatoes', '500', 'g'], ['Pretzels', '4'], ['Coffee', undefined, undefined, true], ['Dishwasher tablets', undefined, undefined, true]];

/** Einkaufsliste an Stelle von Merkio – abhaken und ergänzen wie dort. */
export function startLists(context: PluginContext<unknown>): void {
  const name = pick({ de: 'Einkauf', en: 'Shopping' });
  const group = pick({ de: 'Familie', en: 'Family' });
  const key = listKey(name);
  let next = 100;
  let items: MerkioItem[] = pick({ de: SHOPPING_DE, en: SHOPPING_EN }).map(([text, quantity, unit, checked], position) => ({ id: next++, listId: 1, name: text, quantity: quantity ?? null, unit: unit ?? null, checked: !!checked, checkedAt: checked ? ago(60 * 20) : null, position }));

  const publish = () => {
    const entries = toEntries(items);
    context.resources.set('lists', [{ id: key, name, group, type: 'shopping', items: entries }]);
    context.resources.set('available', [{ id: 1, name, type: 'shopping', group }]);
    context.datapoints.set({ id: 'open', value: entries.filter((entry) => !entry.checked).length, label: 'Merkio: offene Einträge' });
    context.datapoints.set({ id: 'updated', value: new Date().toISOString(), label: 'Merkio: letzte Änderung' });
  };
  context.datapoints.set({ id: 'state', value: 'ok', label: 'Merkio: Verbindung' });
  publish();

  context.actions.register(
    {
      name: 'lists.check',
      description: 'Hakt einen Eintrag einer Einkaufs- oder Aufgabenliste ab oder nimmt den Haken wieder weg.',
      params: {
        item: { type: 'number', description: 'Nummer des Eintrags', required: true },
        checked: { type: 'boolean', description: 'true hakt ab, false nimmt den Haken weg; ohne Angabe wird abgehakt' },
      },
    },
    ({ item, checked }) => {
      const hit = items.find((entry) => entry.id === item);
      if (!hit) throw new InvalidInput(`Der Eintrag ${String(item)} steht auf keiner der gezeigten Listen.`);
      items = items.map((entry) => (entry === hit ? { ...entry, checked: checked !== false, checkedAt: checked !== false ? new Date().toISOString() : null } : entry));
      publish();
      return { list: key, item: hit.id, checked: checked !== false };
    },
  );

  context.actions.register(
    {
      name: 'lists.add',
      description: 'Setzt einen Eintrag auf eine Einkaufs- oder Aufgabenliste, etwa "2 kg Mehl". Steht er dort schon abgehakt, wird er wieder offen.',
      params: {
        text: { type: 'string', description: 'Der Eintrag, auf Wunsch mit Menge und Einheit davor', required: true },
        quantity: { type: 'string', description: 'Menge als Text, etwa "2" oder "0.5" – nur, wenn sie nicht schon im Eintrag steht' },
        unit: { type: 'string', description: 'Einheit zur Menge, etwa "kg" oder "Packung"' },
        list: { type: 'string', description: 'Kennung oder Name der Liste; ohne Angabe die erste' },
      },
    },
    ({ text, quantity, unit }) => {
      const given = typeof quantity === 'string' && quantity.trim() ? quantity.trim() : undefined;
      const measure = typeof unit === 'string' && unit.trim() ? unit.trim() : undefined;
      const entry = given || measure ? { name: String(text ?? '').trim(), ...(given ? { quantity: given } : {}), ...(measure ? { unit: measure } : {}) } : splitEntry(String(text ?? ''));
      if (!entry.name) throw new InvalidInput('Der Eintrag ist leer.');
      const again = items.find((item) => item.name.trim().toLowerCase() === entry.name.toLowerCase());
      if (again && !again.checked) return { list: key, item: again.id, added: false };
      if (again) items = items.map((item) => (item === again ? { ...item, checked: false, checkedAt: null, ...(entry.quantity ? { quantity: entry.quantity, unit: entry.unit ?? null } : {}) } : item));
      else items = [...items, { id: next++, listId: 1, name: entry.name, quantity: entry.quantity ?? null, unit: entry.unit ?? null, checked: false, checkedAt: null, position: items.length }];
      publish();
      return { list: key, item: again?.id ?? next - 1, added: true };
    },
  );
}
