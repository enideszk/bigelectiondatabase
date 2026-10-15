/**
 * Every piece of UI text lives here (English). Place, party and candidate names are data and come
 * from the JSON files unchanged. To add another language later, add a second object of the same
 * shape and pick one at startup.
 */

import { formatInt } from './format';
import type { ElectionType, LineageType } from './types';
import type { Level } from '../state';

export const t = {
  appTitle: 'Hungarian elections & demographics',
  fixtureBanner: 'Fake development data: invented places, parties and results. Not real elections.',

  searchPlaceholder: 'Search a settlement, county, district…',
  searchNoMatches: 'No matches',
  selectPrompt: 'Click an area on the map or search above.',
  loading: 'Loading…',
  loadError: 'Could not load the data for this unit.',
  close: 'Close',

  formerly: 'Formerly',
  inPrefix: 'in',
  electoralDistricts: 'Electoral districts',
  electionHeading: (year: number, typeName: string) => `${year} ${typeName.toLowerCase()} results`,
  notExisting: (name: string) => `${name} did not exist at the time of this election.`,
  noDataForElection: 'No results for this unit in this election.',
  noElections: 'No election results are loaded yet.',

  participation: 'Participation',
  turnout: 'Turnout',
  voted: 'Voted',
  didNotVote: 'Did not vote',
  noTurnout: 'No turnout data.',
  ballotsCast: 'Ballot papers in the ballot box and received envelopes',
  invalidBallots: 'Invalid stamped ballot papers',
  validBallots: 'Valid ballot papers',

  results: 'Results',
  viewLTitle: 'Party lists',
  viewETitle: 'Single-member districts',
  round: (n: number) => `Round ${n}`,
  noListResults: 'No party-list results for this unit.',
  noCandidateResults: 'No single-member results for this unit.',
  noRaceThisRound: 'No race in this round here (decided in round 1).',
  independent: 'Independent',
  other: (n: number) => `Other (${n})`,
  showFewer: 'Show fewer',
  pickHint: 'Click a row to map its vote share; click again to go back.',
  districtsWon: 'Districts won',
  districtsWonNote: 'Winners of the final round in the single-member districts of this area.',
  districtWord: (n: number) => (n === 1 ? 'district' : 'districts'),

  indicators: 'Socio-demographic indicators',
  indicatorColumn: 'Indicator',
  valueColumn: 'Value',
  yearColumn: 'Year',
  noIndicators: 'No indicators for this unit yet.',
  indicatorYearNote: 'Each value is from the year closest to the selected election.',

  levels: {
    settlement: 'Settlements',
    jaras: 'Districts (járás)',
    county: 'Counties',
    nuts2: 'Regions',
    nuts1: 'Large regions',
    smd: 'Electoral districts',
  } satisfies Record<Level, string>,
  legendLists: 'Largest list',
  legendCandidates: 'Most single-member votes',
  legendShare: (name: string) => `${name} vote share`,
  mapShows: 'Map',
  mapWinner: { L: 'Largest list in each area', E: 'Most single-member votes in each area' },
  mapShare: (name: string) => `${name} vote share`,
  mapTurnout: 'Turnout',
  includePostal: 'Include postal votes',
  goToStations: 'Go to polling station list',
  stations: {
    title: 'Polling stations',
    close: 'Close',
    search: 'Search: settlement, electoral district, county, region, station ID… (all words must match)',
    allDistricts: 'All electoral districts',
    allParties: 'All parties',
    showShares: '%',
    showVotes: 'Votes',
    count: (shown: number, total: number, what: string) => `${formatInt(shown)} of ${formatInt(total)} ${what}`,
    showAll: (n: number) => `Show all (${formatInt(n)} left)`,
    none: 'Nothing matches the search.',
    loading: 'Loading polling stations…',
    unavailable: 'No polling-station data for this election.',
    columns: {
      id: 'Station ID',
      name: 'Settlement',
      district: 'Electoral district',
      county: 'County',
      region: 'Region',
      area: 'Area',
      registered: 'Registered',
      turnout: 'Turnout',
      other: 'Other',
      winner: 'Winner',
    },
    groups: { geo: 'Geographical data', register: 'Electoral register data', votes: 'Party votes', result: 'Result' },
    /** What the rows are, for the count line, per level. */
    rows: {
      station: 'polling stations',
      settlement: 'settlements',
      smd: 'electoral districts',
      county: 'counties',
      nuts2: 'regions',
      country: 'areas',
    },
    expand: 'Show the results of this polling station',
    hide: 'Close the results of this polling station',
    open: (name: string) => `Open ${name}`,
    transferShort: 'T',
    station: (n: string) => `Polling station ${n}`,
    stationKind: 'Polling station',
    transfer: 'transfer station',
    moves: 'Move through the hierarchy',
    goUp: 'Go up',
    goDown: 'Go down',
    goBack: 'Go back',
    upTo: (what: string) => `One level up: all the ${what} around`,
    downTo: (what: string) => `One level down: every one of the ${what} here`,
    backToStations: 'Back to the polling stations of all Hungary',
    noResults: 'No results here.',
  },
  navToggle: 'Hierarchical map navigation',
  navHint: 'Clicking an area opens it and shows the areas one level below it.',
  goUp: (name: string) => `↑ Go one up (${name})`,
  country: 'Hungary',
  mapGroupShares: 'Vote share',
  mapGroupIndicators: 'Socio-demographic indicators',
  indicatorYear: (year: number) => `(${year})`,
  noData: 'No data',
  noResults: 'No results in this election',
  /** Map control, in this order. */
  electionTypes: {
    parliament: 'Parliamentary',
    local: 'Municipal',
    ep: 'EU Parliament',
    referendum: 'Referendum',
  } satisfies Record<ElectionType, string>,
  notLoaded: 'No data loaded yet',

  aria: {
    mapLevel: 'Map level',
    electionType: 'Election type',
    electionYear: 'Election year',
    resultType: 'Result type',
    round: 'Round',
  },

  lineage: (type: LineageType, direction: 'from' | 'to', date: string): [string, string] => {
    // [text before the other unit's name, text after it]
    const texts: Record<LineageType, Record<'from' | 'to', [string, string]>> = {
      merge: { to: ['Merged into ', ` on ${date}.`], from: ['', ` merged into it on ${date}.`] },
      split: { to: ['Part of it became ', ` on ${date}.`], from: ['Split off from ', ` on ${date}.`] },
      rename: { to: ['Renamed to ', ` on ${date}.`], from: ['Previously ', ` (until ${date}).`] },
      recode: { to: ['Continued under a new code as ', ` from ${date}.`], from: ['Previously coded as ', ` (until ${date}).`] },
      transfer: { to: ['Territory transferred to ', ` on ${date}.`], from: ['Received territory from ', ` on ${date}.`] },
    };
    return texts[type][direction];
  },
};
