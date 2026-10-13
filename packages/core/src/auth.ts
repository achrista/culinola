import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@culinola/sdk';
import type { AccessToken } from './access.ts';
import type { JsonFile } from './jsonfile.ts';

/** Das Kennwort taugt nicht – zu kurz, zu lang oder gar keines. */
export class InvalidPassword extends Error {}
/** Kennwort oder Einrichtungscode stimmen nicht. */
export class LoginRefused extends Error {}
/** Es geht so nicht: Danach könnte niemand mehr einrichten. */
export class AuthConflict extends Error {}
/** Zu viele Fehlversuche; `retryAfter` nennt die Wartezeit in Sekunden. */
export class TooManyAttempts extends Error {
  readonly retryAfter: number;
  constructor(seconds: number) {
    super(`Zu viele Fehlversuche. Bitte ${seconds < 90 ? `${seconds} Sekunden` : `${Math.ceil(seconds / 60)} Minuten`} warten.`);
    this.retryAfter = seconds;
  }
}

type Secrets = Record<string, Record<string, string>>;

/** Der Abschnitt in `secrets.json`, in dem Prüfwert und Schlüssel des Einrichtungskennworts stehen – wie "api" kein Name für eine Quelle. */
export const SETUP_SECTION = 'setup';
/** Die Datei im Datenordner, in der ein angeforderter Einrichtungscode steht. */
export const RESET_FILE = 'einrichtungscode.txt';

const MIN_PASSWORD_CHARS = 8;
const MAX_PASSWORD_CHARS = 200;
const PASSWORD_RULE = `Das Kennwort braucht mindestens ${MIN_PASSWORD_CHARS} Zeichen.`;
const SESSION_MS = 30 * 24 * 3_600_000;
const RESET_MS = 15 * 60_000;
/** Ein neuer Code ersetzt den alten frühestens nach dieser Zeit – wer die Taste mehrmals drückt, soll nicht jedes Mal neu nachsehen müssen. */
const RESET_KEEP_MS = 60_000;
const RESET_TRIES = 10;
const SCRYPT = { N: 16_384, r: 8, p: 1 };

/**
 * Bremst das Raten: Nach einigen freien Fehlversuchen wächst die Wartezeit mit jedem weiteren – je Herkunft,
 * damit ein Gerät im Netz nicht alle anderen aussperrt.
 */
export class Attempts {
  private readonly failed = new Map<string, { count: number; until: number }>();
  private readonly free: number;
  private readonly now: () => number;

  constructor(free = 5, now: () => number = Date.now) {
    this.free = free;
    this.now = now;
  }

  /** Wirft, solange für diese Herkunft eine Wartezeit läuft. */
  check(key: string): void {
    const entry = this.failed.get(key);
    if (entry && entry.until > this.now()) throw new TooManyAttempts(Math.ceil((entry.until - this.now()) / 1000));
  }

  fail(key: string): void {
    // Wer es vor einer Stunde zuletzt versucht hat, beginnt von vorn
    for (const [other, entry] of this.failed) if (entry.until + 3_600_000 < this.now()) this.failed.delete(other);
    const count = (this.failed.get(key)?.count ?? 0) + 1;
    const wait = count < this.free ? 0 : Math.min(15 * 60_000, 30_000 * 2 ** (count - this.free));
    this.failed.set(key, { count, until: this.now() + wait });
  }

  pass(key: string): void {
    this.failed.delete(key);
  }
}

function derive(password: string, salt: Buffer, cost: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize('NFKC'), salt, 32, cost, (error, key) => (error ? reject(error) : resolve(key))));
}

/** Der Prüfwert eines Kennworts: Verfahren, Aufwand, Salz und Ergebnis – das Kennwort selbst wird nirgends gespeichert. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${(await derive(password, salt, SCRYPT)).toString('base64url')}`;
}

export async function verifyPassword(password: string, record: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = record.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  // Unsinnige Angaben in einer von Hand geänderten Datei sollen den Kern nicht lahmlegen
  if (!(cost.N >= 1024 && cost.N <= 1_048_576 && cost.r >= 1 && cost.r <= 32 && cost.p >= 1 && cost.p <= 16)) return false;
  const expected = Buffer.from(hash, 'base64url');
  try {
    const actual = await derive(password, Buffer.from(salt, 'base64url'), cost);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export interface AuthDeps {
  /** Die Zugangsdaten des laufenden Kerns; der Abschnitt "setup" wird darin gepflegt. */
  secrets: Secrets;
  secretsFile: JsonFile;
  /** Dieselbe Liste, an der die Server jeden Aufruf prüfen. */
  access: readonly AccessToken[];
  dataDir: string;
  log: Logger;
  now?: () => number;
}

