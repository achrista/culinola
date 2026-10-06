import { describe, expect, it } from 'vitest';
import { type AccessToken, authorize, bearerToken, requiredRole } from './access.ts';

const tokens: AccessToken[] = [
  { name: 'kueche', role: 'control', token: 'kuechen-geheimnis' },
  { name: 'anzeige-flur', role: 'read', token: 'flur-geheimnis' },
];

describe('authorize', () => {
  it('lässt ohne eingerichtete Tokens alles zu', () => {
    expect(authorize([], undefined, 'control')).toEqual({ ok: true, name: 'offen' });
  });

  it('verlangt ein Token, sobald welche eingerichtet sind', () => {
    expect(authorize(tokens, undefined, 'read')).toMatchObject({ ok: false, status: 401 });
  });

  it('weist unbekannte Tokens ab', () => {
    expect(authorize(tokens, 'falsch', 'read')).toMatchObject({ ok: false, status: 401 });
    expect(authorize(tokens, 'kuechen-geheimnis ', 'read')).toMatchObject({ ok: false, status: 401 });
  });

  it('lässt ein Bedien-Token lesen und bedienen', () => {
    expect(authorize(tokens, 'kuechen-geheimnis', 'read')).toEqual({ ok: true, name: 'kueche' });
    expect(authorize(tokens, 'kuechen-geheimnis', 'control')).toEqual({ ok: true, name: 'kueche' });
  });

  it('lässt ein Lese-Token nicht bedienen', () => {
    expect(authorize(tokens, 'flur-geheimnis', 'read')).toEqual({ ok: true, name: 'anzeige-flur' });
    expect(authorize(tokens, 'flur-geheimnis', 'control')).toMatchObject({ ok: false, status: 403 });
  });

  it('verlangt für das Einrichten die höchste Stufe', () => {
    expect(authorize(tokens, 'kuechen-geheimnis', 'admin')).toMatchObject({ ok: false, status: 403 });
  });
});

describe('requiredRole', () => {
  it('unterscheidet Lesen und Auslösen', () => {
    expect(requiredRole('GET')).toBe('read');
    expect(requiredRole('POST')).toBe('control');
    expect(requiredRole('PUT')).toBe('control');
  });
});

describe('bearerToken', () => {
  it('liest das Token aus der Kopfzeile', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('bearer  abc123 ')).toBe('abc123');
  });

  it('liefert nichts bei fehlender oder fremder Kopfzeile', () => {
    expect(bearerToken(undefined)).toBeUndefined();
    expect(bearerToken('Basic abc')).toBeUndefined();
  });
});
