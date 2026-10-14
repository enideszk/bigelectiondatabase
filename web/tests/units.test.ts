import { describe, expect, it } from 'vitest';
import type { ParentLink } from '../src/lib/types';
import { parentsOn, referenceDate, validOn } from '../src/lib/units';
import { closestValue } from '../src/sidebar/indicators';

const link = (id: string, depth: number, valid_from: string | null, valid_to: string | null): ParentLink => ({
  id,
  type: 'county',
  name: id,
  name_en: null,
  depth,
  valid_from,
  valid_to,
});

describe('validity periods', () => {
  it('are half-open with null meaning open-ended', () => {
    const period = { valid_from: '2013-01-01', valid_to: '2014-10-12' };
    expect(validOn(period, '2013-01-01')).toBe(true);
    expect(validOn(period, '2014-10-11')).toBe(true);
    expect(validOn(period, '2014-10-12')).toBe(false);
    expect(validOn({ valid_from: null, valid_to: null }, '1990-03-25')).toBe(true);
  });

  it('pick the breadcrumb valid on the election date, top first', () => {
    const parents = [
      link('county', 1, null, '2013-01-01'),
      link('jaras', 1, '2013-01-01', null),
      link('county', 2, '2013-01-01', null),
      link('region', 2, null, '2013-01-01'),
      link('region', 3, '2013-01-01', null),
    ];
    expect(parentsOn(parents, '2010-04-11').map((p) => p.id)).toEqual(['region', 'county']);
    expect(parentsOn(parents, '2018-04-08').map((p) => p.id)).toEqual(['region', 'county', 'jaras']);
  });

  it('describe a unit that no longer existed as of its last day', () => {
    expect(referenceDate({ valid_from: null, valid_to: '2014-10-12' }, '2018-04-08')).toBe('2014-10-11');
    expect(referenceDate({ valid_from: '2013-01-01', valid_to: null }, '2010-04-11')).toBe('2013-01-01');
    expect(referenceDate({ valid_from: null, valid_to: null }, '2010-04-11')).toBe('2010-04-11');
  });
});

describe('indicator year choice', () => {
  const values = [
    { indicator: 'x', year: 2011, value: 1 },
    { indicator: 'x', year: 2022, value: 2 },
  ];
  it('takes the year closest to the election', () => {
    expect(closestValue(values, 2010)?.year).toBe(2011);
    expect(closestValue(values, 2018)?.year).toBe(2022);
  });
  it('prefers the earlier year on a tie', () => {
    expect(closestValue([{ indicator: 'x', year: 2014, value: 1 }, { indicator: 'x', year: 2018, value: 2 }], 2016)?.year).toBe(2014);
  });
});
