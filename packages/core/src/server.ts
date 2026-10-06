import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Datapoint, DatapointValue } from '@culinola/sdk';
import { type ActionRegistry, InvalidParams, UnknownAction } from './actions.ts';
import type { AppConfig } from './config.ts';
import type { PluginHost } from './plugins.ts';
import type { DatapointRegistry } from './registry.ts';
import { type Aggregation, downsample, parseDuration, parseTime } from './series.ts';

const AGGREGATIONS: readonly Aggregation[] = ['avg', 'min', 'max', 'last'];

export interface ServerDeps {
  config: AppConfig;
  registry: DatapointRegistry;
  plugins: PluginHost;
  actions: ActionRegistry;
  /** Ordner mit der gebauten Oberfläche; fehlt er, läuft nur die API. */
  uiDir?: string;
}

export async function buildServer({ config, registry, plugins, actions, uiDir }: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  // Eingabefehler als 400 mit lesbarer Meldung statt als 500
  class BadRequest extends Error {}
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof BadRequest || error instanceof InvalidParams) return reply.code(400).send({ error: error.message });
    if (error instanceof UnknownAction) return reply.code(404).send({ error: error.message });
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

  app.get('/api/v1/status', () => ({ sources: plugins.status, datapoints: registry.all().length }));

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

  app.get('/api/v1/actions', () => actions.list());

  app.post<{ Params: { name: string }; Body: Record<string, unknown> | null }>('/api/v1/actions/:name', async (request) => {
    const result = await actions.run(request.params.name, request.body ?? {});
    return { ok: true, result: result ?? null };
  });

  app.get<{ Params: { id: string } }>('/api/v1/layouts/:id', (request, reply) => {
    const layout = config.layouts[request.params.id];
    return layout ?? reply.code(404).send({ error: `Layout "${request.params.id}" ist unbekannt.` });
  });

  // Echtzeitkanal: Die Anzeige abonniert Themen ("dp/*", "dp/openhab:*", "dp/<Kennung>")
  // und bekommt zuerst den aktuellen Stand, danach jede Änderung.
  app.get('/api/v1/stream', { websocket: true }, (socket) => {
    let topics: string[] = [];
    const matches = (id: string) => topics.some((topic) => (topic.endsWith('*') ? `dp/${id}`.startsWith(topic.slice(0, -1)) : topic === `dp/${id}`));
    const send = (datapoint: Datapoint) => socket.send(JSON.stringify({ t: `dp/${datapoint.id}`, d: datapoint }));
    const onChange = (datapoint: Datapoint) => {
      if (matches(datapoint.id)) send(datapoint);
    };

    registry.on('change', onChange);
    socket.on('close', () => registry.off('change', onChange));
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
