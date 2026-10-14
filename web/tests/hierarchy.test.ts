import { describe, expect, it } from 'vitest';
import type { UnitIndexEntry, UnitType } from '../src/lib/types';
import { Hierarchy } from '../src/map/hierarchy';

const unit = (id: string, type: UnitType, parents: string[], extra: Partial<UnitIndexEntry> = {}): UnitIndexEntry => ({
  id, type, name: id, name_en: null, parents, valid_from: null, valid_to: null, ...extra,
});

// Two large regions; Central Hungary was one region (HU10) until 2018, then Budapest (HU11) and Pest (HU12).
const units = new Map(
  [
    unit('country-X', 'country', []),
    unit('nuts1-1', 'nuts1', ['country-X']),
    unit('nuts1-2', 'nuts1', ['country-X']),
    unit('nuts2-10', 'nuts2', ['country-X', 'nuts1-1'], { valid_to: '2018-01-01' }),
    unit('nuts2-11', 'nuts2', ['country-X', 'nuts1-1'], { valid_from: '2018-01-01' }),
    unit('nuts2-12', 'nuts2', ['country-X', 'nuts1-1'], { valid_from: '2018-01-01' }),
    unit('nuts2-20', 'nuts2', ['country-X', 'nuts1-2']),
    unit('county-01', 'county', ['country-X', 'nuts1-1', 'nuts2-11'], { earlier_parents: [{ until: '2018-01-01', parents: ['country-X', 'nuts1-1', 'nuts2-10'] }] }),
    unit('county-13', 'county', ['country-X', 'nuts1-1', 'nuts2-12'], { earlier_parents: [{ until: '2018-01-01', parents: ['country-X', 'nuts1-1', 'nuts2-10'] }] }),
    unit('county-09', 'county', ['country-X', 'nuts1-2', 'nuts2-20']),
    unit('jaras-1', 'jaras', ['country-X', 'nuts1-2', 'nuts2-20', 'county-09']),
    unit('settlement-a', 'settlement', ['country-X', 'nuts1-2', 'nuts2-20', 'county-09', 'jaras-1'], { districts: ['smd-2011-09-01', 'smd-2024-09-01'] }),
    unit('bp_district-1', 'bp_district', ['country-X', 'nuts1-1', 'nuts2-11', 'county-01']),
    unit('smd-2011-09-01', 'smd', [], { valid_to: '2024-01-01' }),
    unit('smd-2024-09-01', 'smd', [], { valid_from: '2024-01-01' }),
  ].map((u) => [u.id, u]),
);
const h = new Hierarchy(units);
const D = '2026-04-12';

describe('hierarchical navigation', () => {
  it('opens each area one level down: a county its electoral districts, a district its settlements', () => {
    expect(h.childLevel('nuts1-2', D)).toBe('nuts2');
    expect(h.childLevel('county-09', D)).toBe('smd');
    expect(h.childLevel('smd-2024-09-01', D)).toBe('settlement');
    expect(h.childLevel('county-01', D)).toBe('settlement'); // no district here: straight to its units
    expect(h.childLevel('jaras-1', D)).toBe('settlement');
    expect(h.childLevel('settlement-a', D)).toBeNull();
  });

  it('puts a settlement in the electoral district of the set in force', () => {
    expect([...h.members('smd-2024-09-01', 'settlement', D)!]).toEqual(['settlement-a']);
    expect(h.members('smd-2011-09-01', 'settlement', D)!.size).toBe(0);
    expect([...h.members('smd-2011-09-01', 'settlement', '2022-04-03')!]).toEqual(['settlement-a']);
    expect(h.parent('settlement-a', D)).toBe('smd-2024-09-01');
  });

  it('shows the units inside the focus, by the parents of the date shown', () => {
    expect(h.members(null, 'county', D)).toBeNull();
    expect([...h.members('nuts1-1', 'nuts2', D)!]).toEqual(['nuts2-11', 'nuts2-12']);
    expect([...h.members('nuts2-10', 'county', '2014-04-06')!].sort()).toEqual(['county-01', 'county-13']);
    expect([...h.members('county-09', 'smd', D)!]).toEqual(['smd-2024-09-01']); // county from the code, set in force
  });

  it('goes one up, and up past levels that are not above the level picked', () => {
    expect(h.parent('county-09', D)).toBe('nuts2-20');
    expect(h.parent('county-13', '2014-04-06')).toBe('nuts2-10');
    expect(h.parent('nuts1-1', D)).toBeNull();
    expect(h.focusFor('jaras-1', 'county', D)).toBe('nuts2-20');
    expect(h.focusFor('smd-2024-09-01', 'jaras', D)).toBe('county-09');
    expect(h.focusFor('county-09', 'settlement', D)).toBe('county-09');
  });
});
