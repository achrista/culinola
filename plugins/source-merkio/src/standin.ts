import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MerkioItem } from './merkio.ts';

/**
 * Ein Platzhalter für die Merkio-API, nur für Tests und die Testinstanz: Er bildet auf diesem
 * Rechner die Aufrufe nach, die das Plugin benutzt – Anmeldung mit wechselnden Token, Gruppen,
 * Listen, Einträge und den Echtzeitkanal –, mit einer erfundenen Familie im Arbeitsspeicher.
 */
export interface StandIn {
  url: string;
  /** Konto, mit dem sich der Platzhalter anmelden lässt. */
  account: { email: string; password: string };
  /** Alle Einträge, wie Merkio sie führt. */
  items: MerkioItem[];
  /** Zählt Aufrufe je Art, etwa "POST /auth/login". */
  calls: Map<string, number>;
  /** Lässt alle ausgegebenen Zugangstoken verfallen, wie es Merkio nach Minuten tut. */
  expireAccess(): void;
  /** Lässt auch die Erneuerungstoken verfallen. */
  expireRefresh(): void;
  /** Legt fest, ob das Konto der Familie angehört – ein frisches Konto tut es noch nicht. */
  setMember(member: boolean): void;
  /** Trennt alle offenen Echtzeitkanäle. */
  dropStreams(): void;
  /** Ändert einen Eintrag so, als hätte es jemand am Telefon getan. */
  change(event: 'item_created' | 'item_updated' | 'item_deleted', item: MerkioItem): void;
  close(): Promise<void>;
}

const GROUPS = [
  { id: 1, name: 'Familie' },
  { id: 2, name: 'Verein' },
];
const LISTS = [
  { id: 11, groupId: 1, name: 'Einkauf', type: 'shopping' },
  { id: 12, groupId: 1, name: 'Aufgaben', type: 'todo' },
  { id: 13, groupId: 1, name: 'Baumarkt', type: 'shopping' },
  { id: 21, groupId: 2, name: 'Einkauf', type: 'shopping' },
];
const SEED: [listId: number, name: string, quantity?: string | undefined, unit?: string | undefined, checked?: boolean][] = [
  [11, 'Milch', '2', 'l'],
  [11, 'Butter'],
  [11, 'Eier', '10'],
  [11, 'Tomaten', '500', 'g'],
  [11, 'Brot'],
  [11, 'Kaffee', undefined, undefined, true],
  [12, 'Altglas wegbringen'],
  [13, 'Dübel 8 mm', '20'],
  [21, 'Getränke fürs Sommerfest'],
];

