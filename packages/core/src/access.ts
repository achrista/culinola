import { createHash, timingSafeEqual } from 'node:crypto';

/** read = lesen, control = zusätzlich schalten und Aktionen auslösen, admin = zusätzlich einrichten. */
export type Role = 'read' | 'control' | 'admin';

export interface AccessToken {
  name: string;
  role: Role;
  token: string;
}

const RANK: Record<Role, number> = { read: 1, control: 2, admin: 3 };
const ROLES = Object.keys(RANK) as Role[];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role);
}

/** Welche Stufe ein Aufruf braucht: Lesen für GET, Bedienen für alles, was etwas auslöst. */
export function requiredRole(method: string): Role {
  return method === 'GET' || method === 'HEAD' ? 'read' : 'control';
}

/** Liest das Token aus der Kopfzeile "Authorization: Bearer …". */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  return match?.[1]?.trim();
}

export type AccessResult = { ok: true; name: string } | { ok: false; status: 401 | 403; error: string };

/**
 * Prüft ein vorgelegtes Token. Ohne eingerichtete Tokens ist die API offen –
 * gedacht für den ersten Start, nicht für den Dauerbetrieb.
 */
export function authorize(tokens: readonly AccessToken[], presented: string | undefined, needed: Role): AccessResult {
  if (tokens.length === 0) return { ok: true, name: 'offen' };
  if (!presented) return { ok: false, status: 401, error: 'Zugangstoken fehlt.' };

  const match = tokens.find((entry) => sameSecret(entry.token, presented));
  if (!match) return { ok: false, status: 401, error: 'Zugangstoken ist ungültig.' };
  if (RANK[match.role] < RANK[needed]) {
    return { ok: false, status: 403, error: `Das Token "${match.name}" darf nur ${match.role === 'read' ? 'lesen' : 'bedienen'}.` };
  }
  return { ok: true, name: match.name };
}

/** Vergleich in gleichbleibender Zeit, damit die Antwortdauer nichts über das Token verrät. */
function sameSecret(expected: string, presented: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(expected), digest(presented));
}
