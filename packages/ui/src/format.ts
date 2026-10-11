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

/** Kurze Zeitangabe für Listen: heute die Uhrzeit, in den letzten Tagen der Wochentag, sonst das Datum. */
export function shortWhen(date: string): string {
  const time = new Date(date);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return new Intl.DateTimeFormat(region.value, { hour: '2-digit', minute: '2-digit' }).format(time);
  if (days < 7) return new Intl.DateTimeFormat(region.value, { weekday: 'short' }).format(time);
  return new Intl.DateTimeFormat(region.value, { day: 'numeric', month: 'numeric' }).format(time);
}

/** Eine Lautstärke in Prozent als Faktor: 100 ist der gewohnte Stand, 0 stumm, mehr als 200 gibt es nicht. Unbrauchbares ergibt die Vorgabe. */
export function volumeLevel(percent: unknown, fallback: number): number {
  const value = typeof percent === 'number' && Number.isFinite(percent) ? percent : fallback;
  return Math.min(200, Math.max(0, value)) / 100;
}
