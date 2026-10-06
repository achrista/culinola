import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { definePlugin } from '@culinola/sdk';
import { countdown, extend, restore, settle, stopwatch, type TimerState } from './timer.ts';

/**
 * Eieruhr und Stoppuhr. Der Zustand liegt im Kern und nicht in der Anzeige: So zeigen
 * ihn alle Anzeigen gleich, er übersteht ein Neuladen, und er lässt sich auch über die
 * API oder per Sprache stellen.
 */
export default definePlugin({
  id: 'timer',

  start(context) {
    const { log } = context;
    const file = join(context.storageDir, 'state.json');

    let saved: unknown;
    try {
      saved = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // Beim ersten Start gibt es noch keinen gespeicherten Zustand.
    }
    let state: TimerState = { mode: 'idle' };
    let alarm: NodeJS.Timeout | undefined;

    const iso = (time: number | undefined) => (time ? new Date(time).toISOString() : '');
    const apply = (next: TimerState) => {
      const before = state.mode;
      state = next;
      clearTimeout(alarm);
      if (state.mode === 'down') alarm = setTimeout(() => apply(settle(state, Date.now())), Math.max(0, state.end - Date.now()));
      if (state.mode === 'done' && before !== 'done') log.info('Die Eieruhr ist abgelaufen.');
      try {
        writeFileSync(file, JSON.stringify(state));
      } catch (error) {
        log.warn(`Zustand der Eieruhr nicht speicherbar: ${error instanceof Error ? error.message : String(error)}`);
      }
      context.datapoints.set({ id: 'state', value: state.mode, label: 'Eieruhr: Zustand' });
      context.datapoints.set({ id: 'end', value: iso(state.mode === 'down' || state.mode === 'done' ? state.end : undefined), label: 'Eieruhr: Ende' });
      context.datapoints.set({ id: 'since', value: iso(state.mode === 'up' ? state.since : undefined), label: 'Stoppuhr: Beginn' });
      context.datapoints.set({ id: 'duration', value: state.mode === 'down' || state.mode === 'done' ? state.duration : 0, unit: 's', label: 'Eieruhr: gestellte Dauer' });
    };

    apply(restore(saved, Date.now()));
    context.signal.addEventListener('abort', () => clearTimeout(alarm));

    context.actions.register(
      {
        name: 'timer.start',
        description: 'Stellt die Eieruhr: Sie läuft die angegebene Zeit rückwärts und meldet sich am Ende.',
        params: {
          minutes: { type: 'number', description: 'Dauer in Minuten' },
          seconds: { type: 'number', description: 'Dauer in Sekunden, zusätzlich zu den Minuten' },
        },
      },
      ({ minutes, seconds }) => {
        const total = (typeof minutes === 'number' ? minutes * 60 : 0) + (typeof seconds === 'number' ? seconds : 0);
        apply(countdown(Date.now(), total));
        log.info(`Eieruhr auf ${Math.floor(total / 60)} min ${Math.round(total % 60)} s gestellt.`);
      },
    );

    context.actions.register({ name: 'timer.stopwatch', description: 'Startet die Stoppuhr: Sie zählt vorwärts, bis sie angehalten wird.' }, () => {
      apply(stopwatch(Date.now()));
      log.info('Stoppuhr gestartet.');
    });

    context.actions.register(
      {
        name: 'timer.add',
        description: 'Verlängert die laufende Eieruhr um die angegebenen Sekunden; eine negative Angabe verkürzt sie.',
        params: { seconds: { type: 'number', description: 'Sekunden, z. B. 60 für eine Minute mehr', required: true } },
      },
      ({ seconds }) => apply(extend(state, Date.now(), Number(seconds))),
    );

    context.actions.register({ name: 'timer.stop', description: 'Hält Eieruhr oder Stoppuhr an und beendet das Klingeln.' }, () => {
      if (state.mode !== 'idle') log.info('Eieruhr angehalten.');
      apply({ mode: 'idle' });
    });
  },
});
