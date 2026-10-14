/** Helpers for units and their validity periods. */

import type { IsoDate, ParentLink, UnitType } from './types';
import type { Level } from '../state';

interface Valid {
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
}

/** Half-open [valid_from, valid_to), null = open-ended. ISO dates compare correctly as strings. */
export function validOn(item: Valid, date: IsoDate): boolean {
  return (item.valid_from === null || item.valid_from <= date) && (item.valid_to === null || date < item.valid_to);
}

/**
 * The date to describe a unit at: `date` itself if the unit existed then, otherwise the closest
 * day on which it did exist (its last day, or its first day).
 */
export function referenceDate(item: Valid, date: IsoDate): IsoDate {
  if (validOn(item, date)) return date;
  if (item.valid_to !== null && date >= item.valid_to) {
    const [y, m, d] = item.valid_to.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  }
  return item.valid_from ?? date;
}

/** Breadcrumb for a date: ancestors valid on that day, top (country) first. */
export function parentsOn(parents: ParentLink[], date: IsoDate): ParentLink[] {
  return parents.filter((p) => validOn(p, date)).sort((a, b) => b.depth - a.depth);
}

/** English name where the data has one (regions, country), else the official name. */
export function displayName(unit: { name: string; name_en: string | null }): string {
  return unit.name_en ?? unit.name;
}

/** The map level that shows units of this type, if any. */
export function levelOfType(type: UnitType): Level | null {
  switch (type) {
    case 'settlement':
    case 'bp_district':
      return 'settlement';
    case 'jaras':
    case 'county':
    case 'nuts2':
    case 'nuts1':
    case 'smd':
      return type;
    default:
      return null;
  }
}
