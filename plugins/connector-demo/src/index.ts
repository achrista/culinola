import { definePlugin, type DatapointValue, type SeriesPoint } from '@culinola/sdk';

const TICK_MS = 5000;

/** Tagesgang als Funktion der Uhrzeit – dieselbe Formel liefert Live-Wert und Verlauf. */
const CURVES: Record<string, { unit: string; label: string; at(hour: number, time: number): number }> = {
  temp_wohnen: { unit: '°C', label: 'Wohnen', at: (h, t) => 21 + 1.2 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + wobble(t, 0.15) },
  feuchte_wohnen: { unit: '%', label: 'Feuchte Wohnen', at: (h, t) => 48 - 4 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + wobble(t, 0.5) },
  temp_bad: { unit: '°C', label: 'Bad', at: (h, t) => 22.5 + (h >= 6.5 && h < 8 ? 3.5 : 0) + wobble(t, 0.2) },
  temp_aussen: { unit: '°C', label: 'Außen', at: (h, t) => 11 + 5 * Math.sin(((h - 10) / 24) * 2 * Math.PI) + wobble(t, 0.3) },
  co2: { unit: 'ppm', label: 'CO₂', at: (h, t) => 600 + (h >= 18 && h < 23 ? 500 : 0) + wobble(t, 25) },
  verbrauch: { unit: 'W', label: 'Verbrauch', at: (h, t) => 480 + (h >= 18 && h < 21 ? 1100 : 0) + (h >= 12 && h < 13 ? 900 : 0) + wobble(t, 90) },
  solar: { unit: 'W', label: 'Solar', at: (h, t) => (h < 7 || h > 18 ? 0 : Math.max(0, Math.sin(((h - 7) / 11) * Math.PI) * 4200 * (0.85 + wobble(t, 0.1)))) },
  batterie: { unit: '%', label: 'Batterie', at: (h) => Math.round(Math.min(100, Math.max(15, 20 + (h < 7 ? 0 : (h - 7) * 9) - (h > 17 ? (h - 17) * 12 : 0)))) },
};

/** Erfundene Vorhersage für fünf Tage: Wetterlage, Höchst- und Tiefstwert. */
const FORECAST: [string, number, number][] = [
  ['Mäßig bewölkt', 16, 8],
  ['Klarer Himmel', 19, 7],
  ['Leichter Regen', 14, 9],
  ['Gewitter', 17, 11],
  ['Schneeregen', 3, -1],
];

/** Gleichmäßiges, wiederholbares Rauschen statt Zufall – so passen Verlauf und Live-Wert zusammen. */
function wobble(time: number, amplitude: number): number {
  return amplitude * (Math.sin(time / 97_000) + 0.5 * Math.sin(time / 31_000));
}

