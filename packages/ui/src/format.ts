import type { DatapointValue } from '@culinola/sdk';

const locale = navigator.language || 'de-DE';

/** Formatiert einen Rohwert für die Anzeige; die Einheit wird getrennt ausgegeben. */
export function formatValue(value: DatapointValue | undefined, decimals?: number): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'boolean') return value ? 'an' : 'aus';
  if (typeof value === 'string') return value;
  const digits = decimals ?? (Math.abs(value) >= 100 ? 0 : 1);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
