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
/** The map's levels; 'settlement' shows settlements and Budapest districts. */
export type MapLevel = 'settlement' | 'jaras' | 'county' | 'nuts2' | 'nuts1' | 'smd';
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
  /** The map's boundary files; per level, load the ones whose period contains the date shown. */
  geo: GeoFileMeta[];
}

export interface GeoFileMeta {
  level: MapLevel;
  /** Path below data/, e.g. "geo/settlement.json" or "geo/smd-2024.json". */
  file: string;
  /** Its border mesh, e.g. "geo/settlement.lines.json". */
  lines: string;
  /** Period the file's features cover (null = open-ended). */
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
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
  /** Earlier ancestor chains that differ from `parents`, oldest first: each applies before its
   *  `until` date (e.g. the counties of Central Hungary, a region until 2018). */
  earlier_parents?: EarlierParents[];
  /** Settlements and Budapest districts: the electoral districts (of every district set) they lie
   *  in, wholly or partly. */
  districts?: string[];
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
}

export interface EarlierParents {
  /** First day this chain no longer applies. */
  until: IsoDate;
  parents: string[];
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
  /** The country only: the votes cast by mail (party lists only), which the totals above include. */
  mail?: MailVotes;
}

export interface MailVotes {
  turnout: Turnout[];
  lists: ListResult[];
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
  /** The list's option id on the map (see ResultOption). */
  option: string;
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
  /** The nominating parties' option id on the map (see ResultOption). */
  option: string;
  votes: number;
}

export interface DistrictWins {
  /** Short names of the winning candidates' parties; empty = independent. */
  parties: string[];
  color: string;
  /** Their option id on the map (see ResultOption). */
  option: string;
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
  /** L: party lists. E: single-member races by the candidates' nominating parties (null when the
   *  election has none). */
  views: { L: ResultView | null; E: ResultView | null };
}

export type ResultViewId = 'L' | 'E';

export interface ResultView {
  /** Every option with votes, most votes nationally first. */
  options: ResultOption[];
  /** Unit id -> id of the option with the most votes. Colors the map. */
  winners: { [unitId: string]: string };
  /** Unit id -> what the map's hover card shows, for the same units as `winners`. */
  summaries: { [unitId: string]: UnitSummary };
}

/**
 * A party list (view L) or the parties that nominated candidates together (view E). The id is the
 * parties' ids joined by "-" in both views ("fidesz-kdnp"), so a party keeps its id across years and
 * views; "independent" for no party, "list-<list_id>" for a list whose party set is not unique.
 * Joint candidates of a list's parties carry that list's name and color.
 */
export interface ResultOption {
  id: string;
  /** Empty for independents. */
  name: string;
  short_name: string;
  /** "#rrggbb" */
  color: string;
  /** Short names of the member parties, as they were called at the election. */
  parties: string[];
  /** Votes nationally: round 1 (L), each district's final round (E). */
  votes: number;
}

export interface UnitSummary {
  /** Voted / registered (0..1); null when unknown. */
  turnout: number | null;
  /** The (up to) four options with the most votes, most first: [option id, share (0..1)]. Shares
   *  are of all valid list ballots (L, as the official results count them) or of all candidate
   *  votes (E). */
  top: [string, number][];
}

// ---- data/shares/{election_id}/{L|E}/{option_id}.json ------------------------------------------

/** One option's share (0..1) in every unit where it got votes (E: where it had a candidate). */
export interface ShareFile {
  [unitId: string]: number;
}

// ---- data/stations/{election_id}.json ------------------------------------------------------------

/** Every polling station's results (votes cast by mail belong to no station). */
export interface StationFile {
  /** The option ids (ElectionFile views) that the vote arrays of the stations refer to. */
  options: { L?: string[]; E?: string[] };
  stations: StationRow[];
}

export interface StationRow {
  /** "MAZ-OEVK-TAZ-SZK": NVI county code, electoral district, NVI settlement code, station number. */
  id: string;
  /** The settlement or Budapest district it is in. */
  unit: string;
  /** Its electoral district. */
  district: string | null;
  /** A station for voters registered elsewhere (átjelentkezés). */
  transfer?: boolean;
  /** List ballot: [registered, voted, valid, invalid] (null = unknown). */
  tl: (number | null)[];
  /** Candidate ballot, the same. */
  te: (number | null)[];
  /** Party-list votes, in the order of options.L. */
  L: number[];
  /** Candidate votes by nominating parties: [index in options.E, votes]. */
  E: [number, number][];
}

// ---- data/indicators/{indicator_id}.json ------------------------------------------------------

/** One indicator in every unit that has it: [year, value] pairs, oldest first. */
export interface IndicatorFile {
  [unitId: string]: [number, number][];
}

// ---- data/geo/{level}.json, data/geo/smd-{set}.json (GeoJSON) ------------------------------

/** Every geometry version of one map level's units; show those valid on the date shown. */
export interface GeoFile {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface GeoFeature {
  type: 'Feature';
  properties: GeoProperties;
  geometry: GeoGeometry;
}

export interface GeoProperties {
  /** Unit id. */
  id: string;
  name: string;
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
}

/** Longitude/latitude rings. */
export type GeoGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** data/geo/{name}.lines.json: every border of a geo file's features once, per period in which
 *  the same features are valid (drawn above the fills instead of stroking each polygon). */
export interface GeoLinesFile {
  type: 'FeatureCollection';
  features: GeoLinesFeature[];
}

export interface GeoLinesFeature {
  type: 'Feature';
  properties: { valid_from: IsoDate | null; valid_to: IsoDate | null };
  geometry: { type: 'LineString'; coordinates: number[][] } | { type: 'MultiLineString'; coordinates: number[][][] };
}
