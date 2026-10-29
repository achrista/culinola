// Receives the daily anonymous ping of Culinola installations and counts them.
// Stores only what the ping contains – never the IP address or any other request data.
//
//   POST /v1/ping   { id, version, os, arch, docker, demo }   → 204
//   GET  /v1/stats  Authorization: Bearer <STATS_TOKEN>       → counts as JSON

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHORT = /^[\w.+-]{1,32}$/;
const DAY = 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/v1/ping' && request.method === 'POST') return ping(request, env);
    if (pathname === '/v1/stats' && request.method === 'GET') return stats(request, env);
    return new Response('Not found', { status: 404 });
  },

  // Daily: forget installations that have not reported for a year
  async scheduled(event, env) {
    await env.DB.prepare('DELETE FROM installs WHERE last_seen < ?1').bind(new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10)).run();
  },
};

async function ping(request, env) {
  const body = await request.text();
  if (body.length > 1024) return new Response('Too large', { status: 413 });
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const { id, version, os, arch, docker, demo } = data ?? {};
  if (!UUID.test(id) || ![version, os, arch].every((value) => SHORT.test(value)) || typeof docker !== 'boolean' || typeof demo !== 'boolean') {
    return new Response('Bad ping', { status: 400 });
  }
  // Only the day – the exact time is not needed
  const now = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO installs (id, first_seen, last_seen, pings, version, os, arch, docker, demo)
     VALUES (?1, ?2, ?2, 1, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (id) DO UPDATE SET last_seen = ?2, pings = pings + 1, version = ?3, os = ?4, arch = ?5, docker = ?6, demo = ?7`,
  )
    .bind(id, now, version, os, arch, docker ? 1 : 0, demo ? 1 : 0)
    .run();
  return new Response(null, { status: 204 });
}

async function stats(request, env) {
  if (!env.STATS_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.STATS_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const since = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const count = async (where = '1', ...args) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM installs WHERE ${where}`).bind(...args).first()).n;
  // Breakdowns over installations active in the last 30 days that run with their own configuration
  const active = `last_seen >= ?1 AND demo = 0`;
  const breakdown = async (column) =>
    Object.fromEntries((await env.DB.prepare(`SELECT ${column} AS k, COUNT(*) AS n FROM installs WHERE ${active} GROUP BY ${column} ORDER BY n DESC`).bind(since(30)).all()).results.map((row) => [row.k, row.n]));
  const result = {
    total: await count(),
    active: { day: await count('last_seen >= ?1', since(1)), week: await count('last_seen >= ?1', since(7)), month: await count('last_seen >= ?1', since(30)) },
    configured30d: await count(active, since(30)),
    demo30d: await count('last_seen >= ?1 AND demo = 1', since(30)),
    newLast30d: await count('first_seen >= ?1', since(30)),
    byVersion: await breakdown('version'),
    byOs: await breakdown('os'),
    byArch: await breakdown('arch'),
    byDocker: await breakdown('docker'),
  };
  return Response.json(result);
}
