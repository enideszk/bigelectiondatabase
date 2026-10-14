/**
 * Hierarchical map navigation: large regions -> regions -> counties -> electoral districts (OEVK)
 * -> settlements, by the units' parents on the shown date (unit index). Electoral districts hang
 * under their county (from their code); a settlement lies in the districts of the set in force on
 * the date (a split city in each of its districts). The járások are reached with the level
 * buttons: under a county, and above their settlements.
 */

import type { IsoDate, UnitIndexEntry } from '../lib/types';
import { levelOfType, validOn } from '../lib/units';
import type { Level } from '../state';

/** The levels a click on a unit of each level opens, the first with units inside it. */
const NEXT: Record<Level, Level[]> = {
  nuts1: ['nuts2'],
  nuts2: ['county'],
  county: ['smd', 'settlement'],
  smd: ['settlement'],
  jaras: ['settlement'],
  settlement: [],
};
/** Depth of each map level (electoral districts sit beside the járások, under the counties). */
export const DEPTH: Record<Level, number> = { nuts1: 0, nuts2: 1, county: 2, jaras: 3, smd: 3, settlement: 4 };
/** Where navigation starts: the whole country, by large region. */
export const TOP_LEVEL: Level = 'nuts1';

export class Hierarchy {
  private readonly byLevel = new Map<Level, UnitIndexEntry[]>();

  constructor(private readonly units: Map<string, UnitIndexEntry>) {
    for (const unit of units.values()) {
      const level = levelOfType(unit.type);
      if (level) this.byLevel.set(level, [...(this.byLevel.get(level) ?? []), unit]);
    }
  }

  levelOf(unitId: string): Level | null {
    const unit = this.units.get(unitId);
    return unit ? levelOfType(unit.type) : null;
  }

  /** Ancestor ids of a unit on `date`, top first (a settlement's electoral districts last). */
  ancestors(unitId: string, date: IsoDate): string[] {
    const unit = this.units.get(unitId);
    if (!unit) return [];
    if (unit.type === 'smd') {
      // "smd-2024-09-01": set, county, number
      const county = `county-${unitId.split('-')[2]}`;
      return this.units.has(county) ? [...this.ancestors(county, date), county] : [];
    }
    let parents = unit.parents;
    for (const earlier of unit.earlier_parents ?? []) {
      if (date < earlier.until) {
        parents = earlier.parents;
        break;
      }
    }
    const districts = (unit.districts ?? []).filter((d) => this.units.has(d) && validOn(this.units.get(d)!, date));
    return [...parents, ...districts];
  }

  /** The units of `level` inside `focus` on `date`; null = no restriction (the whole country). */
  members(focus: string | null, level: Level, date: IsoDate): Set<string> | null {
    if (focus === null) return null;
    return new Set(
      (this.byLevel.get(level) ?? []).filter((u) => validOn(u, date) && this.ancestors(u.id, date).includes(focus)).map((u) => u.id),
    );
  }

  /** The level a click on `unitId` opens: the first of its next levels with units inside it on
   *  `date`; null when nothing is below (settlements). */
  childLevel(unitId: string, date: IsoDate): Level | null {
    const level = this.levelOf(unitId);
    if (!level) return null;
    for (const next of NEXT[level]) if (this.members(unitId, next, date)?.size) return next;
    return null;
  }

  /** The area one up from `focus` (null = the whole country). */
  parent(focus: string, date: IsoDate): string | null {
    const depth = DEPTH[this.levelOf(focus) ?? TOP_LEVEL];
    const up = [...this.ancestors(focus, date)].reverse().find((id) => {
      const level = this.levelOf(id);
      return level !== null && DEPTH[level] < depth && validOn(this.units.get(id)!, date);
    });
    return up ?? null;
  }

  /** The focus that shows units of `level`: `focus` itself, or the nearest area above it whose
   *  level is above `level` (a click on "Counties" while in a járás goes up to its region). */
  focusFor(focus: string | null, level: Level, date: IsoDate): string | null {
    let f = focus;
    while (f !== null && DEPTH[this.levelOf(f) ?? TOP_LEVEL] >= DEPTH[level]) f = this.parent(f, date);
    return f;
  }
}
