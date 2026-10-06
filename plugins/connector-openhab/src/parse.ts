import type { DatapointValue, Quality } from '@culinola/sdk';

export interface ParsedState {
  value: DatapointValue;
  unit?: string;
  quality: Quality;
}

const NUMBER_WITH_UNIT = /^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(?:\s+(.+))?$/;

/**
 * Zerlegt einen openHAB-Zustand in Rohwert und Einheit.
 * openHAB liefert Zustände als Text: "21.5 °C", "ON", "NULL".
 */
export function parseState(state: string, itemType: string): ParsedState {
  if (state === 'NULL' || state === 'UNDEF') return { value: null, quality: 'stale' };

  if (itemType === 'Switch') {
    if (state === 'ON') return { value: true, quality: 'good' };
    if (state === 'OFF') return { value: false, quality: 'good' };
  }

  const match = NUMBER_WITH_UNIT.exec(state);
  if (match) {
    const value = Number(match[1]);
    return match[2] ? { value, unit: match[2], quality: 'good' } : { value, quality: 'good' };
  }

  return { value: state, quality: 'good' };
}

/** Übersetzt einen Culinola-Wert in einen openHAB-Befehl. */
export function toCommand(value: DatapointValue): string {
  if (value === true) return 'ON';
  if (value === false) return 'OFF';
  if (value === null) throw new Error('Ein leerer Wert lässt sich nicht als Befehl senden.');
  return String(value);
}

/** Liest den Itemnamen aus einem Ereignisthema; Gruppenereignisse haben eine andere Form und werden übergangen. */
export function itemFromTopic(topic: string): string | undefined {
  const parts = topic.split('/');
  return parts.length === 4 && parts[0] === 'openhab' && parts[1] === 'items' && parts[3] === 'statechanged' ? parts[2] : undefined;
}
