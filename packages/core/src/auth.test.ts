import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@culinola/sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { type AccessToken, authorize } from './access.ts';
import { Attempts, Auth, AuthConflict, hashPassword, InvalidPassword, LoginRefused, RESET_FILE, TooManyAttempts, verifyPassword } from './auth.ts';
import { JsonFile } from './jsonfile.ts';
import { Pairing, UnknownPairing } from './pairing.ts';

const dir = mkdtempSync(join(tmpdir(), 'culinola-auth-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function setup(name: string, access: AccessToken[] = []) {
  const clock = { now: Date.parse('2026-10-13T10:00:00Z') };
  const said: string[] = [];
  const log: Logger = { info: (message) => void said.push(message), warn: (message) => void said.push(message), error: () => undefined };
  const dataDir = join(dir, name);
  const secrets: Record<string, Record<string, string>> = {};
  const secretsFile = new JsonFile(join(dataDir, 'secrets.json'));
  const auth = new Auth({ secrets, secretsFile, access, dataDir, log, now: () => clock.now });
  const code = () => /(\d{4}-\d{4})/.exec(readFileSync(join(dataDir, RESET_FILE), 'utf8'))![1]!;
  return { auth, clock, said, secrets, secretsFile, dataDir, code };
}

describe('Prüfwert eines Kennworts', () => {
  it('bestätigt das richtige Kennwort und kein anderes', async () => {
    const record = await hashPassword('Küchenschlüssel 7');
    expect(record).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(record).not.toContain('Küchenschlüssel');
    expect(await verifyPassword('Küchenschlüssel 7', record)).toBe(true);
    expect(await verifyPassword('Küchenschlüssel 8', record)).toBe(false);
    // Jeder Prüfwert hat sein eigenes Salz
    expect(await hashPassword('Küchenschlüssel 7')).not.toBe(record);
    // Unsinn in einer von Hand geänderten Datei wird abgelehnt, nicht ausgeführt
    for (const broken of ['', 'klartext', 'scrypt$1$8$1$abc$def', 'scrypt$99999999999$8$1$abc$def', 'md5$1$1$1$abc$def']) expect(await verifyPassword('x', broken), broken).toBe(false);
  });
});

describe('Bremse gegen das Raten', () => {
  it('lässt einige Fehlversuche frei und verlängert danach die Wartezeit', () => {
    let now = 0;
    const attempts = new Attempts(3, () => now);
    attempts.fail('a');
    attempts.fail('a');
    expect(() => attempts.check('a')).not.toThrow();
    attempts.fail('a');
    expect(() => attempts.check('a')).toThrow(TooManyAttempts);
    // Ein anderes Gerät ist davon nicht betroffen
    expect(() => attempts.check('b')).not.toThrow();
    now += 30_000;
    expect(() => attempts.check('a')).not.toThrow();
    attempts.fail('a');
    now += 30_000;
    expect(() => attempts.check('a')).toThrow(/30 Sekunden/);
    now += 30_000;
    attempts.pass('a');
    attempts.fail('a');
    expect(() => attempts.check('a')).not.toThrow();
  });
});

describe('Einrichtungskennwort', () => {
  it('schützt die bis dahin offene API und meldet mit dem Kennwort an', async () => {
    const { auth, secretsFile, secrets } = setup('kennwort');
    expect([auth.hasPassword(), auth.protected()]).toEqual([false, false]);
    expect(authorize([], undefined, 'admin', auth)).toMatchObject({ ok: true, name: 'offen' });
    for (const weak of [undefined, 7, '', 'kurz']) await expect(auth.setPassword(weak), String(weak)).rejects.toBeInstanceOf(InvalidPassword);
    await expect(auth.login('Küchenschlüssel 7', 'a')).rejects.toThrow(/kein Einrichtungskennwort/);

    const first = await auth.setPassword('Küchenschlüssel 7');
    expect([auth.hasPassword(), auth.protected()]).toEqual([true, true]);
    // In der Datei steht ein Prüfwert, nie das Kennwort
    const stored = secretsFile.read() as Record<string, Record<string, string>>;
    expect(stored['setup']!['password']).toMatch(/^scrypt\$/);
    expect(JSON.stringify(stored)).not.toContain('Küchenschlüssel');
    expect(secrets['setup']).toEqual(stored['setup']);

    // Ohne Anmeldung geht nichts mehr, mit ihr alles
    expect(authorize([], undefined, 'read', auth)).toMatchObject({ ok: false, status: 401 });
    expect(authorize([], 'irgendwas', 'read', auth)).toMatchObject({ ok: false, status: 401 });
    expect(authorize([], first.token, 'admin', auth)).toEqual({ ok: true, name: 'kennwort', role: 'admin' });
    const again = await auth.login('Küchenschlüssel 7', 'a');
    expect(again.token).not.toBe(first.token);
    expect(auth.session(again.token)).toBe(true);
    await expect(auth.login('falsch geraten', 'a')).rejects.toBeInstanceOf(LoginRefused);
  });

  it('lässt Anmeldungen ablaufen und beendet sie mit einem neuen Kennwort', async () => {
    const { auth, clock } = setup('ablauf');
    const session = await auth.setPassword('Küchenschlüssel 7');
    expect(Date.parse(session.expires) - clock.now).toBe(30 * 24 * 3_600_000);
    // Verändert oder erfunden gilt nicht
    for (const forged of [`${session.token}x`, session.token.replace(/^cs1\.[^.]+/, `cs1.${(clock.now * 2).toString(36)}`), 'cs1.zzzz.abc.def', '', 'a.b.c.d']) expect(auth.session(forged), forged).toBe(false);
    clock.now += 29 * 24 * 3_600_000;
    expect(auth.session(session.token)).toBe(true);
    clock.now += 2 * 24 * 3_600_000;
    expect(auth.session(session.token)).toBe(false);

    const fresh = await auth.login('Küchenschlüssel 7', 'a');
    const changed = await auth.setPassword('Ganz anderes Kennwort');
    expect([auth.session(fresh.token), auth.session(changed.token)]).toEqual([false, true]);
    await expect(auth.login('Küchenschlüssel 7', 'a')).rejects.toBeInstanceOf(LoginRefused);
  });

  it('bremst das Raten je Herkunft', async () => {
    const { auth, clock } = setup('raten');
    await auth.setPassword('Küchenschlüssel 7');
    for (let attempt = 0; attempt < 5; attempt++) await expect(auth.login(`falsch ${attempt}`, 'gast')).rejects.toBeInstanceOf(LoginRefused);
    // Jetzt wird nicht einmal mehr das richtige Kennwort geprüft
    await expect(auth.login('Küchenschlüssel 7', 'gast')).rejects.toBeInstanceOf(TooManyAttempts);
    expect((await auth.login('Küchenschlüssel 7', 'buero')).token).toBeTruthy();
    clock.now += 31_000;
    expect((await auth.login('Küchenschlüssel 7', 'gast')).token).toBeTruthy();
  });

  it('lässt sich nur entfernen, wenn danach noch jemand einrichten kann', async () => {
    const access: AccessToken[] = [{ name: 'kueche', role: 'control', token: 'token-der-kueche-0123456789' }];
    const { auth, secretsFile } = setup('entfernen', access);
    await auth.setPassword('Küchenschlüssel 7');
    expect(() => auth.removePassword()).toThrow(AuthConflict);
    access.push({ name: 'buero', role: 'admin', token: 'token-vom-buero-0123456789' });
    auth.removePassword();
    expect([auth.hasPassword(), auth.protected()]).toEqual([false, true]);
    expect((secretsFile.read() as Record<string, unknown>)['setup']).toBeUndefined();
    // Ohne Zugänge ist die API danach wieder offen
    const alone = setup('entfernen-offen');
    await alone.auth.setPassword('Küchenschlüssel 7');
    alone.auth.removePassword();
    expect(alone.auth.protected()).toBe(false);
  });
});

describe('Kennwort vergessen', () => {
  it('legt einen Code in den Datenordner, mit dem sich ein neues Kennwort festlegen lässt', async () => {
    const { auth, clock, said, dataDir, code } = setup('vergessen');
    const old = await auth.setPassword('Küchenschlüssel 7');
    await expect(auth.resetPassword('1234-5678', 'Neues Kennwort 1', 'a')).rejects.toThrow(/keinen gültigen Einrichtungscode/);

    expect(auth.startReset()).toEqual({ file: RESET_FILE, minutes: 15 });
    const first = code();
    expect(said.at(-1)).toContain(first);
    // Wer die Taste mehrmals drückt, bekommt nicht jedes Mal einen neuen Code
    auth.startReset();
    expect(code()).toBe(first);

    await expect(auth.resetPassword('0000-0000', 'Neues Kennwort 1', 'a')).rejects.toBeInstanceOf(LoginRefused);
    // Ein zu kurzes Kennwort verbraucht den Code nicht
    await expect(auth.resetPassword(first, 'kurz', 'a')).rejects.toBeInstanceOf(InvalidPassword);
    // Der Code gilt auch ohne Bindestrich und mit Leerzeichen
    const session = await auth.resetPassword(` ${first.replace('-', ' ')} `, 'Neues Kennwort 1', 'a');
    expect([auth.session(session.token), auth.session(old.token)]).toEqual([true, false]);
    expect((await auth.login('Neues Kennwort 1', 'a')).token).toBeTruthy();
    // Der Code gilt einmal, die Datei ist weg
    expect(existsSync(join(dataDir, RESET_FILE))).toBe(false);
    await expect(auth.resetPassword(first, 'Noch ein Kennwort', 'a')).rejects.toBeInstanceOf(LoginRefused);

    // Nach einer Viertelstunde verfällt ein Code von selbst
    clock.now += 120_000;
    auth.startReset();
    const second = code();
    expect(second).not.toBe(first);
    clock.now += 16 * 60_000;
    await expect(auth.resetPassword(second, 'Noch ein Kennwort', 'a')).rejects.toThrow(/keinen gültigen/);
    expect(existsSync(join(dataDir, RESET_FILE))).toBe(false);
  });

  it('legt das erste Kennwort fest, wenn es nur Zugänge ohne Einrichtungsrecht gibt', async () => {
    const access: AccessToken[] = [{ name: 'kueche', role: 'control', token: 'token-der-kueche-0123456789' }];
    const { auth, code } = setup('uebernehmen', access);
    auth.startReset();
    const session = await auth.resetPassword(code(), 'Küchenschlüssel 7', 'a');
    expect(authorize(access, session.token, 'admin', auth)).toMatchObject({ ok: true, role: 'admin' });
    // Der vorhandene Zugang bleibt, wie er ist
    expect(authorize(access, 'token-der-kueche-0123456789', 'control', auth)).toMatchObject({ ok: true, name: 'kueche' });
    expect(authorize(access, 'token-der-kueche-0123456789', 'admin', auth)).toMatchObject({ ok: false, status: 403 });
  });

  it('macht den Code wertlos, wenn jemand ihn zu erraten versucht', async () => {
    const { auth, clock, code } = setup('code-raten');
    auth.startReset();
    const real = code();
    for (let attempt = 0; attempt < 10; attempt++) {
      // Jeder Versuch von einem anderen Gerät, damit nicht schon die Bremse je Herkunft greift
      await expect(auth.resetPassword('1111-1111', 'Neues Kennwort 1', `gast-${attempt}`)).rejects.toBeInstanceOf(LoginRefused);
      clock.now += 1000;
    }
    await expect(auth.resetPassword(real, 'Neues Kennwort 1', 'besitzer')).rejects.toThrow(/keinen gültigen/);
    expect(auth.hasPassword()).toBe(false);
  });
});

describe('Geräte koppeln', () => {
  it('händigt den Zugang nur dem Gerät aus, das gefragt hat – und nur einmal', () => {
    let now = 0;
    const pairing = new Pairing(() => now);
    const kitchen = pairing.request(' Chrome  auf Windows · main ', '192.168.1.20');
    expect(kitchen.code).toMatch(/^\d{6}$/);
    expect(pairing.list()).toEqual([{ id: kitchen.id, code: kitchen.code, label: 'Chrome auf Windows · main', address: '192.168.1.20', since: new Date(0).toISOString() }]);
    expect(pairing.poll(kitchen.id, kitchen.secret)).toMatchObject({ state: 'waiting', code: kitchen.code });
    // Wer nur die Nummer der Anfrage kennt, erfährt nichts
    expect(pairing.poll(kitchen.id, 'geraten')).toEqual({ state: 'expired' });
    expect(pairing.poll('gibt-es-nicht', kitchen.secret)).toEqual({ state: 'expired' });

    pairing.approve(kitchen.id, { name: 'kueche', role: 'control', token: 'geheimes-token' });
    expect(pairing.list()).toEqual([]);
    expect(() => pairing.approve(kitchen.id, { name: 'x', role: 'read', token: 'y' })).toThrow(UnknownPairing);
    expect(pairing.poll(kitchen.id, 'geraten')).toEqual({ state: 'expired' });
    expect(pairing.poll(kitchen.id, kitchen.secret)).toEqual({ state: 'approved', name: 'kueche', role: 'control', token: 'geheimes-token' });
    expect(pairing.poll(kitchen.id, kitchen.secret)).toEqual({ state: 'expired' });
  });

  it('lehnt ab, lässt verfallen und begrenzt die Zahl der Anfragen', () => {
    let now = 0;
    const pairing = new Pairing(() => now);
    const guest = pairing.request('Gast', '192.168.1.30');
    pairing.reject(guest.id);
    expect(pairing.poll(guest.id, guest.secret)).toEqual({ state: 'rejected' });
    expect(() => pairing.reject(guest.id)).toThrow(UnknownPairing);

    const slow = pairing.request('Flur', '192.168.1.31');
    now += 10 * 60_000 + 1;
    expect(pairing.poll(slow.id, slow.secret)).toEqual({ state: 'expired' });
    expect(pairing.waiting(slow.id)).toBe(false);

    // Ein Gerät, das immer neu lädt, belegt höchstens drei Anfragen – die älteste macht Platz
    const own = [1, 2, 3, 4].map(() => pairing.request('Küche', '192.168.1.20'));
    expect(pairing.list().map((entry) => entry.id)).toEqual(own.slice(1).map((entry) => entry.id));
    // Insgesamt ist bei zwanzig Schluss
    for (let device = 0; device < 17; device++) pairing.request('Gerät', `10.0.0.${device}`);
    expect(() => pairing.request('Noch eines', '10.0.1.1')).toThrow(TooManyAttempts);
    expect(new Set(pairing.list().map((entry) => entry.code)).size).toBe(20);
  });
});
