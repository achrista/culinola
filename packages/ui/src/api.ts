const BASE = '/api/v1';
const TOKEN_KEY = 'culinola.token';

/** Der Kern verlangt ein Zugangstoken, und diese Anzeige hat keines oder ein ungültiges. */
export class AccessDenied extends Error {}

/**
 * Übernimmt ein Token, das einmalig an die Adresse gehängt wurde (`…/#token=…`),
 * merkt es sich für diese Anzeige und entfernt es wieder aus der Adresszeile.
 */
export function adoptTokenFromAddress(): boolean {
  const match = /(?:^#|&)token=([^&]+)/.exec(location.hash);
  if (!match) return false;
  try {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]!));
  } catch {
    // Ohne Speicher lässt sich das Token nicht merken.
    return false;
  }
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

export function accessToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const token = accessToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** Der Kern hat den Aufruf abgelehnt; `status` und der Rumpf seiner Antwort sagen, warum. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? `${response.status} ${response.statusText}`;
    throw response.status === 401 ? new AccessDenied(message) : new ApiError(message, response.status, body);
  }
  return (await response.json()) as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return read<T>(await fetch(BASE + path, { headers: headers() }));
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return read<T>(await fetch(BASE + path, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }));
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  return read<T>(await fetch(BASE + path, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) }));
}

export async function deleteJson<T>(path: string): Promise<T> {
  return read<T>(await fetch(BASE + path, { method: 'DELETE', headers: headers() }));
}

/** Schickt eine Datei als rohe Bytes – so nimmt sie der Kern für ein Plugin entgegen. */
export async function postFile<T>(path: string, file: Blob): Promise<T> {
  return read<T>(await fetch(BASE + path, { method: 'POST', headers: headers({ 'Content-Type': 'application/octet-stream' }), body: file }));
}

export interface Series {
  id: string;
  unit?: string;
  points: [time: number, value: number][];
}

/** `from` und `to` als ISO-Zeitpunkt oder relativ zu jetzt ("-1h"); ohne `to` endet die Reihe jetzt. */
export async function getSeries(ids: string[], from: string, to: string | undefined, step: string): Promise<Series[]> {
  const query = new URLSearchParams({ ids: ids.join(','), from, step });
  if (to) query.set('to', to);
  return (await getJson<{ series: Series[] }>(`/series?${query}`)).series;
}