function hourOf(time: number): number {
  const date = new Date(time);
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Erfundene Termine und Erinnerungen, vom heutigen Tag aus gerechnet – in der Form, in der sie auch aus einem Google-Konto kommen. */
function publishAgenda(context: { resources: { set(name: string, value: unknown): void }; datapoints: { set(update: { id: string; value: DatapointValue }): void } }): void {
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00`).toISOString();
  const event = (id: string, title: string, start: string, end: string, allDay = false) => ({ id, title, start, end, allDay, calendar: 'Familie' });
  context.resources.set('events', [
    event('1', 'Besuch aus Hamburg', day(-1), day(2), true),
    event('2', 'Elternabend', at(0, '23:30'), at(0, '23:59')),
    event('3', 'Papiertonne', day(1), day(2), true),
    event('4', 'Zahnarzt', at(1, '09:15'), at(1, '10:00')),
    event('5', 'Chorprobe', at(1, '19:30'), at(1, '21:00')),
    event('6', 'Wochenmarkt', at(3, '08:00'), at(3, '09:00')),
    event('7', '', at(5, '14:00'), at(5, '15:00')),
  ]);
  const year = new Date().getFullYear();
  const phones = [{ label: 'Mobil', number: '0151 5550100' }, { label: 'Privat', number: '0821 5550101' }];
  const reminder = (name: string, kind: string, inDays: number, extra: object = {}) => ({ contact: `demo/${name}`, name, kind, date: day(inDays), inDays, deceased: false, phones, ...extra });
  context.resources.set('reminders', [
    reminder('Tante Rosa', 'birthday', -1, { years: 71 }),
    reminder('Jonas Beispiel', 'birthday', 0, { years: year - 2014 }),
    reminder('Opa Karl', 'birthday', 1, { years: 98, deceased: true, phones: [] }),
    reminder('Marlene', 'nameday', 2, { phones: [] }),
    reminder('Karl & Rosa Beispiel', 'wedding', 3, { years: 40 }),
    reminder('Haus', 'other', 3, { label: 'Einzug', years: 12, phones: [] }),
  ]);
  context.datapoints.set({ id: 'updated', value: new Date().toISOString() });
}

/** Erfundene Nachrichten zweier Postfächer – in der Form, in der sie auch das Mail-Plugin liefert. */
function publishMail(context: {
  resources: { set(name: string, value: unknown): void };
  routes: { get(path: string, handler: (request: { params: Record<string, string> }) => Response): void };
}): void {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const frame = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head><body style="font-family:sans-serif;font-size:18px">${html}</body></html>`;
  const mails = [
    { account: 'privat', uid: 12, from: 'Stadtwerke', subject: 'Ihre Abrechnung für September', date: ago(25), unread: true, attachments: true, body: { html: frame('<h2>Ihre Abrechnung</h2><p>Guten Tag,<br>anbei erhalten Sie die Abrechnung für <b>September</b>.</p><script>parent.document.title = "EINGESCHLEUST"</script><img src="https://example.org/zaehler.gif" alt="Zählbild"><p><a href="https://example.org">Zum Kundenbereich</a></p>'), text: 'Ihre Abrechnung', files: [{ name: 'Abrechnung-September.pdf', size: 184_320 }] } },
    { account: 'verein', uid: 4, from: 'Sportverein', subject: 'Training fällt am Donnerstag aus', date: ago(190), unread: true, attachments: false, body: { text: 'Hallo zusammen,\n\ndas Training am Donnerstag fällt aus, die Halle ist belegt.\n\nViele Grüße\nder Vorstand', files: [] } },
    { account: 'privat', uid: 11, from: 'Tante Rosa', subject: 'Fotos vom Wochenende', date: ago(60 * 26), unread: false, attachments: true, body: { text: 'Die Bilder hängen an. Liebe Grüße!', files: [{ name: 'garten.jpg', size: 2_411_724 }, { name: 'kaffee.jpg', size: 1_874_001 }] } },
    { account: 'privat', uid: 10, from: '', subject: '', date: ago(60 * 24 * 9), unread: false, attachments: false, body: { text: 'Eine Nachricht ohne Absender und ohne Betreff.', files: [] } },
    ...Array.from({ length: 8 }, (_, index) => ({ account: 'verein', uid: 3 - index, from: 'Rundbrief', subject: `Mitteilungen Nr. ${20 - index}`, date: ago(60 * 24 * (10 + index * 7)), unread: false, attachments: false, body: { text: 'Text des Rundbriefs.', files: [] as { name: string; size: number }[] } })),
  ];
  context.resources.set('messages', mails.map(({ body: _body, ...entry }) => entry));
  context.resources.set('accounts', [{ id: 'privat', name: 'Privat' }, { id: 'verein', name: 'Verein', error: 'Beispiel einer Störung' }]);
  context.routes.get('/message/:account/:uid', (request) => {
    const mail = mails.find((entry) => entry.account === request.params.account && String(entry.uid) === request.params.uid);
    if (!mail) return Response.json({ error: 'Nachricht nicht gefunden.' }, { status: 404 });
    return Response.json({ subject: mail.subject, from: mail.from ? `${mail.from} <absender@example.org>` : '', to: 'kueche@example.org', date: mail.date, ...('html' in mail.body ? { html: mail.body.html } : {}), text: mail.body.text, attachments: mail.body.files });
  });
}

/** Erfundene Anrufliste – in der Form, in der sie auch das FRITZ!Box-Plugin liefert. */
function publishCalls(context: {
  resources: { set(name: string, value: unknown): void };
  routes: { get(path: string, handler: (request: { params: Record<string, string> }) => Response): void };
}): void {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const call = (id: string, kind: string, name: string, number: string, minutesAgo: number, minutes: number, voicemail = false) => ({ id, kind, name, number, date: ago(minutesAgo), minutes, device: voicemail ? 'Anrufbeantworter' : 'Küche', voicemail });
  context.resources.set('calls', [
    { ...call('9', 'missed', '', '0821 5550177', 35, 0), place: 'Augsburg' },
    call('8', 'incoming', 'Jonas Beispiel', '0151 5550100', 140, 1, true),
    call('7', 'incoming', 'Tante Rosa', '0821 5550101', 60 * 5, 23),
    call('6', 'outgoing', 'Praxis Dr. Muster', '0821 5550123', 60 * 27, 4),
    { ...call('5', 'rejected', '', '0900 5550199', 60 * 50, 0), place: 'Sonderrufnummer' },
    { ...call('5b', 'missed', '', '0043 1 5550144', 60 * 70, 0), place: 'Wien, Österreich' },
    call('4', 'missed', '', '', 60 * 24 * 4, 0),
    ...Array.from({ length: 8 }, (_, index) => call(String(3 - index), 'incoming', '', `0821 55502${10 + index}`, 60 * 24 * (9 + index * 3), 2 + index)),
  ]);
  // Die „Aufnahme“ ist ein erzeugter Ton von einer Sekunde – so lässt sich das Abspielen prüfen
  context.routes.get('/voicemail/:id', (request) => {
    if (request.params.id !== '8') return Response.json({ error: 'Zu diesem Anruf gibt es keine Aufnahme.' }, { status: 404 });
    const rate = 8000;
    const samples = new Int16Array(rate);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.round(Math.sin((index / rate) * 2 * Math.PI * 440) * 9000 * Math.min(1, (samples.length - index) / 2000));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + samples.byteLength, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(samples.byteLength, 40);
    return new Response(new Uint8Array(Buffer.concat([header, Buffer.from(samples.buffer)])), { headers: { 'Content-Type': 'audio/wav' } });
  });
}

export default definePlugin({
  id: 'connector-demo',

  start(context) {
    const switches = new Map<string, boolean>([
      ['licht_esstisch', true],
      ['licht_vitrine', true],
      ['licht_treppe', false],
      ['licht_terrasse', false],
    ]);

    // Eine Markise: 0 % eingefahren, 100 % ausgefahren; sie fährt in kleinen Schritten zu ihrem Ziel
    const awning = { position: 0, target: 0 };
    const publishAwning = () => context.datapoints.set({ id: 'markise', value: awning.position, unit: '%', label: 'Markise', writable: true });
    const drive = setInterval(() => {
      if (awning.position === awning.target) return;
      awning.position += Math.sign(awning.target - awning.position) * Math.min(10, Math.abs(awning.target - awning.position));
      publishAwning();
    }, 500);
    context.signal.addEventListener('abort', () => clearInterval(drive));
    publishAwning();

    // Wetter zum Vorzeigen: Der Wind dreht in einer Stunde einmal rundum, der UV-Index folgt dem Sonnenstand.
    const publishWeather = (now: number) => {
      const hour = hourOf(now);
      const set = (id: string, value: DatapointValue, unit?: string) => context.datapoints.set({ id, value, ...(unit ? { unit } : {}) });
      set('wetter_code', '802');
      set('wetter_text', 'Mäßig bewölkt');
      set('wind_richtung', Math.round(((now / 3_600_000) % 1) * 360), '°');
      set('wind', Math.round((14 + 10 * Math.sin(now / 240_000)) * 10) / 10, 'km/h');
      set('uv', Math.max(0, Math.round(7 * Math.sin(((hour - 6) / 14) * Math.PI))));
      FORECAST.forEach(([text, max, min], day) => {
        set(`tag${day}_text`, text);
        set(`tag${day}_max`, max, '°C');
        set(`tag${day}_min`, min, '°C');
      });
    };

    const publish = () => {
      const now = Date.now();
      for (const [id, curve] of Object.entries(CURVES)) {
        context.datapoints.set({ id, value: Math.round(curve.at(hourOf(now), now) * 10) / 10, unit: curve.unit, label: curve.label });
      }
      context.datapoints.set({ id: 'waschen', value: 'läuft', label: 'Waschmaschine' });
      // Zwei Autos – eines lädt tagsüber, eines wird leergefahren – und wer gerade zu Hause ist
      const charge = Math.round(Math.min(100, 35 + hourOf(now) * 3));
      context.datapoints.set({ id: 'auto_strom', value: charge, unit: '%', label: 'Stromer' });
      context.datapoints.set({ id: 'auto_strom_km', value: Math.round(charge * 4.7), unit: 'km', label: 'Stromer: Reichweite' });
      context.datapoints.set({ id: 'auto_tank', value: 18, unit: '%', label: 'Kombi' });
      // Der Kombi meldet sich nur jede zweite Minute – dazwischen gelten seine Werte als veraltet
      context.datapoints.set({ id: 'auto_tank_frisch', value: Math.floor(now / 60_000) % 2 === 0, label: 'Kombi: Daten aktuell' });
      context.datapoints.set({ id: 'nie_frisch', value: false, label: 'Nie aktuell' });
      context.datapoints.set({ id: 'auto_tank_km', value: 130, unit: 'km', label: 'Kombi: Reichweite' });
      context.datapoints.set({ id: 'daheim_anna', value: true, label: 'Anna' });
      context.datapoints.set({ id: 'daheim_ben', value: 'daheim', label: 'Ben' });
      context.datapoints.set({ id: 'daheim_cleo', value: false, label: 'Cleo' });
      context.datapoints.set({ id: 'daheim_dana', value: 'weg', label: 'Dana' });
      publishWeather(now);
      for (const [id, on] of switches) context.datapoints.set({ id, value: on, writable: true });
      context.datapoints.set({ id: 'ringing', value: Math.floor(now / 1000) % 180 < 20 ? '0821 5550101' : '' });
    };

    publish();
    publishAgenda(context);
    publishMail(context);
    publishCalls(context);
    const timer = setInterval(publish, TICK_MS);
    context.signal.addEventListener('abort', () => clearInterval(timer));

    context.onCommand((id: string, value: DatapointValue) => {
      if (id === 'markise') {
        if (value !== 'up' && value !== 'down' && value !== 'stop') return Promise.reject(new Error('Die Markise versteht nur up, down und stop.'));
        awning.target = value === 'up' ? 0 : value === 'down' ? 100 : awning.position;
        return Promise.resolve();
      }
      if (!switches.has(id)) return Promise.reject(new Error(`"${id}" ist kein Schalter.`));
      switches.set(id, value === true);
      context.datapoints.set({ id, value: value === true, writable: true });
      return Promise.resolve();
    });

    context.provideHistory((id, from, to) => {
      const curve = CURVES[id];
      const points: SeriesPoint[] = [];
      if (curve) {
        const step = Math.max(60_000, Math.round((to.getTime() - from.getTime()) / 600));
        for (let time = from.getTime(); time <= to.getTime(); time += step) points.push([time, Math.round(curve.at(hourOf(time), time) * 10) / 10]);
      }
      return Promise.resolve(points);
    });

    context.log.info(`Beispielwerte laufen (${Object.keys(CURVES).length} Messwerte, ${switches.size} Schalter).`);
  },
});
