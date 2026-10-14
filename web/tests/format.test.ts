import { describe, expect, it } from 'vitest';
import { dateToInt, formatDate, formatInt, formatShare, formatValue, normalizeForSearch } from '../src/lib/format';

describe('US number and date formatting', () => {
  it('formats integers with comma thousands separators', () => {
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(0)).toBe('0');
    expect(formatInt(null)).toBe('–');
  });

  it('formats shares as percentages with a decimal point', () => {
    expect(formatShare(0.4567)).toBe('45.7%');
    expect(formatShare(1)).toBe('100.0%');
  });

  it('formats indicator values with their unit', () => {
    expect(formatValue(412300, 'HUF', 0)).toBe('412,300 HUF');
    expect(formatValue(5.25, '%', 1)).toBe('5.3%');
    expect(formatValue(1250, 'persons', 0)).toBe('1,250 persons');
  });

  it('formats calendar dates without time-zone shifts', () => {
    expect(formatDate('2018-04-08')).toBe('April 8, 2018');
    expect(formatDate('2010-01-01')).toBe('January 1, 2010');
  });

  it('converts dates to the integers used in tile filters', () => {
    expect(dateToInt('2018-04-08')).toBe(20180408);
  });

  it('normalizes Hungarian names for search', () => {
    expect(normalizeForSearch('Őrfalu')).toBe('orfalu');
    expect(normalizeForSearch('Üresd Álomfalva')).toBe('uresd alomfalva');
  });
});
