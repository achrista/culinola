import { definePlugin, InvalidInput } from '@culinola/sdk';
import { icyFilter } from './icy.ts';
import { LogoStore } from './logos.ts';

interface Station {
  id: string;
  name: string;
  /** Adresse des Tonstroms. Fernsehsender brauchen keine – ihr Bild kommt über das Video-Plugin. */
  url?: string;
  /** audio = Radio, video = Fernsehen (läuft im Medienfenster). */
  kind: 'audio' | 'video';
  /**
   * Logo des Senders für das Medienfenster: eine Adresse, von der es einmal geholt wird,
   * oder der Name einer Datei im Ordner `logos` des Plugins.
   */
  image?: string;
}

interface Config {
  stations: Station[];
  /** Lautstärke beim Start in Prozent; über 100 verstärkt. */
  volume: number;
}

const MAX_VOLUME = 150;
const VOLUME_STEP = 5;
const STATION_ID = /^[a-z0-9][a-z0-9-]*$/;

export default definePlugin<Config>({
  id: 'media-radio',

  parseConfig(raw) {
    const config = raw as Partial<Config>;
    if (!Array.isArray(config.stations)) throw new Error('"stations" fehlt oder ist keine Liste.');
    const seen = new Set<string>();
    for (const station of config.stations) {
      if (!STATION_ID.test(station.id ?? '')) throw new Error(`Sender "${station.name ?? '?'}": "id" fehlt oder enthält anderes als Kleinbuchstaben, Ziffern und Bindestriche.`);
      if (seen.has(station.id)) throw new Error(`Sender-Kennung "${station.id}" ist doppelt vergeben.`);
      seen.add(station.id);
      if (!station.name) throw new Error(`Sender "${station.id}": "name" fehlt.`);
      if (station.kind === 'audio' && !/^https?:\/\//.test(station.url ?? '')) throw new Error(`Sender "${station.id}": "url" fehlt oder beginnt nicht mit http:// bzw. https://.`);
      if (station.kind !== 'audio' && station.kind !== 'video') throw new Error(`Sender "${station.id}": "kind" muss "audio" oder "video" sein.`);
    }
    return { stations: config.stations, volume: clampVolume(config.volume ?? 50) };
  },

  start(context) {
    const { config, log } = context;
    const stations = new Map(config.stations.map((station) => [station.id, station]));
    let current = '';
    let volume = config.volume;

    const publish = () => {
      context.datapoints.set({ id: 'station', value: current, label: 'Laufender Sender' });
      context.datapoints.set({ id: 'volume', value: volume, unit: '%', label: 'Lautstärke' });
    };
    const setTitle = (title: string) => context.datapoints.set({ id: 'title', value: title, label: 'Laufender Titel' });

    // Senderlogos: eine Adresse wird einmal geholt und aufbewahrt, ein Dateiname meint eine selbst abgelegte Datei
    const logos = new LogoStore(context.storageDir);
    const logoOf = (station: Station) => (station.image && !/^https?:\/\//.test(station.image) ? logos.local(station.image) : logos.find(station.id));

    // Die Anzeige bekommt die Senderliste ohne die Adressen der Streams – Ton und Logos holt sie über den Kern.
    const publishStations = () =>
      context.resources.set(
        'stations',
        config.stations.map((station) => ({
          id: station.id,
          name: station.name,
          kind: station.kind,
          ...(station.image && logoOf(station) ? { image: `/p/${context.instanceId}/logo/${station.id}` } : {}),
        })),
      );
    publishStations();
    publish();
    setTitle('');

    void Promise.all(
      config.stations
        .filter((station) => /^https?:\/\//.test(station.image ?? ''))
        .map(async (station) => {
          const problem = await logos.fetch(station.id, station.image!, context.signal);
          if (problem) log.warn(`Logo für "${station.name}" nicht geholt: ${problem}${logos.find(station.id) ? ' – das bisherige bleibt.' : ''}`);
        }),
    ).then(publishStations);

    context.routes.get('/logo/:id', (request) => {
      const station = stations.get(request.params.id ?? '');
      const logo = station ? logoOf(station) : undefined;
      if (!logo) return Response.json({ error: 'Kein Logo vorhanden.' }, { status: 404 });
      return new Response(new Uint8Array(logos.read(logo)), { headers: { 'Content-Type': logo.contentType, 'Cache-Control': 'private, max-age=86400' } });
    });

    context.actions.register(
      {
        name: 'radio.play',
        description: 'Schaltet einen Radio- oder Fernsehsender ein.',
        params: { station: { type: 'string', description: `Kennung des Senders: ${[...stations.keys()].join(', ')}`, required: true } },
      },
      ({ station }) => {
        if (!stations.has(String(station))) throw new InvalidInput(`Sender "${station}" ist unbekannt.`);
        current = String(station);
        setTitle('');
        publish();
      },
    );

    context.actions.register({ name: 'radio.stop', description: 'Schaltet Radio und Fernsehen aus.' }, () => {
      current = '';
      setTitle('');
      publish();
    });

    context.actions.register(
      {
        name: 'radio.volume',
        description: `Stellt die Lautstärke: entweder auf einen Wert von 0 bis ${MAX_VOLUME} Prozent oder schrittweise lauter und leiser.`,
        params: {
          level: { type: 'number', description: `Lautstärke in Prozent, 0 bis ${MAX_VOLUME}` },
          delta: { type: 'number', description: `Änderung in Prozent, z. B. ${VOLUME_STEP} für lauter und -${VOLUME_STEP} für leiser` },
        },
      },
      ({ level, delta }) => {
        if (typeof level === 'number') volume = clampVolume(level);
        else if (typeof delta === 'number') volume = clampVolume(volume + delta);
        else throw new InvalidInput('Angabe "level" oder "delta" fehlt.');
        publish();
      },
    );

    // Der Ton läuft über den Kern zur Anzeige. So spielt er auch dann, wenn der Sender nur
    // unverschlüsselt sendet, und der eingebettete Titel lässt sich unterwegs herauslesen.
    context.routes.get('/stream/:id', async (request) => {
      const station = stations.get(request.params.id ?? '');
      if (!station || station.kind !== 'audio' || !station.url) return Response.json({ error: 'Sender unbekannt oder kein Radiosender.' }, { status: 404 });

      let upstream: Response;
      try {
        upstream = await fetch(station.url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'Culinola' }, signal: request.signal });
      } catch (error) {
        log.warn(`Sender "${station.name}" ist nicht erreichbar: ${error instanceof Error ? error.message : String(error)}`);
        return Response.json({ error: `Sender "${station.name}" ist nicht erreichbar.` }, { status: 502 });
      }
      if (!upstream.ok || !upstream.body) {
        log.warn(`Sender "${station.name}" antwortet mit ${upstream.status}.`);
        return Response.json({ error: `Sender "${station.name}" antwortet mit ${upstream.status}.` }, { status: 502 });
      }

      const headers = { 'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg', 'Cache-Control': 'no-store' };
      const interval = Number(upstream.headers.get('icy-metaint')) || 0;
      if (interval <= 0) return new Response(upstream.body, { headers });
      const onTitle = (title: string) => {
        if (current === station.id) setTitle(title);
      };
      return new Response(upstream.body.pipeThrough(icyFilter(interval, onTitle)), { headers });
    });

    log.info(`${stations.size} Sender eingerichtet.`);
  },
});

function clampVolume(value: number): number {
  return Math.min(MAX_VOLUME, Math.max(0, Math.round(value)));
}
