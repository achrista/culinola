import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Merkio nimmt die Anmeldung nicht an – daran ändert ein weiterer Versuch nichts. */
export class LoginFailed extends Error {}

/** Merkio hat geantwortet, aber mit einem Fehler. */
export class MerkioError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ClientOptions {
  /** Adresse der Merkio-API ohne `/api/v1`. */
  url: string;
  email: string;
  password: string;
  /** Hier merkt sich der Zugang sein Erneuerungstoken, damit ein Neustart keine neue Anmeldung braucht. */
  tokenFile: string;
  signal?: AbortSignal;
}

const TIMEOUT_MS = 15_000;

/**
 * Zugang zur Merkio-API. Merkio gibt ein kurzlebiges Zugangstoken und ein Erneuerungstoken
 * aus, das bei jeder Erneuerung wechselt; ist auch das abgelaufen, meldet sich der Zugang
 * mit Konto und Kennwort neu an.
 */
export class MerkioClient {
  private readonly options: ClientOptions;
  private access: string | undefined;
  private refresh: string | undefined;
  private renewing: Promise<void> | undefined;

  constructor(options: ClientOptions) {
    this.options = { ...options, url: options.url.replace(/\/+$/, '') };
    try {
      const saved = JSON.parse(readFileSync(options.tokenFile, 'utf8')) as { email?: unknown; refreshToken?: unknown };
      // Ein Token eines anderen Kontos gilt nicht mehr, wenn das Konto gewechselt wurde
      if (saved.email === options.email && typeof saved.refreshToken === 'string') this.refresh = saved.refreshToken;
    } catch {
      // Beim ersten Start gibt es noch kein gespeichertes Token.
    }
  }

  private signal(): AbortSignal {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    return this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.options.url}/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: this.signal() });
  }

  private adopt(tokens: { accessToken?: unknown; refreshToken?: unknown }) {
    if (typeof tokens.accessToken !== 'string' || typeof tokens.refreshToken !== 'string') throw new MerkioError(502, 'Merkio hat bei der Anmeldung kein Token geliefert.');
    this.access = tokens.accessToken;
    this.refresh = tokens.refreshToken;
    try {
      mkdirSync(dirname(this.options.tokenFile), { recursive: true });
      writeFileSync(this.options.tokenFile, JSON.stringify({ email: this.options.email, refreshToken: this.refresh }), { mode: 0o600 });
    } catch {
      // Ohne gespeichertes Token meldet sich der Zugang nach einem Neustart eben neu an.
    }
  }

  private async login(): Promise<void> {
    const response = await this.post('/auth/login', { email: this.options.email, password: this.options.password });
    if (response.status === 401) throw new LoginFailed('Merkio lehnt Konto oder Kennwort ab.');
    if (response.status === 403) throw new LoginFailed('Die E-Mail-Adresse des Merkio-Kontos ist noch nicht bestätigt.');
    if (!response.ok) throw new MerkioError(response.status, `Merkio antwortet auf die Anmeldung mit Fehler ${response.status}.`);
    this.adopt((await response.json()) as { accessToken?: unknown; refreshToken?: unknown });
  }

  /** Holt ein frisches Zugangstoken; gleichzeitige Aufrufe teilen sich einen Versuch. */
  private renew(): Promise<void> {
    this.renewing ??= (async () => {
      if (this.refresh) {
        const response = await this.post('/auth/refresh', { refreshToken: this.refresh });
        if (response.ok) return this.adopt((await response.json()) as { accessToken?: unknown; refreshToken?: unknown });
        if (response.status !== 401) throw new MerkioError(response.status, `Merkio antwortet auf die Erneuerung mit Fehler ${response.status}.`);
        this.refresh = undefined;
      }
      await this.login();
    })().finally(() => (this.renewing = undefined));
    return this.renewing;
  }

  private async send(method: string, path: string, body: unknown, signal: AbortSignal, accept: string): Promise<Response> {
    if (!this.access) await this.renew();
    const call = () =>
      fetch(`${this.options.url}/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.access}`, Accept: accept, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal,
      });
    let response = await call();
    if (response.status === 401) {
      // Das Zugangstoken gilt nur Minuten; einmal erneuern und denselben Aufruf wiederholen
      await response.body?.cancel();
      await this.renew();
      response = await call();
    }
    if (!response.ok) {
      const detail = ((await response.json().catch(() => ({}))) as { error?: unknown }).error;
      throw new MerkioError(response.status, `Merkio: ${typeof detail === 'string' ? detail : `Fehler ${response.status}`} (${method} ${path})`);
    }
    return response;
  }

  async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    return (await (await this.send(method, path, body, this.signal(), 'application/json')).json()) as T;
  }

  /** Holt eine Datei, etwa ein Rezept als Markdown oder sein Foto, samt ihrer Art. */
  async file(path: string): Promise<{ data: Uint8Array; type: string }> {
    const response = await this.send('GET', path, undefined, this.signal(), '*/*');
    return { data: new Uint8Array(await response.arrayBuffer()), type: (response.headers.get('content-type') ?? '').split(';')[0]!.trim() };
  }

  /** Öffnet einen fortlaufenden Datenstrom, etwa den Echtzeitkanal einer Liste. */
  async stream(path: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const response = await this.send('GET', path, undefined, signal, 'text/event-stream');
    if (!response.body) throw new MerkioError(502, 'Merkio hat keinen Datenstrom geöffnet.');
    return response.body;
  }
}
