import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Datapoint, DatapointValue, Logger } from '@culinola/sdk';
import { type AccessToken, type Role, authorize, bearerToken, requiredRole } from './access.ts';
import { type ActionRegistry, InvalidParams, UnknownAction } from './actions.ts';
import type { AppConfig } from './config.ts';
import { EmbedCheck } from './embed.ts';
import { type EventHub, type Raised, UnknownEvent } from './events.ts';
import { InvalidLayout, LayoutConflict, type LayoutStore, UnknownLayout } from './layouts.ts';
import type { PluginHost } from './plugins.ts';
import type { DatapointRegistry } from './registry.ts';
import { type Aggregation, downsample, parseDuration, parseTime } from './series.ts';
import { InvalidSettings, SettingsConflict, type SettingsStore, UnknownAccess } from './settings.ts';
import { InvalidSource, SourceConflict, type SourceStore, UnknownSource } from './sources.ts';
import type { Template } from './templates.ts';

const AGGREGATIONS: readonly Aggregation[] = ['avg', 'min', 'max', 'last'];
/** So groß darf sein, was ein Plugin entgegennimmt – genug für ein Dokument oder ein Foto. */
const PLUGIN_BODY_LIMIT = 25_000_000;

export interface ServerDeps {
  config: AppConfig;
  registry: DatapointRegistry;
  plugins: PluginHost;
  actions: ActionRegistry;
  events: EventHub;
  /** Die Layouts – ein Speicher für alle Server, damit jede Anzeige von jeder Änderung erfährt. */
  layouts: LayoutStore;
  /** Die Quellen zum Einrichten; ohne sie gibt es die Aufrufe unter `/sources` nicht. */
  sources?: SourceStore;
  /** Anzeige, Meldungen und Zugänge zum Einrichten; ohne sie gibt es die Aufrufe unter `/settings` nicht. */
  settings?: SettingsStore;
  /** Mitgelieferte Vorlagen für neue Layouts. */
  templates?: readonly Template[];
  log: Logger;
  /** Zugelassene Zugänge; leer = API offen. */
  access: readonly AccessToken[];
  /** Ordner mit der gebauten Oberfläche; fehlt er, läuft nur die API. */
  uiDir?: string;
  /** Zertifikat und Schlüssel: Mit ihnen spricht dieser Server HTTPS. */
  tls?: { cert: Buffer; key: Buffer };
}

