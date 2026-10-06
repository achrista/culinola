import { describe, expect, it, vi } from 'vitest';
import { ActionRegistry, InvalidParams, UnknownAction } from './actions.ts';

function registryWithTimer() {
  const registry = new ActionRegistry();
  const handler = vi.fn(() => 'gestartet');
  registry.register(
    {
      name: 'timer.start',
      description: 'Startet die Eieruhr.',
      params: { minutes: { type: 'number', description: 'Dauer in Minuten', required: true }, label: { type: 'string', description: 'Bezeichnung' } },
    },
    handler,
  );
  return { registry, handler };
}

describe('ActionRegistry', () => {
  it('führt eine Aktion mit geprüften Parametern aus', async () => {
    const { registry, handler } = registryWithTimer();
    await expect(registry.run('timer.start', { minutes: 8 })).resolves.toBe('gestartet');
    expect(handler).toHaveBeenCalledWith({ minutes: 8 });
  });

  it('listet die Anmeldungen nach Namen sortiert', () => {
    const { registry } = registryWithTimer();
    registry.register({ name: 'radio.stop', description: 'Schaltet das Radio aus.' }, () => undefined);
    expect(registry.list().map((action) => action.name)).toEqual(['radio.stop', 'timer.start']);
  });

  it('lehnt Namen ohne Bereich und doppelte Anmeldungen ab', () => {
    const { registry } = registryWithTimer();
    expect(() => registry.register({ name: 'stop', description: '' }, () => undefined)).toThrow(/bereich\.name/);
    expect(() => registry.register({ name: 'timer.start', description: '' }, () => undefined)).toThrow(/schon angemeldet/);
  });

  it('meldet unbekannte Aktionen', async () => {
    const { registry } = registryWithTimer();
    await expect(registry.run('radio.play')).rejects.toBeInstanceOf(UnknownAction);
  });

  it('meldet fehlende, falsch getypte und unbekannte Parameter, ohne die Aktion auszuführen', async () => {
    const { registry, handler } = registryWithTimer();
    await expect(registry.run('timer.start', {})).rejects.toThrow(/"minutes" fehlt/);
    await expect(registry.run('timer.start', { minutes: 'acht' })).rejects.toBeInstanceOf(InvalidParams);
    await expect(registry.run('timer.start', { minutes: 8, laut: true })).rejects.toThrow(/kennt den Parameter "laut" nicht/);
    expect(handler).not.toHaveBeenCalled();
  });
});
