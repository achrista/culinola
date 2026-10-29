import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installationId, sendPing, telemetryEnabled, telemetryPing } from './telemetry.ts';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'culinola-telemetry-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('Anonyme Meldung', () => {
  it('ist an, solange nichts sie abschaltet', () => {
    expect(telemetryEnabled(undefined, {})).toBe(true);
    expect(telemetryEnabled(true, {})).toBe(true);
  });

  it('lässt sich in config.json und über die Umgebung abschalten', () => {
    expect(telemetryEnabled(false, {})).toBe(false);
    for (const value of ['0', 'false', 'OFF', 'aus']) expect(telemetryEnabled(undefined, { CULINOLA_TELEMETRY: value })).toBe(false);
    expect(telemetryEnabled(undefined, { CULINOLA_TELEMETRY: '1' })).toBe(true);
  });

  it('bleibt in CI-Läufen aus', () => {
    expect(telemetryEnabled(undefined, { CI: 'true' })).toBe(false);
  });

  it('behält die Kennung der Installation über Neustarts', () => {
    const dir = tempDir();
    const id = installationId(dir);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readFileSync(join(dir, 'installation-id'), 'utf8').trim()).toBe(id);
    expect(installationId(dir)).toBe(id);
  });

  it('ersetzt eine unbrauchbare Kennung', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'installation-id'), 'Unsinn');
    expect(installationId(dir)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('meldet nur Kennung, Version und Umgebung', () => {
    const ping = telemetryPing(tempDir(), true);
    expect(Object.keys(ping).sort()).toEqual(['arch', 'demo', 'docker', 'id', 'os', 'version']);
    expect(ping.demo).toBe(true);
  });

  it('verschluckt Fehler beim Senden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(sendPing(telemetryPing(tempDir(), false))).resolves.toBe(false);
  });

  it('schickt die Meldung als JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const ping = telemetryPing(tempDir(), false);
    await expect(sendPing(ping, 'https://example.test/ping')).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://example.test/ping', expect.objectContaining({ method: 'POST', body: JSON.stringify(ping) }));
  });
});