export interface Session {
  token: string;
  /** Zeitpunkt, an dem die Anmeldung endet (ISO 8601). */
  expires: string;
}

/**
 * Das Einrichtungskennwort. Menschen weisen sich damit aus, wenn sie einrichten wollen – Geräte und Programme
 * benutzen weiter ihre Tokens. Wer sich anmeldet, bekommt eine Anmeldung auf Zeit, die der Browser bei jedem
 * Aufruf vorlegt. Gespeichert wird nur ein Prüfwert des Kennworts, in `secrets.json`.
 *
 * Wer das Kennwort vergessen hat, fordert einen Einrichtungscode an: Der Kern legt ihn in den Datenordner.
 * Lesen kann ihn dort nur, wer ohnehin an die Dateien der Installation kommt – das ist der Beweis, den ein
 * Browser allein nicht führen kann.
 */
export class Auth {
  private readonly deps: AuthDeps;
  private readonly now: () => number;
  private readonly logins: Attempts;
  private readonly resets: Attempts;
  private reset: { code: string; created: number; expires: number; tries: number } | undefined;

  constructor(deps: AuthDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.logins = new Attempts(5, this.now);
    this.resets = new Attempts(5, this.now);
  }

  hasPassword(): boolean {
    const setup = this.deps.secrets[SETUP_SECTION];
    return typeof setup?.['password'] === 'string' && setup['password'].startsWith('scrypt$') && typeof setup['key'] === 'string';
  }

  /** Ob die API geschützt ist: sobald es ein Kennwort oder einen Zugang gibt. */
  protected(): boolean {
    return this.deps.access.length > 0 || this.hasPassword();
  }

