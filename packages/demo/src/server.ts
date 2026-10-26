import type { Datapoint, DatapointValue } from '@culinola/sdk';
import { InvalidParams, UnknownAction } from '../../core/src/actions.ts';
import { EmbedCheck } from '../../core/src/embed.ts';
import { type Raised, UnknownEvent } from '../../core/src/events.ts';
import { InvalidLayout, LayoutConflict, UnknownLayout } from '../../core/src/layouts.ts';
import { type Aggregation, downsample, parseDuration, parseTime } from '../../core/src/series.ts';
import { InvalidSettings, SettingsConflict, UnknownAccess } from '../../core/src/settings.ts';
import { InvalidSource, SourceConflict, UnknownSource } from '../../core/src/sources.ts';
import type { Core } from './core.ts';

// Die API des Kerns im Browser: dieselben Adressen und Antworten wie `packages/core/src/server.ts`, nur ohne
// Netz dazwischen. Zugriffsschutz gibt es nicht – in der Demo darf jeder alles, und es betrifft nur ihn selbst.

class BadRequest extends Error {}
class NotFound extends Error {}

const AGGREGATIONS: readonly Aggregation[] = ['avg', 'min', 'max', 'last'];
const NO_PASSWORD = 'In der Demo gibt es kein Einrichtungskennwort – sie läuft nur in diesem Browser.';

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error instanceof BadRequest || error instanceof InvalidParams || error instanceof InvalidLayout || error instanceof InvalidSource || error instanceof InvalidSettings
      ? 400
      : error instanceof NotFound || error instanceof UnknownAction || error instanceof UnknownEvent || error instanceof UnknownLayout || error instanceof UnknownSource || error instanceof UnknownAccess
        ? 404
        : error instanceof SourceConflict || error instanceof SettingsConflict || error instanceof LayoutConflict
          ? 409
          : 500;
  const rev = error instanceof LayoutConflict && error.rev ? { rev: error.rev } : {};
  if (status === 500) console.error(error);
  return Response.json({ error: message, ...rev }, { status });
}

type Body = Record<string, unknown> | null;
type Handler = (params: Record<string, string>, body: Body, query: URLSearchParams) => unknown;

