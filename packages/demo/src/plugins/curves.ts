/** Gleichmäßiges, wiederholbares Rauschen statt Zufall – so passen Verlauf und Live-Wert zusammen. */
export function wobble(time: number, amplitude: number): number {
  return amplitude * (Math.sin(time / 97_000) + 0.5 * Math.sin(time / 31_000));
}

/** Die Uhrzeit eines Zeitpunkts in Stunden, mit Bruchteil. */
export function hourOf(time: number): number {
  const date = new Date(time);
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Ein Zeitpunkt vor so vielen Minuten, als ISO-Text. */
export function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Ein Tag vom heutigen aus, als "JJJJ-MM-TT". */
export function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Ein Zeitpunkt an einem Tag vom heutigen aus, als ISO-Text. */
export function at(offset: number, time: string): string {
  return new Date(`${day(offset)}T${time}:00`).toISOString();
}
