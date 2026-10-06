import { InvalidInput } from '@culinola/sdk';

/** Zustand der Eieruhr; Zeitpunkte in Millisekunden seit 1970, Dauer in Sekunden. */
export type TimerState =
  | { mode: 'idle' }
  /** Läuft rückwärts bis `end`. */
  | { mode: 'down'; end: number; duration: number }
  /** Stoppuhr: zählt seit `since` vorwärts. */
  | { mode: 'up'; since: number }
  /** Abgelaufen und noch nicht quittiert. */
  | { mode: 'done'; end: number; duration: number };

export const MAX_SECONDS = 24 * 60 * 60;

/** Stellt die Eieruhr auf eine Dauer. */
export function countdown(now: number, seconds: number): TimerState {
  if (!Number.isFinite(seconds) || seconds < 1) throw new InvalidInput('Die Dauer muss mindestens eine Sekunde betragen.');
  if (seconds > MAX_SECONDS) throw new InvalidInput('Die Dauer darf höchstens 24 Stunden betragen.');
  const duration = Math.round(seconds);
  return { mode: 'down', end: now + duration * 1000, duration };
}

export function stopwatch(now: number): TimerState {
  return { mode: 'up', since: now };
}

/**
 * Verlängert oder verkürzt die laufende Eieruhr. Nach dem Ablauf stellt eine
 * Verlängerung sie neu – so lässt sich beim Klingeln „noch eine Minute“ geben.
 */
export function extend(state: TimerState, now: number, seconds: number): TimerState {
  if (!Number.isFinite(seconds) || seconds === 0) throw new InvalidInput('Die Angabe "seconds" fehlt.');
  if (state.mode === 'done' && seconds > 0) return countdown(now, seconds);
  if (state.mode !== 'down') throw new InvalidInput('Es läuft keine Eieruhr, die sich verlängern ließe.');
  const end = state.end + Math.round(seconds) * 1000;
  if (end - now > MAX_SECONDS * 1000) throw new InvalidInput('Die Dauer darf höchstens 24 Stunden betragen.');
  return settle({ mode: 'down', end, duration: Math.max(1, state.duration + Math.round(seconds)) }, now);
}

/** Macht aus einer abgelaufenen Eieruhr eine, die sich meldet. */
export function settle(state: TimerState, now: number): TimerState {
  return state.mode === 'down' && state.end <= now ? { mode: 'done', end: state.end, duration: state.duration } : state;
}

/** Liest einen gespeicherten Zustand; alles Unlesbare gilt als „läuft nicht“. */
export function restore(raw: unknown, now: number): TimerState {
  const saved = (raw ?? {}) as { mode?: unknown; end?: unknown; since?: unknown; duration?: unknown };
  const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if ((saved.mode === 'down' || saved.mode === 'done') && time(saved.end) && time(saved.duration)) {
    return settle({ mode: saved.mode, end: saved.end, duration: saved.duration }, now);
  }
  // Eine Stoppuhr aus der Zukunft oder von vorgestern stammt nicht aus einem gewöhnlichen Neustart
  if (saved.mode === 'up' && time(saved.since) && saved.since <= now && now - saved.since < MAX_SECONDS * 1000) return { mode: 'up', since: saved.since };
  return { mode: 'idle' };
}
