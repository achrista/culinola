import { EventEmitter } from 'node:events';
import type { Datapoint, SeriesPoint } from '@culinola/sdk';

const BUFFER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BUFFER_MAX_POINTS = 5000;

/**
 * Hält den aktuellen Stand aller Datenpunkte und einen kurzen Verlauf der
 * Zahlenwerte im Speicher. Der Verlauf dient den Verlaufslinien der Kacheln
 * und als Ersatz, wenn eine Quelle selbst keine Historie liefert.
 */
export class DatapointRegistry extends EventEmitter<{ change: [Datapoint] }> {
  private readonly points = new Map<string, Datapoint>();
  private readonly buffers = new Map<string, SeriesPoint[]>();

  set(datapoint: Datapoint): void {
    this.points.set(datapoint.id, datapoint);
    if (typeof datapoint.value === 'number' && Number.isFinite(datapoint.value)) {
      this.record(datapoint.id, Date.parse(datapoint.ts), datapoint.value);
    }
    this.emit('change', datapoint);
  }

  get(id: string): Datapoint | undefined {
    return this.points.get(id);
  }

  all(): Datapoint[] {
    return [...this.points.values()];
  }

  /**
   * Vergisst den Stand aller Datenpunkte einer Quelle – wenn sie anhält oder entfernt wird. Der kurze Verlauf
   * bleibt: Startet die Quelle neu, setzen die Verlaufslinien dort fort.
   */
  removeSource(source: string): void {
    for (const id of this.points.keys()) if (id.startsWith(`${source}:`)) this.points.delete(id);
  }

  recent(id: string, from: number, to: number): SeriesPoint[] {
    return (this.buffers.get(id) ?? []).filter(([time]) => time >= from && time <= to);
  }

  private record(id: string, time: number, value: number): void {
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = [];
      this.buffers.set(id, buffer);
    }
    buffer.push([time, value]);
    const oldest = time - BUFFER_MAX_AGE_MS;
    while (buffer.length > BUFFER_MAX_POINTS || (buffer[0] && buffer[0][0] < oldest)) {
      buffer.shift();
    }
  }
}
