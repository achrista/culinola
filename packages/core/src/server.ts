import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Datapoint, DatapointValue, Logger } from '@culinola/sdk';
import { type AccessToken, authorize, bearerToken, requiredRole } from './access.ts';
import { type ActionRegistry, InvalidParams, UnknownAction } from './actions.ts';
import type { AppConfig } from './config.ts';
import { EmbedCheck } from './embed.ts';
import { type EventHub, type Raised, UnknownEvent } from './events.ts';
import type { PluginHost } from './plugins.ts';
import type { DatapointRegistry } from './registry.ts';
import { type Aggregation, downsample, parseDuration, parseTime } from './series.ts';

const AGGREGATIONS: readonly Aggregation[] = ['avg', 'min', 'max', 'last'];
/** So groß darf sein, was ein Plugin entgegennimmt – genug für ein Dokument oder ein Foto. */
const PLUGIN_BODY_LIMIT = 25_000_000;

export interface ServerDeps {
  config: AppConfig;
  registry: DatapointRegistry;
  plugins: PluginHost;
  actions: ActionRegistry;
  events: EventHub;
  log: Logger;
  /** Zugelassene Zugänge; leer = API offen. */
  access: readonly AccessToken[];
  /** Ordner mit der gebauten Oberfläche; fehlt er, läuft nur die API. */
  uiDir?: string;
  /** Zertifikat und Schlüssel: Mit ihnen spricht dieser Server HTTPS. */
  tls?: { cert: Buffer; key: Buffer };
}

