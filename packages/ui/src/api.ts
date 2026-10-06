const BASE = '/api/v1';

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return read<T>(await fetch(BASE + path));
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return read<T>(await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

export interface Series {
  id: string;
  unit?: string;
  points: [time: number, value: number][];
}

export async function getSeries(ids: string[], from: string, step: string): Promise<Series[]> {
  const query = new URLSearchParams({ ids: ids.join(','), from, step });
  return (await getJson<{ series: Series[] }>(`/series?${query}`)).series;
}
