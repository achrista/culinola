# Installation counter (Cloudflare Worker)

Receives the daily anonymous ping that Culinola sends (see [handbook](../../docs/handbook.md#anonymous-usage-ping)) and counts installations. It runs as a Cloudflare Worker with a D1 database, both within Cloudflare's free tier.

It stores one row per installation: the random installation id, first and last day seen, number of pings, version, operating system, processor architecture, whether it runs in Docker and whether it still runs on demo values. It does not store IP addresses, and request logging is switched off in `wrangler.toml`. Installations that have not reported for a year are deleted daily.

It is not part of Culinola itself and only needed by whoever runs `ping.culinola.org`.

## Setting it up

Requirements: a Cloudflare account, with `culinola.org` as a zone in it, and Node.js.

```bash
cd extras/telemetry-worker
npx wrangler login
npx wrangler d1 create culinola-ping
```

Enter the printed `database_id` in `wrangler.toml`, then:

```bash
npx wrangler d1 execute culinola-ping --remote --file schema.sql
npx wrangler secret put STATS_TOKEN
npx wrangler deploy
```

`STATS_TOKEN` is a long random string of your choice; it protects the statistics.

If `culinola.org` is not managed by Cloudflare, remove the `routes` line: the worker is then reachable at `https://culinola-ping.<account>.workers.dev`, and `TELEMETRY_URL` in `packages/core/src/telemetry.ts` has to point there.

## Reading the figures

```bash
curl -H "Authorization: Bearer <STATS_TOKEN>" https://ping.culinola.org/v1/stats
```

`active.month` is the number of installations that reported in the last 30 days; `configured30d` leaves out those still running on demo values. A single installation counts once, however often it restarts.
