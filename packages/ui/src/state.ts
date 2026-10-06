import type { DatapointValue } from '@culinola/sdk';

const HSB = /^\d+(?:\.\d+)?,\d+(?:\.\d+)?,(\d+(?:\.\d+)?)$/;

/**
 * Ob etwas Schaltbares gerade an ist. Ein Schalter meldet wahr oder falsch,
 * ein Dimmer seine Helligkeit in Prozent, eine Farblampe "Farbton,Sättigung,Helligkeit".
 */
export function isOn(value: DatapointValue | undefined): boolean {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const match = HSB.exec(value);
    return match ? Number(match[1]) > 0 : false;
  }
  return false;
}
