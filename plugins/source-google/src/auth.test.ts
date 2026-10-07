import { describe, expect, it } from 'vitest';
import { AccessTokens, authorizationUrl, createVerifier, exchangeCode, LoginRequired, parseClient, READ_SCOPES } from './auth.ts';

const client = { id: 'kennung.apps.googleusercontent.com', secret: 'geheim' };

/** Ein Google, das nur so tut: zeichnet die Anfragen auf und antwortet der Reihe nach. */
function fakeGoogle(...answers: [status: number, body: unknown][]) {
  const requests: Record<string, string>[] = [];
  const fetcher = ((_url: string, init: { body: URLSearchParams }) => {
    requests.push(Object.fromEntries(init.body));
    const [status, body] = answers[Math.min(requests.length, answers.length) - 1]!;
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { fetcher, requests };
}

describe('parseClient', () => {
  it('liest einen Zugang vom Typ Desktop-App', () => {
    expect(parseClient(JSON.stringify({ installed: { client_id: 'a', client_secret: 'b', redirect_uris: ['http://localhost'] } }))).toEqual({ id: 'a', secret: 'b' });
  });

  it('erklärt, was an einer unpassenden Datei falsch ist', () => {
    expect(() => parseClient(JSON.stringify({ web: { client_id: 'a', client_secret: 'b' } }))).toThrow(/Webanwendung.*Desktop-App/);
    expect(() => parseClient('{}')).toThrow(/Desktop-App/);
    expect(() => parseClient('kein json')).toThrow(/kein gültiges JSON/);
  });
});

describe('authorizationUrl', () => {
  it('verlangt eine dauerhafte Anmeldung mit Prüfwert und gibt nur die angefragten Rechte an', () => {
    const { verifier, challenge } = createVerifier();
    const url = new URL(authorizationUrl(client, 'http://127.0.0.1:5123', READ_SCOPES, challenge, 'zustand'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: client.id,
      redirect_uri: 'http://127.0.0.1:5123',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/contacts.readonly',
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'zustand',
    });
    // Das Geheimnis selbst verlässt den Rechner bei der Anmeldung nicht
    expect(url.href).not.toContain(verifier);
    expect(url.href).not.toContain(client.secret);
  });

  it('erzeugt bei jedem Aufruf ein neues Geheimnis', () => {
    expect(createVerifier().verifier).not.toBe(createVerifier().verifier);
  });
});

describe('exchangeCode', () => {
  it('löst den Code ein und liefert die dauerhafte Anmeldung', async () => {
    const google = fakeGoogle([200, { access_token: 'kurz', refresh_token: 'dauerhaft', expires_in: 3599, scope: READ_SCOPES.join(' ') }]);
    const token = await exchangeCode(client, 'code-von-google', 'http://127.0.0.1:5123', 'pruefgeheimnis', google.fetcher);
    expect(token.refreshToken).toBe('dauerhaft');
    expect(token.scopes).toEqual(READ_SCOPES);
    expect(google.requests[0]).toEqual({ grant_type: 'authorization_code', code: 'code-von-google', client_id: client.id, client_secret: client.secret, redirect_uri: 'http://127.0.0.1:5123', code_verifier: 'pruefgeheimnis' });
  });

  it('meldet eine Ablehnung mit der Begründung von Google', async () => {
    const google = fakeGoogle([400, { error: 'invalid_grant', error_description: 'Bad Request' }]);
    await expect(exchangeCode(client, 'x', 'http://127.0.0.1:1', 'y', google.fetcher)).rejects.toThrow(/abgelehnt: Bad Request/);
  });

  it('besteht auf einer dauerhaften Anmeldung', async () => {
    const google = fakeGoogle([200, { access_token: 'kurz', expires_in: 3599 }]);
    await expect(exchangeCode(client, 'x', 'http://127.0.0.1:1', 'y', google.fetcher)).rejects.toThrow(/keine dauerhafte Anmeldung/);
  });
});

describe('AccessTokens', () => {
  it('holt ein Zugriffstoken, behält es bis kurz vor Ablauf und erneuert es dann', async () => {
    let now = 1_000_000;
    const google = fakeGoogle([200, { access_token: 'erstes', expires_in: 3600 }], [200, { access_token: 'zweites', expires_in: 3600 }]);
    const tokens = new AccessTokens(client, 'dauerhaft', google.fetcher, () => now);

    expect(await tokens.get()).toBe('erstes');
    now += 3_500_000;
    expect(await tokens.get()).toBe('erstes');
    expect(google.requests).toHaveLength(1);
    expect(google.requests[0]).toEqual({ grant_type: 'refresh_token', refresh_token: 'dauerhaft', client_id: client.id, client_secret: client.secret });

    now += 50_000;
    expect(await tokens.get()).toBe('zweites');
    expect(google.requests).toHaveLength(2);
  });

  it('teilt eine Erneuerung unter gleichzeitigen Aufrufen', async () => {
    const google = fakeGoogle([200, { access_token: 'eines', expires_in: 3600 }]);
    const tokens = new AccessTokens(client, 'dauerhaft', google.fetcher);
    expect(await Promise.all([tokens.get(), tokens.get(), tokens.get()])).toEqual(['eines', 'eines', 'eines']);
    expect(google.requests).toHaveLength(1);
  });

  it('verlangt eine neue Anmeldung, wenn die alte nicht mehr gilt', async () => {
    const google = fakeGoogle([400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }]);
    await expect(new AccessTokens(client, 'verfallen', google.fetcher).get()).rejects.toBeInstanceOf(LoginRequired);
  });

  it('meldet andere Störungen als solche und versucht es beim nächsten Aufruf erneut', async () => {
    const google = fakeGoogle([500, {}], [200, { access_token: 'doch', expires_in: 3600 }]);
    const tokens = new AccessTokens(client, 'dauerhaft', google.fetcher);
    await expect(tokens.get()).rejects.toThrow(/kein Zugriffstoken heraus: HTTP 500/);
    expect(await tokens.get()).toBe('doch');
  });
});
