// Fetches the repository traffic from the GitHub API and merges it into CSV files in the given
// folder. GitHub keeps traffic for 14 days only, so this runs daily and keeps the history.
//
//   node traffic-stats.mjs <folder>
//
// Needs TRAFFIC_TOKEN (a token with read access to the repository's administration) and
// GITHUB_REPOSITORY (owner/name).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
const token = process.env.TRAFFIC_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!folder || !token || !repo) {
  console.error('Usage: TRAFFIC_TOKEN=… GITHUB_REPOSITORY=owner/name node traffic-stats.mjs <folder>');
  process.exit(1);
}

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/traffic/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`traffic/${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

function readCsv(file) {
  if (!existsSync(file)) return [];
  const [, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
  return lines.filter(Boolean).map((line) => line.split(','));
}

function writeCsv(file, header, rows) {
  writeFileSync(file, [header, ...rows.map((row) => row.join(','))].join('\n') + '\n');
}

// Daily counts: the newest fetch wins for a day, since the current day is still incomplete.
function mergeDaily(file, days) {
  const byDate = new Map(readCsv(file).map(([date, count, uniques]) => [date, [date, count, uniques]]));
  for (const day of days) {
    const date = day.timestamp.slice(0, 10);
    byDate.set(date, [date, String(day.count), String(day.uniques)]);
  }
  const rows = [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
  writeCsv(file, 'date,count,uniques', rows);
}

// Referrers and paths only exist as a total over the last 14 days: one snapshot per day.
function appendSnapshot(file, header, date, rows) {
  const kept = readCsv(file).filter(([rowDate]) => rowDate !== date);
  writeCsv(file, header, [...kept, ...rows.map((row) => [date, ...row])]);
}

const csvField = (text) => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

mkdirSync(folder, { recursive: true });
const today = new Date().toISOString().slice(0, 10);

const clones = await api('clones?per=day');
mergeDaily(join(folder, 'clones.csv'), clones.clones);

const views = await api('views?per=day');
mergeDaily(join(folder, 'views.csv'), views.views);

const referrers = await api('popular/referrers');
appendSnapshot(join(folder, 'referrers-14d.csv'), 'date,referrer,count,uniques', today,
  referrers.map((r) => [csvField(r.referrer), r.count, r.uniques]));

const paths = await api('popular/paths');
appendSnapshot(join(folder, 'paths-14d.csv'), 'date,path,count,uniques', today,
  paths.map((p) => [csvField(p.path), p.count, p.uniques]));

console.log(`Last 14 days: ${clones.count} clones (${clones.uniques} unique), ${views.count} views (${views.uniques} unique)`);