export async function buildServer({ config, registry, plugins, actions, events, log, access, uiDir, tls }: ServerDeps): Promise<FastifyInstance> {
  // Mit und ohne Zertifikat ist es derselbe Server; nur die Art der Verbindung unterscheidet sich
  const app = (tls ? Fastify({ logger: false, https: tls }) : Fastify({ logger: false })) as unknown as FastifyInstance;
  await app.register(fastifyWebsocket);

  // Eingabefehler als 400 mit lesbarer Meldung statt als 500
  class BadRequest extends Error {}
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof BadRequest || error instanceof InvalidParams) return reply.code(400).send({ error: error.message });
    if (error instanceof UnknownAction || error instanceof UnknownEvent) return reply.code(404).send({ error: error.message });
    // Was der Server selbst am Aufruf beanstandet – zu groß, nicht lesbar –, ist ebenfalls ein Fehler des Aufrufers
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) return reply.code(413).send({ error: 'Die Datei ist zu groß.' });
    if (status !== undefined && status >= 400 && status < 500) return reply.code(status).send({ error: error.message });
    app.log.error(error);
    return reply.code(500).send({ error: error.message });
  });
  const input = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error) {
      throw new BadRequest(error instanceof Error ? error.message : String(error));
    }
  };

  // Zugriffsschutz für alles unter /api. Nur der Echtzeitkanal nimmt das Token als
  // Adresszusatz an, weil Browser dort keine eigene Kopfzeile mitschicken können;
  // überall sonst bleibt es aus der Adresse heraus, damit es in keinem Protokoll landet.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    // Auch Ton- und Bildelemente des Browsers können keine Kopfzeile setzen – deshalb gilt
    // dieselbe Ausnahme für lesende Aufrufe an Plugin-Adressen.
    const mayUseAddress = request.url.startsWith('/api/v1/stream') || (request.method === 'GET' && request.url.startsWith('/api/v1/p/'));
    const fromAddress = mayUseAddress ? (request.query as { token?: string } | undefined)?.token : undefined;
    const presented = bearerToken(request.headers.authorization) ?? fromAddress;
    const result = authorize(access, presented, requiredRole(request.method));
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
  });

  app.get('/api/v1/status', () => ({ sources: plugins.status, datapoints: registry.all().length, protected: access.length > 0 }));

  app.get('/api/v1/site', () => config.site ?? {});

  app.get('/api/v1/datapoints', () => registry.all());

  app.get<{ Params: { id: string } }>('/api/v1/datapoints/:id', (request, reply) => {
    const datapoint = registry.get(request.params.id);
    return datapoint ?? reply.code(404).send({ error: `Datenpunkt "${request.params.id}" ist unbekannt.` });
  });

  app.post<{ Params: { id: string }; Body: { value?: DatapointValue } }>('/api/v1/datapoints/:id/command', async (request, reply) => {
    const datapoint = registry.get(request.params.id);
    if (!datapoint) return reply.code(404).send({ error: `Datenpunkt "${request.params.id}" ist unbekannt.` });
    if (!datapoint.writable) return reply.code(409).send({ error: `Datenpunkt "${datapoint.id}" ist nicht schreibbar.` });
    if (request.body?.value === undefined) throw new BadRequest('Im Rumpf fehlt "value".');
    await plugins.command(datapoint.id, request.body.value);
    return { ok: true };
  });

  app.get<{ Querystring: { ids?: string; from?: string; to?: string; step?: string; agg?: string } }>('/api/v1/series', async (request) => {
    const query = request.query;
    const now = Date.now();
    const { ids, from, to, step, aggregation } = input(() => {
      const aggregation = (query.agg ?? 'avg') as Aggregation;
      if (!AGGREGATIONS.includes(aggregation)) throw new Error(`Unbekannte Verdichtung "${query.agg}".`);
      return {
        ids: (query.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean),
        from: parseTime(query.from ?? '-24h', now),
        to: query.to ? parseTime(query.to, now) : now,
        step: query.step ? parseDuration(query.step) : 0,
        aggregation,
      };
    });
    if (ids.length === 0) throw new BadRequest('Parameter "ids" fehlt.');

    const series = await Promise.all(
      ids.map(async (id) => {
        const points = await plugins.history(id, from, to);
        return { id, unit: registry.get(id)?.unit, points: step > 0 ? downsample(points, step, aggregation) : points };
      }),
    );
    return { from, to, series };
  });

  app.get<{ Params: { instance: string; name: string } }>('/api/v1/resources/:instance/:name', (request, reply) => {
    const key = `${request.params.instance}/${request.params.name}`;
    return plugins.resources.has(key) ? plugins.resources.get(key) : reply.code(404).send({ error: `Verzeichnis "${key}" ist unbekannt.` });
  });

  // Dateien kommen als rohe Bytes an und werden unverändert an das Plugin gereicht
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  // Adressen der Plugins. Antworten dürfen fortlaufende Datenströme sein; beendet die
  // Anzeige die Verbindung, erfährt es das Plugin über das Signal und kann die Quelle schließen.
  for (const route of plugins.routes) {
    app.route({
      method: route.method,
      url: `/api/v1/p/${route.instance}${route.path}`,
      ...(route.method === 'POST' ? { bodyLimit: PLUGIN_BODY_LIMIT } : {}),
      handler: async (request, reply) => {
        const gone = new AbortController();
        reply.raw.on('close', () => gone.abort());
        const response = await route.handler({
          params: request.params as Record<string, string>,
          query: request.query as Record<string, string>,
          body: request.body,
          signal: gone.signal,
        });
        reply.code(response.status);
        response.headers.forEach((value, name) => reply.header(name, value));
        return reply.send(response.body ? Readable.fromWeb(response.body as import('node:stream/web').ReadableStream) : null);
      },
    });
  }

  app.get('/api/v1/actions', () => actions.list());

  app.post<{ Params: { name: string }; Body: Record<string, unknown> | null }>('/api/v1/actions/:name', async (request) => {
    const params = request.body ?? {};
    try {
      const result = await actions.run(request.params.name, params);
      log.info(`Aktion ${request.params.name} ${JSON.stringify(params)} ausgeführt.`);
      return { ok: true, result: result ?? null };
    } catch (error) {
      log.warn(`Aktion ${request.params.name} ${JSON.stringify(params)} fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });

  // Meldungen: Was sie auf der Anzeige tun, steht in der Konfiguration; ausgelöst werden sie hier – etwa aus einer openHAB-Regel.
  app.get('/api/v1/events', () => events.list());

  app.post<{ Params: { name: string }; Body: { text?: unknown } | null }>('/api/v1/events/:name', (request) => {
    const text = request.body?.text;
    if (text !== undefined && typeof text !== 'string') throw new BadRequest('"text" muss ein Text sein.');
    const raised = events.raise(request.params.name, text);
    return { ok: true, id: raised.id };
  });

  // Fremde Seiten in einer Kachel: Viele Seiten verbieten das Einbetten, und der Browser zeigt dann nur eine
  // leere Fläche. Der Kern sieht nach und sagt der Anzeige, woran es liegt – nur für Seiten, die im Layout stehen.
  const embeds = new EmbedCheck(config.layouts);
  app.get<{ Querystring: { url?: string } }>('/api/v1/embed', async (request) => {
    const url = request.query.url ?? '';
    if (!embeds.allows(url)) throw new BadRequest('Diese Adresse steht in keiner Kachel "web".');
    return embeds.check(url, request.headers.host);
  });

  app.get<{ Params: { id: string } }>('/api/v1/layouts/:id', (request, reply) => {
    const layout = config.layouts[request.params.id];
    return layout ?? reply.code(404).send({ error: `Layout "${request.params.id}" ist unbekannt.` });
  });

  // Echtzeitkanal: Die Anzeige abonniert Themen ("dp/*", "dp/openhab:*", "dp/<Kennung>")
  // und bekommt zuerst den aktuellen Stand, danach jede Änderung. Mit "event/*" kommen die
  // Meldungen dazu – nur neue, keine vergangenen.
  app.get('/api/v1/stream', { websocket: true }, (socket) => {
    let topics: string[] = [];
    const matches = (id: string) => topics.some((topic) => (topic.endsWith('*') ? `dp/${id}`.startsWith(topic.slice(0, -1)) : topic === `dp/${id}`));
    const send = (datapoint: Datapoint) => socket.send(JSON.stringify({ t: `dp/${datapoint.id}`, d: datapoint }));
    const onChange = (datapoint: Datapoint) => {
      if (matches(datapoint.id)) send(datapoint);
    };

    registry.on('change', onChange);
    const stopEvents = events.onRaised((raised: Raised) => {
      if (topics.includes('event/*') || topics.includes(`event/${raised.name}`)) socket.send(JSON.stringify({ t: `event/${raised.name}`, d: raised }));
    });
    socket.on('close', () => {
      registry.off('change', onChange);
      stopEvents();
    });
    socket.on('message', (data: Buffer) => {
      let message: { op?: string; topics?: unknown };
      try {
        message = JSON.parse(data.toString()) as typeof message;
      } catch {
        return;
      }
      if (message.op !== 'sub' || !Array.isArray(message.topics)) return;
      topics = message.topics.filter((topic): topic is string => typeof topic === 'string');
      for (const datapoint of registry.all()) {
        if (matches(datapoint.id)) send(datapoint);
      }
    });
  });

  if (uiDir && existsSync(uiDir)) {
    await app.register(fastifyStatic, { root: uiDir });
  }

  return app;
}
