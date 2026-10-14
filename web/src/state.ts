/**
 * Application state, mirrored in the URL so links are shareable:
 *   ?unit=settlement-99001&year=2018&view=L&party=fidesz-kdnp
 *   (type=parliament, round=1, level=settlement are defaults; party = the option shown as a share map)
 * Selecting another unit adds a browser history entry; other changes replace the current one.
 */

import type { ElectionMeta, ElectionType, IsoDate, MapLevel, Meta } from './lib/types';

export type View = 'L' | 'E';
export type Level = MapLevel;
export const LEVELS: Level[] = ['settlement', 'jaras', 'county', 'nuts2', 'nuts1', 'smd'];

export interface AppState {
  unit: string | null;
  year: number;
  type: ElectionType;
  view: View;
  round: number;
  level: Level;
  /** Map option shown as a vote-share map (ResultOption.id); null = each area's winner. */
  party: string | null;
}

type Listener = (state: AppState, previous: AppState) => void;

let meta: Meta;
let state: AppState;
const listeners = new Set<Listener>();

export function initState(m: Meta): AppState {
  meta = m;
  state = fromUrl();
  history.replaceState(null, '', toUrl(state));
  window.addEventListener('popstate', () => commit(fromUrl(), 'none'));
  return state;
}

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  const next = normalize({ ...state, ...patch });
  commit(next, next.unit !== state.unit ? 'push' : 'replace');
}

export function subscribe(listener: Listener): void {
  listeners.add(listener);
}

/** The election the state points at (year + type); undefined while no election is loaded at all. */
export function currentElection(s: AppState = state): ElectionMeta | undefined {
  return meta.elections.find((e) => e.year === s.year && e.type === s.type) ?? meta.elections.at(-1);
}

/** The date the map and sidebar describe: the selected election's date, or today without elections. */
export function viewDate(s: AppState = state): IsoDate {
  return currentElection(s)?.date ?? new Date().toISOString().slice(0, 10);
}

function commit(next: AppState, history_: 'push' | 'replace' | 'none'): void {
  const previous = state;
  state = next;
  if (history_ === 'push') history.pushState(null, '', toUrl(next));
  if (history_ === 'replace') history.replaceState(null, '', toUrl(next));
  for (const listener of listeners) listener(next, previous);
}

function fromUrl(): AppState {
  const p = new URLSearchParams(location.search);
  const latest = meta.elections.at(-1);
  return normalize({
    unit: p.get('unit'),
    year: Number(p.get('year')) || latest?.year || new Date().getFullYear(),
    type: (p.get('type') as ElectionType | null) ?? 'parliament',
    view: p.get('view') === 'E' ? 'E' : 'L',
    round: Number(p.get('round')) || 1,
    level: LEVELS.includes(p.get('level') as Level) ? (p.get('level') as Level) : 'settlement',
    party: p.get('party') || null,
  });
}

/** Clamp the state to something that exists (unknown year -> latest election, missing round -> 1). */
function normalize(s: AppState): AppState {
  let election = meta.elections.find((e) => e.year === s.year && e.type === s.type);
  if (!election) election = meta.elections.filter((e) => e.type === s.type).pop() ?? meta.elections.at(-1);
  if (!election) return { ...s, round: 1 }; // nothing loaded yet: keep the URL's year
  const round = election.rounds.some((r) => r.round === s.round) ? s.round : 1;
  return { ...s, year: election.year, type: election.type, round };
}

function toUrl(s: AppState): string {
  const p = new URLSearchParams();
  if (s.unit) p.set('unit', s.unit);
  p.set('year', String(s.year));
  if (s.type !== 'parliament') p.set('type', s.type);
  p.set('view', s.view);
  if (s.view === 'E' && s.round !== 1) p.set('round', String(s.round));
  if (s.level !== 'settlement') p.set('level', s.level);
  if (s.party) p.set('party', s.party);
  return `?${p.toString()}`;
}
