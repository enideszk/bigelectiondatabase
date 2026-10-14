/** Number and date formatting (US conventions: 1,234.5 and April 8, 2018). */

import type { IsoDate } from './types';

export const LOCALE = 'en-US';

const numberFormats = new Map<number, Intl.NumberFormat>();

function numberFormat(decimals: number): Intl.NumberFormat {
  let f = numberFormats.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    numberFormats.set(decimals, f);
  }
  return f;
}

/** 1234567 -> "1,234,567"; null -> "–" */
export function formatInt(n: number | null | undefined): string {
  return n == null ? '–' : numberFormat(0).format(n);
}

export function formatNumber(n: number, decimals: number): string {
  return numberFormat(decimals).format(n);
}

/** 0.4567 -> "45.7%" */
export function formatShare(share: number, decimals = 1): string {
  return `${formatNumber(share * 100, decimals)}%`;
}

/** An indicator value with its unit: "45.2%", "412,300 HUF", "1,250 persons". */
export function formatValue(value: number, unitOfMeasure: string, decimals: number): string {
  const n = formatNumber(value, decimals);
  return unitOfMeasure === '%' ? `${n}%` : `${n} ${unitOfMeasure}`;
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'long', timeZone: 'UTC' });

/** "2018-04-08" -> "April 8, 2018" (no time-zone shifts: the date is treated as a calendar date). */
export function formatDate(iso: IsoDate): string {
  const [y, m, d] = iso.split('-').map(Number);
  return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2018-04-08" -> 20180408, the integer form used by the tiles' vf/vt properties. */
export function dateToInt(iso: IsoDate): number {
  return Number(iso.replaceAll('-', ''));
}

/** Lowercase without accents, for search: "Őrfalu" -> "orfalu". */
export function normalizeForSearch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