export async function startStandIn(port = 0): Promise<StandIn> {
  const account = { email: 'kueche@example.org', password: 'nur-fuer-den-platzhalter' };
  const items: MerkioItem[] = SEED.map(([listId, name, quantity, unit, checked], index) => ({
    id: 100 + index,
    listId,
    name,
    category: null,
    quantity: quantity ?? null,
    unit: unit ?? null,
    checked: checked ? 1 : 0,
    checkedAt: checked ? new Date(Date.now() - 3_600_000).toISOString() : null,
    position: index,
  }));
  const calls = new Map<string, number>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  const streams = new Map<ServerResponse, number>();
  let serial = 0;
  let member = true;
  let nextId = 500;

  const tokens = () => {
    const pair = { accessToken: `zugang-${++serial}`, refreshToken: `erneuerung-${serial}` };
    access.add(pair.accessToken);
    refresh.add(pair.refreshToken);
    return pair;
  };
  const broadcast = (listId: number, event: string, data: unknown) => {
    for (const [stream, id] of streams) if (id === listId) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  /** Das Konto ist Mitglied der Familie, nicht des Vereins – wie ein Küchenkonto in einer einzigen Gruppe. */
  const allowed = (listId: number) => member && LISTS.some((list) => list.id === listId && list.groupId === 1);

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = (request.url ?? '').replace(/^\/api\/v1/, '').split('?')[0]!;
      const route = `${request.method} ${path.replace(/\d+/g, ':id')}`;
      calls.set(route, (calls.get(route) ?? 0) + 1);
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      let body: Record<string, unknown> = {};
      try {
        if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        return send(400, { error: 'Ungültige Eingabe' });
      }
      const id = Number(/\/(\d+)/.exec(path)?.[1]);

      if (route === 'POST /auth/login') return body['email'] === account.email && body['password'] === account.password ? send(200, { ...tokens(), user: { id: 1, email: account.email } }) : send(401, { error: 'Ungültige Zugangsdaten' });
      if (route === 'POST /auth/refresh') {
        // Wie in Merkio gilt ein Erneuerungstoken nur einmal
        if (typeof body['refreshToken'] !== 'string' || !refresh.delete(body['refreshToken'])) return send(401, { error: 'Refresh-Token ungültig oder abgelaufen' });
        return send(200, { ...tokens(), user: { id: 1, email: account.email } });
      }
      if (!access.has((request.headers.authorization ?? '').replace(/^Bearer /, ''))) return send(401, { error: 'Token ungültig oder abgelaufen' });

      if (route === 'GET /groups') return send(200, { groups: GROUPS.filter((group) => member && group.id === 1) });
      if (route === 'GET /groups/:id/lists') return id === 1 && member ? send(200, { lists: LISTS.filter((list) => list.groupId === id).map(({ groupId: _groupId, ...list }) => list) }) : send(403, { error: 'Keine Berechtigung' });
      if (route === 'GET /lists/:id/items') return allowed(id) ? send(200, { items: items.filter((item) => item.listId === id) }) : send(403, { error: 'Keine Berechtigung oder Liste nicht gefunden' });
      if (route === 'GET /lists/:id/events') {
        if (!allowed(id)) return send(403, { error: 'Keine Berechtigung' });
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        response.write(':ping\n\n');
        streams.set(response, id);
        response.on('close', () => streams.delete(response));
        return;
      }
      if (route === 'POST /lists/:id/items') {
        if (!allowed(id)) return send(403, { error: 'Keine Berechtigung oder Liste nicht gefunden' });
        if (typeof body['name'] !== 'string' || !body['name'].trim()) return send(400, { error: 'Ungültige Eingabe' });
        const item: MerkioItem = { id: nextId++, listId: id, name: body['name'].trim(), category: null, quantity: typeof body['quantity'] === 'string' ? body['quantity'] : null, unit: typeof body['unit'] === 'string' ? body['unit'] : null, checked: 0, checkedAt: null, position: nextId };
        items.push(item);
        broadcast(id, 'item_created', item);
        return send(201, { item });
      }
      if (route === 'PATCH /items/:id') {
        const item = items.find((known) => known.id === id);
        if (!item) return send(404, { error: 'Item nicht gefunden' });
        if (!allowed(item.listId)) return send(403, { error: 'Keine Berechtigung' });
        if (typeof body['checked'] === 'boolean') {
          item.checked = body['checked'] ? 1 : 0;
          item.checkedAt = body['checked'] ? new Date().toISOString() : null;
          if (!body['checked']) item.position = nextId++;
        }
        if ('quantity' in body) item.quantity = typeof body['quantity'] === 'string' ? body['quantity'] : null;
        if ('unit' in body) item.unit = typeof body['unit'] === 'string' ? body['unit'] : null;
        broadcast(item.listId, 'item_updated', item);
        return send(200, { item });
      }
      send(404, { error: 'Nicht gefunden' });
    });
  });
  await new Promise<void>((ready) => server.listen(port, '127.0.0.1', ready));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    account,
    items,
    calls,
    expireAccess: () => access.clear(),
    expireRefresh: () => refresh.clear(),
    setMember: (next) => void (member = next),
    dropStreams: () => {
      for (const stream of streams.keys()) stream.destroy();
    },
    change: (event, item) => {
      const at = items.findIndex((known) => known.id === item.id);
      if (event === 'item_deleted') items.splice(at, at < 0 ? 0 : 1);
      else if (at < 0) items.push(item);
      else items[at] = item;
      broadcast(item.listId, event, event === 'item_deleted' ? { id: item.id } : item);
    },
    close: () =>
      new Promise<void>((done) => {
        for (const stream of streams.keys()) stream.destroy();
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
