import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Role } from './access.ts';
import { TooManyAttempts } from './auth.ts';

/** Die Anfrage gibt es nicht (mehr): abgelaufen, abgelehnt oder schon abgeholt. */
export class UnknownPairing extends Error {}

/** So lange wartet eine Anfrage auf ihre Bestätigung, und so lange liegt ein bestätigter Zugang zum Abholen bereit. */
const WAIT_MS = 10 * 60_000;
/** So viele Anfragen dürfen zugleich offen sein – insgesamt und von einem Gerät. */
const MAX_PENDING = 20;
const MAX_PER_ADDRESS = 3;
const MAX_LABEL_CHARS = 80;

interface Request {
  id: string;
  /** Sechs Ziffern, die das Gerät zeigt und die beim Bestätigen verglichen werden. */
  code: string;
  /** Nur das anfragende Gerät kennt dieses Geheimnis – nur ihm wird der Zugang ausgehändigt. */
  secret: string;
  label: string;
  address: string;
  since: number;
  expires: number;
  granted?: { name: string; role: Role; token: string };
  rejected?: boolean;
}

export type PairingState = { state: 'waiting'; code: string; expires: string } | { state: 'approved'; name: string; role: Role; token: string } | { state: 'rejected' } | { state: 'expired' };

/**
 * Geräte koppeln: Eine Anzeige ohne Zugang bittet um einen und zeigt dazu einen kurzen Code. Wer einrichten
 * darf, sieht die Anfrage in den Einstellungen, vergleicht den Code mit dem auf dem Gerät und vergibt Namen und
 * Stufe. Das Token wandert danach von selbst auf das Gerät – niemand muss es abtippen oder in eine Adresse setzen.
 *
 * Anfragen leben nur im Arbeitsspeicher und verfallen nach einigen Minuten.
 */
export class Pairing {
  private readonly requests = new Map<string, Request>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Eine Anzeige bittet um Zugang. `label` beschreibt sie (Browser, Layout), `address` ist ihre Netzadresse. */
  request(label: unknown, address: string): { id: string; code: string; secret: string; expires: string } {
    this.sweep();
    const waiting = [...this.requests.values()].filter((entry) => !entry.granted);
    // Wer neu lädt, fragt neu an – die älteste Anfrage desselben Geräts macht dann Platz
    const own = waiting.filter((entry) => entry.address === address);
    if (own.length >= MAX_PER_ADDRESS) this.requests.delete(own[0]!.id);
    else if (waiting.length >= MAX_PENDING) throw new TooManyAttempts(60);

    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while ([...this.requests.values()].some((entry) => entry.code === code));
    const entry: Request = {
      id: randomBytes(9).toString('base64url'),
      code,
      secret: randomBytes(24).toString('base64url'),
      label: (typeof label === 'string' ? label : '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_CHARS),
      address,
      since: this.now(),
      expires: this.now() + WAIT_MS,
    };
    this.requests.set(entry.id, entry);
    return { id: entry.id, code, secret: entry.secret, expires: new Date(entry.expires).toISOString() };
  }

  /** Das Gerät fragt nach, was aus seiner Anfrage wurde. Einen vergebenen Zugang bekommt es genau einmal. */
  poll(id: string, secret: unknown): PairingState {
    this.sweep();
    const entry = this.requests.get(id);
    if (!entry || typeof secret !== 'string' || !same(entry.secret, secret)) return { state: 'expired' };
    if (entry.rejected) {
      this.requests.delete(id);
      return { state: 'rejected' };
    }
    if (entry.granted) {
      this.requests.delete(id);
      return { state: 'approved', ...entry.granted };
    }
    return { state: 'waiting', code: entry.code, expires: new Date(entry.expires).toISOString() };
  }

  /** Die offenen Anfragen für die Einstellungsseite – ohne die Geheimnisse der Geräte. */
  list(): { id: string; code: string; label: string; address: string; since: string }[] {
    this.sweep();
    return [...this.requests.values()]
      .filter((entry) => !entry.granted && !entry.rejected)
      .sort((a, b) => a.since - b.since)
      .map(({ id, code, label, address, since }) => ({ id, code, label, address, since: new Date(since).toISOString() }));
  }

  /** Ob die Anfrage noch auf ihre Bestätigung wartet. */
  waiting(id: string): boolean {
    this.sweep();
    const entry = this.requests.get(id);
    return !!entry && !entry.granted && !entry.rejected;
  }

  /** Hinterlegt den Zugang, den das Gerät bei seiner nächsten Nachfrage abholt. */
  approve(id: string, granted: { name: string; role: Role; token: string }): void {
    if (!this.waiting(id)) throw new UnknownPairing('Diese Anfrage gibt es nicht mehr – sie ist abgelaufen oder schon beantwortet.');
    const entry = this.requests.get(id)!;
    entry.granted = { ...granted };
    entry.expires = this.now() + WAIT_MS;
  }

  reject(id: string): void {
    if (!this.waiting(id)) throw new UnknownPairing('Diese Anfrage gibt es nicht mehr – sie ist abgelaufen oder schon beantwortet.');
    const entry = this.requests.get(id)!;
    entry.rejected = true;
    entry.expires = this.now() + 60_000;
  }

  private sweep(): void {
    for (const [id, entry] of this.requests) if (entry.expires <= this.now()) this.requests.delete(id);
  }
}

function same(expected: string, presented: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(expected), digest(presented));
}