export function createServer(core: Core) {
  const { config, registry, plugins, actions, events, layouts, sources, settings, templates, log } = core;
  const embeds = new EmbedCheck(config.layouts);
  const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];
  const route = (method: string, path: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_match, key: string) => (keys.push(key), '([^/]+)'))}$`);
    routes.push({ method, pattern, keys, handler });
  };

  route('GET', '/access', () => ({ name: 'demo', role: 'admin' }));
  route('GET', '/status', () => ({ sources: plugins.status, datapoints: registry.all().length, protected: false }));
  route('GET', '/site', () => config.site ?? {});
  route('GET', '/setup', () => ({ protected: false, password: false, pairing: false }));
  for (const [method, path] of [['POST', '/login'], ['POST', '/reset'], ['POST', '/reset/password'], ['PUT', '/settings/password'], ['DELETE', '/settings/password'], ['POST', '/pairing']] as const) {
    route(method, path, () => {
      throw new BadRequest(NO_PASSWORD);
    });
  }
  route('GET', '/settings/pairing', () => []);

  route('GET', '/datapoints', () => registry.all());
  route('GET', '/datapoints/:id', ({ id }) => registry.get(id!) ?? notFound(`Datenpunkt "${id}" ist unbekannt.`));
  route('POST', '/datapoints/:id/command', async ({ id }, body) => {
    const datapoint = registry.get(id!);
    if (!datapoint) notFound(`Datenpunkt "${id}" ist unbekannt.`);
    if (!datapoint.writable) throw new SourceConflict(`Datenpunkt "${datapoint.id}" ist nicht schreibbar.`);
    if (body?.['value'] === undefined) throw new BadRequest('Im Rumpf fehlt "value".');
    await plugins.command(datapoint.id, body['value'] as DatapointValue);
    return { ok: true };
  });

  route('GET', '/series', async (_params, _body, query) => {
    const now = Date.now();
    const aggregation = (query.get('agg') ?? 'avg') as Aggregation;
    let from: number, to: number, step: number;
    try {
      if (!AGGREGATIONS.includes(aggregation)) throw new Error(`Unbekannte Verdichtung "${query.get('agg')}".`);
      from = parseTime(query.get('from') ?? '-24h', now);
      to = query.get('to') ? parseTime(query.get('to')!, now) : now;
      step = query.get('step') ? parseDuration(query.get('step')!) : 0;
    } catch (error) {
      throw new BadRequest(error instanceof Error ? error.message : String(error));
    }
    const ids = (query.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!ids.length) throw new BadRequest('Parameter "ids" fehlt.');
    const series = await Promise.all(
      ids.map(async (id) => {
        const points = await plugins.history(id, from, to);
        return { id, unit: registry.get(id)?.unit, points: step > 0 ? downsample(points, step, aggregation) : points };
      }),
    );
    return { from, to, series };
  });

  route('GET', '/resources/:instance/:name', ({ instance, name }) => {
    const key = `${instance}/${name}`;
    return plugins.resources.has(key) ? plugins.resources.get(key) : notFound(`Verzeichnis "${key}" ist unbekannt.`);
  });

  route('GET', '/sources', () => sources.list());
  route('GET', '/plugins', () => sources.plugins());
  route('POST', '/sources', (_params, body) => sources.create(body ?? {}));
  route('PUT', '/sources/:id', ({ id }, body) => sources.update(id!, body ?? {}));
  route('POST', '/sources/:id/restart', ({ id }) => sources.restart(id!));
  route('DELETE', '/sources/:id', async ({ id }) => {
    await sources.remove(id!);
    return { ok: true };
  });

  route('GET', '/actions', () => actions.list());
  route('POST', '/actions/:name', async ({ name }, body) => {
    const result = await actions.run(name!, body ?? {});
    log.info(`Aktion ${name} ${JSON.stringify(body ?? {})} ausgeführt.`);
    return { ok: true, result: result ?? null };
  });

  route('GET', '/events', () => events.list());
  route('POST', '/events/:name', ({ name }, body) => {
    const text = body?.['text'];
    if (text !== undefined && typeof text !== 'string') throw new BadRequest('"text" muss ein Text sein.');
    return { ok: true, id: events.raise(name!, text).id };
  });

  route('GET', '/embed', (_params, _body, query) => {
    const url = query.get('url') ?? '';
    if (!embeds.allows(url)) throw new BadRequest('Diese Adresse steht in keiner Kachel "web".');
    return embeds.check(url, location.host);
  });

  route('GET', '/layouts', () => layouts.ids().map((id) => ({ id, grid: layouts.get(id)?.grid, widgets: layouts.get(id)?.widgets?.length ?? 0, rev: layouts.rev(id) })));
  route('GET', '/layouts/:id', ({ id }) => {
    const layout = layouts.get(id!);
    return layout ? { ...layout, rev: layouts.rev(id!) } : notFound(`Layout "${id}" ist unbekannt.`);
  });
  route('PUT', '/layouts/:id', ({ id }, body) => {
    const { layout, rev, force } = body ?? {};
    if (layout === undefined) throw new BadRequest('Im Rumpf fehlt "layout".');
    if (force !== true && typeof rev !== 'string') throw new BadRequest('Im Rumpf fehlt "rev" – der Stand, auf dem die Änderung aufbaut.');
    return { ok: true, rev: layouts.save(id!, layout, typeof rev === 'string' ? rev : undefined, force === true) };
  });
  route('POST', '/layouts', (_params, body) => {
    const { id, copy, template, layout } = body ?? {};
    if (typeof id !== 'string') throw new BadRequest('Im Rumpf fehlt "id" – der Name des neuen Layouts.');
    let start: unknown = layout ?? { grid: { columns: 48, rows: 24 }, widgets: [] };
    if (typeof copy === 'string') start = layouts.get(copy) ?? notFound(`Layout "${copy}" ist unbekannt.`);
    else if (typeof template === 'string') start = templates.find((entry) => entry.id === template)?.layout ?? notFound(`Vorlage "${template}" ist unbekannt.`);
    return { ok: true, id, rev: layouts.create(id, structuredClone(start)) };
  });
  route('POST', '/layouts/:id/rename', ({ id }, body) => {
    const to = body?.['id'];
    if (typeof to !== 'string') throw new BadRequest('Im Rumpf fehlt "id" – der neue Name.');
    layouts.rename(id!, to);
    return { ok: true, id: to };
  });
  route('DELETE', '/layouts/:id', ({ id }) => {
    layouts.remove(id!);
    return { ok: true };
  });
  route('GET', '/templates', () => templates.map(({ id, name, text, layout }) => ({ id, name, text, grid: layout.grid, widgets: layout.widgets.length })));

  route('GET', '/settings', () => ({ ...settings.read(), password: false }));
  route('PUT', '/settings/site', (_params, body) => settings.setSite(body));
  route('PUT', '/settings/events', (_params, body) => settings.setEvents(body));
  route('POST', '/settings/access', (_params, body) => settings.addAccess(body ?? {}));
  route('PUT', '/settings/access/:name', ({ name }, body) => settings.setRole(name!, body?.['role']));
  route('DELETE', '/settings/access/:name', ({ name }) => {
    settings.removeAccess(name!);
    return { ok: true };
  });

  /** Beantwortet einen Aufruf an `/api/v1/…` so, wie es der Kern auf dem Server täte. */
  async function handle(method: string, url: URL, body: BodyInit | null | undefined, contentType: string): Promise<Response> {
    const path = url.pathname.replace(/^\/api\/v1/, '');
    try {
      if (path.startsWith('/p/')) return await pluginRoute(method, path.slice(3), url.searchParams, body, contentType);
      const query = url.searchParams;
      const parsed = typeof body === 'string' && body ? (JSON.parse(body) as Body) : null;
      for (const entry of routes) {
        if (entry.method !== method) continue;
        const match = entry.pattern.exec(path);
        if (!match) continue;
        const params = Object.fromEntries(entry.keys.map((key, index) => [key, decodeURIComponent(match[index + 1]!)]));
        return Response.json(await entry.handler(params, parsed, query));
      }
      return Response.json({ error: `Route ${method}:${url.pathname} not found` }, { status: 404 });
    } catch (error) {
      return failure(error);
    }
  }

  async function pluginRoute(method: string, rest: string, query: URLSearchParams, body: BodyInit | null | undefined, contentType: string): Promise<Response> {
    const slash = rest.indexOf('/');
    const found = slash > 0 ? plugins.route(method, rest.slice(0, slash), rest.slice(slash)) : undefined;
    if (!found) return Response.json({ error: 'Diese Adresse gibt es nicht.' }, { status: 404 });
    const raw = contentType.includes('application/octet-stream') ? new Uint8Array(await new Response(body).arrayBuffer()) : typeof body === 'string' && body ? JSON.parse(body) : null;
    return found.route.handler({ params: found.params, query: Object.fromEntries(query), body: raw, signal: new AbortController().signal });
  }

  return { handle };
}

function notFound(message: string): never {
  throw new NotFound(message);
}

/**
 * Der Echtzeitkanal als nachgebildeter WebSocket: Die Anzeige abonniert Themen und bekommt zuerst den
 * aktuellen Stand, danach jede Änderung – wie bei `/api/v1/stream` des Kerns.
 */
export function socketClass(core: Core) {
  const { registry, events, layouts, settings } = core;

  return class DemoSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    private topics: string[] = [];
    private readonly stop: (() => void)[] = [];

    constructor() {
      super();
      const matches = (id: string) => this.topics.some((topic) => (topic.endsWith('*') ? `dp/${id}`.startsWith(topic.slice(0, -1)) : topic === `dp/${id}`));
      const onChange = (datapoint: Datapoint) => {
        if (matches(datapoint.id)) this.deliver({ t: `dp/${datapoint.id}`, d: datapoint });
      };
      registry.on('change', onChange);
      this.stop.push(() => registry.off('change', onChange));
      this.stop.push(
        events.onRaised((raised: Raised) => {
          if (this.topics.includes('event/*') || this.topics.includes(`event/${raised.name}`)) this.deliver({ t: `event/${raised.name}`, d: raised });
        }),
      );
      this.stop.push(
        layouts.onChange((id, rev) => {
          if (this.topics.includes('layout/*') || this.topics.includes(`layout/${id}`)) this.deliver({ t: `layout/${id}`, d: { id, ...(rev ? { rev } : {}) } });
        }),
      );
      this.stop.push(settings.onSite((site) => this.deliver({ t: 'site', d: site })));
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      });
      this.matches = matches;
    }

    private matches: (id: string) => boolean;

    send(data: string): void {
      const message = JSON.parse(data) as { op?: string; topics?: unknown };
      if (message.op !== 'sub' || !Array.isArray(message.topics)) return;
      this.topics = message.topics.filter((topic): topic is string => typeof topic === 'string');
      for (const datapoint of registry.all()) if (this.matches(datapoint.id)) this.deliver({ t: `dp/${datapoint.id}`, d: datapoint });
    }

    close(): void {
      for (const stop of this.stop) stop();
      this.readyState = 3;
    }

    private deliver(message: unknown): void {
      if (this.readyState !== 1) return;
      // Wie über das Netz: erst nach dem laufenden Aufruf, als Text
      const data = JSON.stringify(message);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
    }
  };
}
