import type { DatapointValue } from '@culinola/sdk';
import { i18n, region } from './i18n.ts';

/**
 * Formatiert einen Rohwert für die Anzeige – Zahlen nach der eingestellten Region,
 * Schaltzustände in der eingestellten Sprache. Die Einheit wird getrennt ausgegeben.
 */
export function formatValue(value: DatapointValue | undefined, decimals?: number): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return i18n.global.t(value ? 'state.on' : 'state.off');
  if (typeof value === 'string') return value;
  const digits = decimals ?? (Math.abs(value) >= 100 ? 0 : 1);
  return new Intl.NumberFormat(region.value, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