export async function buildServer({ config, registry, plugins, actions, events, layouts, sources, settings, templates = [], log, access, uiDir, tls }: ServerDeps): Promise<FastifyInstance> {
  // Mit und ohne Zertifikat ist es derselbe Server; nur die Art der Verbindung unterscheidet sich
  const app = (tls ? Fastify({ logger: false, https: tls }) : Fastify({ logger: false })) as unknown as FastifyInstance;
  await app.register(fastifyWebsocket);

  // Eingabefehler als 400 mit lesbarer Meldung statt als 500
  class BadRequest extends Error {}
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof BadRequest || error instanceof InvalidParams || error instanceof InvalidLayout || error instanceof InvalidSource || error instanceof InvalidSettings) return reply.code(400).send({ error: error.message });
    if (error instanceof UnknownAction || error instanceof UnknownEvent || error instanceof UnknownLayout || error instanceof UnknownSource || error instanceof UnknownAccess) return reply.code(404).send({ error: error.message });
    // Jemand anderes war schneller: Der Aufrufer bekommt den Stand, der jetzt gilt, und entscheidet
    if (error instanceof SourceConflict || error instanceof SettingsConflict) return reply.code(409).send({ error: error.message });
    if (error instanceof LayoutConflict) return reply.code(409).send({ error: error.message, ...(error.rev ? { rev: error.rev } : {}) });
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
  // Adressen der Plugins werden bei jedem Aufruf nachgeschlagen: Quellen kommen und gehen im Betrieb
  const PLUGIN_PREFIX = '/api/v1/p/';
  const pluginRoute = (method: string, url: string) => {
    if (!url.startsWith(PLUGIN_PREFIX)) return undefined;
    const path = url.slice(PLUGIN_PREFIX.length).split('?')[0]!;
    const slash = path.indexOf('/');
    return slash < 1 ? undefined : plugins.route(method, path.slice(0, slash), path.slice(slash));
  };

  const granted = new WeakMap<object, { name: string; role: Role }>();
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    // Auch Ton- und Bildelemente des Browsers können keine Kopfzeile setzen – deshalb gilt
    // dieselbe Ausnahme für lesende Aufrufe an Plugin-Adressen.
    const mayUseAddress = request.url.startsWith('/api/v1/stream') || (request.method === 'GET' && request.url.startsWith('/api/v1/p/'));
    const fromAddress = mayUseAddress ? (request.query as { token?: string } | undefined)?.token : undefined;
    const presented = bearerToken(request.headers.authorization) ?? fromAddress;
    // Eine Adresse kann ihre Stufe selbst nennen – etwa ein POST, der nur liest, oder das Einrichten
    const declared = (request.routeOptions?.config as { role?: Role } | undefined)?.role ?? pluginRoute(request.method, request.url)?.route.role;
    const result = authorize(access, presented, declared ?? requiredRole(request.method));
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    granted.set(request.raw, { name: result.name, role: result.role });
  });

  // Was der vorgelegte Zugang darf – damit die Oberfläche nur anbietet, was der Kern auch annimmt
  app.get('/api/v1/access', (request) => granted.get(request.raw));

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
  app.route({
    method: ['GET', 'POST'],
    url: `${PLUGIN_PREFIX}*`,
    bodyLimit: PLUGIN_BODY_LIMIT,
    handler: async (request, reply) => {
      const found = pluginRoute(request.method, request.url);
      if (!found) return reply.code(404).send({ error: 'Diese Adresse gibt es nicht.' });
      const gone = new AbortController();
      reply.raw.on('close', () => gone.abort());
      const response = await found.route.handler({
        params: found.params,
        query: request.query as Record<string, string>,
        body: request.body,
        signal: gone.signal,
      });
      reply.code(response.status);
      response.headers.forEach((value, name) => reply.header(name, value));
      return reply.send(response.body ? Readable.fromWeb(response.body as import('node:stream/web').ReadableStream) : null);
    },
  });

  // Quellen einrichten: Einstellungen und Zugangsdaten ändern, einzeln neu starten. Auch das Lesen braucht die
  // Stufe zum Einrichten – in den Einstellungen stehen Adressen und Namen aus dem Haus. Zugangsdaten kommen nie zurück.
  if (sources) {
    const admin = { config: { role: 'admin' as const } };
    type Body = { id?: unknown; plugin?: unknown; config?: unknown; secrets?: unknown } | null;
    app.get('/api/v1/sources', admin, () => sources.list());
    app.get('/api/v1/plugins', admin, () => sources.plugins());
    app.post<{ Body: Body }>('/api/v1/sources', admin, (request) => sources.create(request.body ?? {}));
    app.put<{ Params: { id: string }; Body: Body }>('/api/v1/sources/:id', admin, (request) => sources.update(request.params.id, request.body ?? {}));
    app.post<{ Params: { id: string } }>('/api/v1/sources/:id/restart', admin, (request) => sources.restart(request.params.id));
    app.delete<{ Params: { id: string } }>('/api/v1/sources/:id', admin, async (request) => {
      await sources.remove(request.params.id);
      return { ok: true };
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

  app.get('/api/v1/layouts', () => layouts.ids().map((id) => ({ id, grid: layouts.get(id)?.grid, widgets: layouts.get(id)?.widgets?.length ?? 0, rev: layouts.rev(id) })));

  // Mit dem Layout kommt sein Stand ("rev"); wer es ändert, schickt ihn beim Speichern wieder mit
  app.get<{ Params: { id: string } }>('/api/v1/layouts/:id', (request, reply) => {
    const layout = layouts.get(request.params.id);
    return layout ? { ...layout, rev: layouts.rev(request.params.id) } : reply.code(404).send({ error: `Layout "${request.params.id}" ist unbekannt.` });
  });

  // Einrichten: Der Kern prüft das Layout, sichert die bisherige Konfiguration und schreibt die neue
  app.put<{ Params: { id: string }; Body: { layout?: unknown; rev?: unknown; force?: unknown } | null }>('/api/v1/layouts/:id', { config: { role: 'admin' } }, (request) => {
    const { layout, rev, force } = request.body ?? {};
    if (layout === undefined) throw new BadRequest('Im Rumpf fehlt "layout".');
    if (force !== true && typeof rev !== 'string') throw new BadRequest('Im Rumpf fehlt "rev" – der Stand, auf dem die Änderung aufbaut.');
    return { ok: true, rev: layouts.save(request.params.id, layout, typeof rev === 'string' ? rev : undefined, force === true) };
  });

  // Anzeige, Meldungen und Zugänge einrichten. Das Token eines neuen Zugangs kommt genau einmal zurück – beim Anlegen.
  if (settings) {
    const admin = { config: { role: 'admin' as const } };
    app.get('/api/v1/settings', admin, () => settings.read());
    app.put<{ Body: unknown }>('/api/v1/settings/site', admin, (request) => settings.setSite(request.body));
    app.put<{ Body: unknown }>('/api/v1/settings/events', admin, (request) => settings.setEvents(request.body));
    app.post<{ Body: { name?: unknown; role?: unknown } | null }>('/api/v1/settings/access', admin, (request) => settings.addAccess(request.body ?? {}));
    app.put<{ Params: { name: string }; Body: { role?: unknown } | null }>('/api/v1/settings/access/:name', admin, (request) => settings.setRole(request.params.name, request.body?.role));
    app.delete<{ Params: { name: string } }>('/api/v1/settings/access/:name', admin, (request) => {
      settings.removeAccess(request.params.name);
      return { ok: true };
    });
  }

  // Neues Layout: leer, als Kopie eines vorhandenen ("copy"), aus einer Vorlage ("template") oder mitgebracht ("layout")
  app.post<{ Body: { id?: unknown; copy?: unknown; template?: unknown; layout?: unknown } | null }>('/api/v1/layouts', { config: { role: 'admin' } }, (request) => {
    const { id, copy, template, layout } = request.body ?? {};
    if (typeof id !== 'string') throw new BadRequest('Im Rumpf fehlt "id" – der Name des neuen Layouts.');
    let start: unknown = layout ?? { grid: { columns: 48, rows: 24 }, widgets: [] };
    if (typeof copy === 'string') {
      start = layouts.get(copy);
      if (!start) throw new UnknownLayout(`Layout "${copy}" ist unbekannt.`);
    } else if (typeof template === 'string') {
      start = templates.find((entry) => entry.id === template)?.layout;
      if (!start) throw new UnknownLayout(`Vorlage "${template}" ist unbekannt.`);
    }
    return { ok: true, id, rev: layouts.create(id, structuredClone(start)) };
  });

  app.post<{ Params: { id: string }; Body: { id?: unknown } | null }>('/api/v1/layouts/:id/rename', { config: { role: 'admin' } }, (request) => {
    const to = request.body?.id;
    if (typeof to !== 'string') throw new BadRequest('Im Rumpf fehlt "id" – der neue Name.');
    layouts.rename(request.params.id, to);
    return { ok: true, id: to };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/layouts/:id', { config: { role: 'admin' } }, (request) => {
    layouts.remove(request.params.id);
    return { ok: true };
  });

  app.get('/api/v1/templates', () => templates.map(({ id, name, text, layout }) => ({ id, name, text, grid: layout.grid, widgets: layout.widgets.length })));

  // Echtzeitkanal: Die Anzeige abonniert Themen ("dp/*", "dp/openhab:*", "dp/<Kennung>")
  // und bekommt zuerst den aktuellen Stand, danach jede Änderung. Mit "event/*" kommen die
  // Meldungen dazu – nur neue, keine vergangenen. Mit "layout/<Name>" erfährt sie, dass ihr Layout geändert wurde.
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
    const stopLayouts = layouts.onChange((id, rev) => {
      if (topics.includes('layout/*') || topics.includes(`layout/${id}`)) socket.send(JSON.stringify({ t: `layout/${id}`, d: { id, ...(rev ? { rev } : {}) } }));
    });
    // Sprache und Farbschema gehen an jede Anzeige, gleich was sie abonniert hat
    const stopSite = settings?.onSite((site) => socket.send(JSON.stringify({ t: 'site', d: site })));
    socket.on('close', () => {
      registry.off('change', onChange);
      stopEvents();
      stopLayouts();
      stopSite?.();
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
