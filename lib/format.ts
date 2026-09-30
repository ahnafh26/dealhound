import type { Condition } from './types';

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string, locale = 'en-CA'): string {
  const key = `${locale}|${currency}`;
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: 'currency', currency });
    moneyFormats.set(key, format);
  }
  return format.format(amount);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const CONDITION_LABELS: Record<Condition, string> = {
  new: 'New',
  'open-box': 'Open box',
  refurb: 'Refurbished',
  'used-excellent': 'Used · Excellent',
  'used-good': 'Used · Good',
  'used-fair': 'Used · Fair',
  used: 'Used',
  parts: 'For parts',
  unknown: 'Condition unknown',
};