  /** Legt das Kennwort fest oder ändert es. Alle bisherigen Anmeldungen enden; der Aufrufer bekommt eine neue. */
  async setPassword(password: unknown): Promise<Session> {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_CHARS) throw new InvalidPassword(PASSWORD_RULE);
    if (password.length > MAX_PASSWORD_CHARS) throw new InvalidPassword(`Das Kennwort darf höchstens ${MAX_PASSWORD_CHARS} Zeichen haben.`);
    const changed = this.hasPassword();
    const setup = { password: await hashPassword(password), key: randomBytes(32).toString('base64url') };
    this.save((secrets) => void (secrets[SETUP_SECTION] = setup));
    this.deps.secrets[SETUP_SECTION] = setup;
    this.deps.log.info(changed ? 'Einrichtungskennwort geändert.' : 'Einrichtungskennwort festgelegt – die API ist geschützt.');
    return this.issue();
  }

  /** Entfernt das Kennwort. Gibt es Zugänge, muss einer davon einrichten dürfen – sonst käme niemand mehr hinein. */
  removePassword(): void {
    if (!this.hasPassword()) return;
    if (this.deps.access.length && !this.deps.access.some((entry) => entry.role === 'admin')) throw new AuthConflict('Ohne Kennwort muss ein Zugang die Stufe „admin“ haben – sonst könnte niemand mehr einrichten.');
    this.save((secrets) => void delete secrets[SETUP_SECTION]);
    delete this.deps.secrets[SETUP_SECTION];
    this.deps.log.info(this.deps.access.length ? 'Einrichtungskennwort entfernt.' : 'Einrichtungskennwort entfernt – die API ist wieder offen.');
  }

  /** Meldet mit dem Kennwort an. `from` ist die Herkunft des Aufrufs – daran hängt die Bremse gegen das Raten. */
  async login(password: unknown, from: string): Promise<Session> {
    this.logins.check(from);
    const record = this.deps.secrets[SETUP_SECTION]?.['password'];
    if (!this.hasPassword() || !record) throw new LoginRefused('Es ist kein Einrichtungskennwort festgelegt.');
    if (typeof password !== 'string' || password.length > MAX_PASSWORD_CHARS || !(await verifyPassword(password, record))) {
      this.logins.fail(from);
      this.deps.log.warn(`Anmeldung zum Einrichten abgelehnt (von ${from}).`);
      throw new LoginRefused('Das Kennwort stimmt nicht.');
    }
    this.logins.pass(from);
    this.deps.log.info(`Zum Einrichten angemeldet (von ${from}).`);
    return this.issue();
  }

  /** Prüft eine vorgelegte Anmeldung: echt, noch gültig und mit dem jetzigen Kennwort ausgestellt. */
  session(token: string): boolean {
    const key = this.deps.secrets[SETUP_SECTION]?.['key'];
    if (!key || !this.hasPassword()) return false;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'cs1') return false;
    const expires = parseInt(parts[1]!, 36);
    if (!Number.isFinite(expires) || expires <= this.now()) return false;
    const expected = createHmac('sha256', key).update(parts.slice(0, 3).join('.')).digest();
    const given = Buffer.from(parts[3]!, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /**
   * Legt einen Einrichtungscode in den Datenordner und schreibt ihn ins Protokoll. Jeder darf das anstoßen –
   * es verrät nichts: Den Code liest nur, wer an die Dateien oder das Protokoll der Installation kommt.
   */
  startReset(): { file: string; minutes: number } {
    const file = join(this.deps.dataDir, RESET_FILE);
    if (!this.reset || this.now() - this.reset.created > RESET_KEEP_MS) {
      const digits = String(randomInt(0, 100_000_000)).padStart(8, '0');
      const code = `${digits.slice(0, 4)}-${digits.slice(4)}`;
      this.reset = { code, created: this.now(), expires: this.now() + RESET_MS, tries: 0 };
      mkdirSync(this.deps.dataDir, { recursive: true });
      const until = new Date(this.reset.expires).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      writeFileSync(file, `Einrichtungscode für Culinola: ${code}\n\nGültig bis ${until} Uhr. Mit diesem Code lässt sich auf der Seite zum Einrichten ein neues Kennwort festlegen.\nWer den Code nicht angefordert hat, kann diese Datei löschen – ohne ihn ändert sich nichts.\n`);
      this.deps.log.warn(`Einrichtungscode angefordert: ${code} – gültig ${RESET_MS / 60_000} Minuten, steht auch in ${file}.`);
    }
    return { file: RESET_FILE, minutes: Math.round(RESET_MS / 60_000) };
  }

  /** Legt mit einem gültigen Einrichtungscode ein neues Kennwort fest. Der Code gilt einmal. */
  async resetPassword(code: unknown, password: unknown, from: string): Promise<Session> {
    this.resets.check(from);
    const pending = this.reset;
    if (!pending || pending.expires <= this.now()) {
      this.clearReset();
      throw new LoginRefused('Es gibt keinen gültigen Einrichtungscode. Bitte einen neuen anfordern.');
    }
    const digits = (text: unknown) => Buffer.from((typeof text === 'string' ? text : '').replace(/\D/g, '').padEnd(8, 'x').slice(0, 16));
    const given = digits(code);
    const expected = digits(pending.code);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      this.resets.fail(from);
      // Wer oft danebenliegt, rät – dann gilt auch der Code nicht mehr
      if (++pending.tries >= RESET_TRIES) this.clearReset();
      throw new LoginRefused('Der Einrichtungscode stimmt nicht.');
    }
    // Erst prüfen, ob das Kennwort taugt: Ein zu kurzes soll den Code nicht verbrauchen
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_CHARS) throw new InvalidPassword(PASSWORD_RULE);
    const session = await this.setPassword(password);
    this.resets.pass(from);
    this.clearReset();
    this.deps.log.warn(`Einrichtungskennwort mit dem Einrichtungscode neu festgelegt (von ${from}).`);
    return session;
  }

  private clearReset(): void {
    this.reset = undefined;
    rmSync(join(this.deps.dataDir, RESET_FILE), { force: true });
  }

  private issue(): Session {
    const key = this.deps.secrets[SETUP_SECTION]!['key']!;
    const expires = this.now() + SESSION_MS;
    const body = `cs1.${expires.toString(36)}.${randomBytes(12).toString('base64url')}`;
    return { token: `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`, expires: new Date(expires).toISOString() };
  }

  /** Ändert `secrets.json`; alles andere in der Datei bleibt, wie es dort steht. */
  private save(change: (secrets: Secrets) => void): void {
    let secrets: Secrets;
    try {
      secrets = (this.deps.secretsFile.read() ?? {}) as Secrets;
      if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error(`${this.deps.secretsFile.path} ist kein Objekt.`);
    } catch (error) {
      throw new AuthConflict(`${error instanceof Error ? error.message : String(error)} Gespeichert wurde nichts.`);
    }
    change(secrets);
    this.deps.secretsFile.write(secrets);
  }
}
