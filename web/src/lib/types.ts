/**
 * Shapes of the static JSON files the website reads. `etl export` (etl/src/etl/export/) writes
 * exactly these files; this file is the contract between the two halves of the project.
 *
 * After changing anything here:
 *   1. `npm run schema`  (regenerates types.schema.json; the Python tests validate every exported
 *      file against it, and a web test fails if the schema is stale)
 *   2. update the exporter until `.\etl test` passes.
 */

/** Calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

export type UnitType = 'country' | 'nuts1' | 'nuts2' | 'county' | 'smd' | 'jaras' | 'settlement' | 'bp_district';
export type ElectionType = 'parliament' | 'ep' | 'local' | 'referendum';
/** 'list' = party-list ballot, 'candidate' = single-member ballot. */
export type Ballot = 'list' | 'candidate';
export type LineageType = 'merge' | 'split' | 'rename' | 'recode' | 'transfer';

// ---- data/meta.json ------------------------------------------------------------------------

export interface Meta {
  schema_version: 1;
  /** When `etl export` ran (ISO 8601 timestamp). */
  generated_at: string;
  /** True when the database holds the FAKE development fixture; the site then shows a banner. */
  is_fixture: boolean;
  /** Notices the sources' licenses require on the map, e.g. "© OpenStreetMap contributors". */
  attribution: string[];
  /** Oldest first. */
  elections: ElectionMeta[];
  indicators: IndicatorMeta[];
  unit_types: UnitTypeMeta[];
}

export interface ElectionMeta {
  id: string;
  type: ElectionType;
  /** English name of the election type, e.g. "Parliamentary election". */
  type_name: string;
  year: number;
  /** Date of round 1. */
  date: IsoDate;
  name: string;
  name_hu: string;
  rounds: RoundMeta[];
  /** Electoral district set used (parliamentary elections), e.g. "2011". */
  district_set: string | null;
}

export interface RoundMeta {
  round: number;
  date: IsoDate;
}

export interface IndicatorMeta {
  id: string;
  name: string;
  name_hu: string;
  /** Shown after the value: "%", "HUF", "persons". */
  unit_of_measure: string;
  decimals: number;
  description: string | null;
  /** Name of the source the indicator definition was loaded from. */
  source: string;
}

export interface UnitTypeMeta {
  type: UnitType;
  name: string;
  name_hu: string;
}

// ---- data/units/index.json -----------------------------------------------------------------

export interface UnitIndex {
  units: UnitIndexEntry[];
}

export interface UnitIndexEntry {
  id: string;
  type: UnitType;
  name: string;
  name_en: string | null;
  /** Ancestor ids, top (country) first, valid on the unit's last day (today if it still exists). */
  parents: string[];
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
}

// ---- data/units/{id}.json ------------------------------------------------------------------

export interface UnitFile {
  id: string;
  type: UnitType;
  code: string;
  name: string;
  name_en: string | null;
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
  former_names: FormerName[];
  /** Every ancestor link with its validity; pick the ones valid on the selected election's date. */
  parents: ParentLink[];
  lineage: LineageEvent[];
  /** Keyed by election id; only elections with results for this unit. */
  elections: { [electionId: string]: UnitElection };
  /** Sorted by indicator, then year. */
  indicators: IndicatorValue[];
}

export interface FormerName {
  name: string;
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
}

export interface ParentLink {
  id: string;
  type: UnitType;
  name: string;
  name_en: string | null;
  /** 1 = direct parent. */
  depth: number;
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
}

export interface LineageEvent {
  date: IsoDate;
  type: LineageType;
  /** 'to': this unit (or part of it) went into the other unit; 'from': the other unit came into this one. */
  direction: 'from' | 'to';
  other_id: string;
  other_name: string;
  weight: number | null;
}

export interface UnitElection {
  /** Electoral districts this unit lies in (wholly or partly) in this election. Empty above county level. */
  districts: UnitRef[];
  turnout: Turnout[];
  /** Party-list votes cast in this unit, by round, most votes first. */
  lists: ListResult[];
  /** Single-member races with votes cast in this unit, one per district and round. Empty above county level. */
  races: Race[];
  /** Above county level only: single-member districts won (final round), per winning party combination. */
  district_wins: DistrictWins[];
}

export interface UnitRef {
  id: string;
  name: string;
}

export interface Turnout {
  round: number;
  ballot: Ballot;
  registered: number | null;
  voted: number | null;
  valid: number | null;
  invalid: number | null;
}

export interface ListResult {
  round: number;
  list_id: number;
  name: string;
  short_name: string;
  /** "#rrggbb" */
  color: string;
  /** Short names of the member parties, as they were called at the election. */
  parties: string[];
  votes: number;
}

export interface Race {
  district: UnitRef;
  round: number;
  /** Most votes first. */
  candidates: CandidateResult[];
}

export interface CandidateResult {
  candidate_id: number;
  name: string;
  /** Short names of the nominating parties; empty = independent. */
  parties: string[];
  color: string;
  votes: number;
}

export interface DistrictWins {
  /** Short names of the winning candidates' parties; empty = independent. */
  parties: string[];
  color: string;
  districts: number;
}

export interface IndicatorValue {
  indicator: string;
  year: number;
  value: number;
}

// ---- data/elections/{id}.json --------------------------------------------------------------

export interface ElectionFile {
  id: string;
  lists: ElectionList[];
  /** Unit id -> list_id of the winning party list (round 1), for every unit with results. Colors the map. */
  winners: { [unitId: string]: number };
}

export interface ElectionList {
  list_id: number;
  name: string;
  short_name: string;
  color: string;
  parties: string[];
}
