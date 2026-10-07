import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Wofür Culinola im Betrieb Zugriff braucht: Kalender und Kontakte lesen, mehr nicht. */
export const READ_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/contacts.readonly'];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Ein Zugriffstoken wird etwas vor seinem Ablauf erneuert, damit kein Aufruf mit einem gerade verfallenen losgeht. */
const EARLY_MS = 60_000;

export interface Client {
  id: string;
  secret: string;
}

export interface StoredToken {
  refreshToken: string;
  scopes: string[];
  /** Zeitpunkt der Anmeldung, ISO 8601. */
  obtained: string;
}

type Fetch = typeof fetch;

/** Die Anmeldung fehlt oder gilt nicht mehr; behoben wird das mit `npm run google:login`. */
export class LoginRequired extends Error {}

export const clientFile = (storageDir: string) => join(storageDir, 'client.json');
export const tokenFile = (storageDir: string) => join(storageDir, 'token.json');

/** Liest die Datei, die Google beim Anlegen des Zugangs zum Herunterladen anbietet. */
export function parseClient(json: string): Client {
  let data: { installed?: { client_id?: string; client_secret?: string }; web?: unknown };
  try {
    data = JSON.parse(json) as typeof data;
  } catch {
    throw new Error('client.json ist kein gültiges JSON. Bitte die Datei unverändert so ablegen, wie Google sie liefert.');
  }
  if (data.web) throw new Error('client.json gehört zu einem Zugang vom Typ „Webanwendung“. Culinola braucht den Typ „Desktop-App“.');
  const id = data.installed?.client_id;
  const secret = data.installed?.client_secret;
  if (!id || !secret) throw new Error('client.json enthält keinen Zugang vom Typ „Desktop-App“ (erwartet wird der Abschnitt "installed").');
  return { id, secret };
}

export function readClient(storageDir: string): Client {
  const file = clientFile(storageDir);
  if (!existsSync(file)) throw new LoginRequired(`Der Google-Zugang fehlt: ${file} gibt es nicht. Wie er angelegt wird, steht in docs/google-einrichten.md.`);
  return parseClient(readFileSync(file, 'utf8'));
}

export function readToken(storageDir: string): StoredToken {
  const file = tokenFile(storageDir);
  if (!existsSync(file)) throw new LoginRequired('Bei Google ist noch niemand angemeldet. Die Anmeldung startet mit: npm run google:login');
  try {
    const token = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredToken>;
    if (typeof token.refreshToken === 'string' && token.refreshToken) return { refreshToken: token.refreshToken, scopes: token.scopes ?? [], obtained: token.obtained ?? '' };
  } catch {
    // Wie eine fehlende Anmeldung behandeln
  }
  throw new LoginRequired('Die gespeicherte Google-Anmeldung ist unlesbar. Neu anmelden mit: npm run google:login');
}

export function writeToken(storageDir: string, token: StoredToken): void {
  const file = tokenFile(storageDir);
  mkdirSync(dirname(file), { recursive: true });
  // Nur der eigene Benutzer darf die Datei lesen – sie gibt Zugriff auf Kalender und Kontakte
  writeFileSync(file, JSON.stringify(token, null, 2) + '\n', { mode: 0o600 });
}

/** Geheimnis und Prüfwert für die Anmeldung (PKCE): Nur wer das Geheimnis kennt, kann den Code einlösen. */
export function createVerifier(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Adresse der Anmeldeseite von Google. */
export function authorizationUrl(client: Client, redirectUri: string, scopes: readonly string[], challenge: string, state: string): string {
  const query = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    // Ohne "offline" und "consent" gäbe Google keine dauerhafte Anmeldung heraus
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${AUTH_URL}?${query}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(form: Record<string, string>, fetcher: Fetch): Promise<TokenResponse> {
  const response = await fetcher(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok && !body.error) body.error = `HTTP ${response.status}`;
  return body;
}

/** Löst den Code ein, den Google nach der Anmeldung zurückgibt, und liefert die dauerhafte Anmeldung. */
export async function exchangeCode(client: Client, code: string, redirectUri: string, verifier: string, fetcher: Fetch = fetch): Promise<StoredToken> {
  const body = await tokenRequest({ grant_type: 'authorization_code', code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri, code_verifier: verifier }, fetcher);
  if (body.error) throw new Error(`Google hat die Anmeldung abgelehnt: ${body.error_description ?? body.error}`);
  if (!body.refresh_token) throw new Error('Google hat keine dauerhafte Anmeldung geliefert. Bitte die Anmeldung wiederholen.');
  return { refreshToken: body.refresh_token, scopes: (body.scope ?? '').split(' ').filter(Boolean), obtained: new Date().toISOString() };
}

/**
 * Hält ein gültiges Zugriffstoken bereit und erneuert es bei Bedarf. Gleichzeitige
 * Aufrufe teilen sich eine Erneuerung.
 */
export class AccessTokens {
  private current: { value: string; expires: number } | undefined;
  private pending: Promise<string> | undefined;

  private readonly client: Client;
  private readonly refreshToken: string;
  private readonly fetcher: Fetch;
  private readonly now: () => number;

  constructor(client: Client, refreshToken: string, fetcher: Fetch = fetch, now: () => number = Date.now) {
    this.client = client;
    this.refreshToken = refreshToken;
    this.fetcher = fetcher;
    this.now = now;
  }

  get(): Promise<string> {
    if (this.current && this.current.expires - EARLY_MS > this.now()) return Promise.resolve(this.current.value);
    this.pending ??= this.refresh().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async refresh(): Promise<string> {
    const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.client.id, client_secret: this.client.secret }, this.fetcher);
    // "invalid_grant": Die Anmeldung wurde widerrufen oder ist verfallen – etwa nach sieben Tagen, solange die App bei Google auf „Testing“ steht
    if (body.error === 'invalid_grant') throw new LoginRequired('Die Google-Anmeldung gilt nicht mehr. Neu anmelden mit: npm run google:login');
    if (body.error || !body.access_token) throw new Error(`Google gibt kein Zugriffstoken heraus: ${body.error_description ?? body.error ?? 'Antwort ohne Token'}`);
    this.current = { value: body.access_token, expires: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
