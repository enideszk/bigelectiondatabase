/**
 * What the map is colored by (state.map):
 *   null                 each area's winner in the shown result view (L lists, E single-member
 *                        candidates by nominating parties)
 *   "party:<option id>"  that option's vote share
 *   "turnout"            turnout of the shown view
 *   "indicator:<id>"     a socio-demographic indicator, the year closest to the election
 * The last three are step maps: steps holding equal numbers of areas (cut per map level: counties
 * and settlements spread differently), from near-white up to the color deepened, with opaque fills.
 * Gives every unit its color, per map level the legend, and for the hover card the mapped value.
 */

import { loadIndicator, loadShares } from '../lib/api';
import { shareBreaks, shareStep, stepColor } from '../lib/color';
import { formatCompact, formatShare, formatValue } from '../lib/format';
import { t } from '../lib/i18n';
import type { ElectionFile, ElectionMeta, IndicatorMeta, ResultOption, ResultViewId } from '../lib/types';
import { LEVELS, type Level } from '../state';
import { FILL_OPACITY, NO_DATA_COLOR } from './style';

const TURNOUT_COLOR = '#2a8fd6';
const INDICATOR_COLOR = '#7a5cc8';

export type MapBy =
  | { kind: 'winners' }
  | { kind: 'party'; option: string }
  | { kind: 'turnout' }
  | { kind: 'indicator'; id: string };

export function parseMapBy(value: string | null): MapBy {
  if (value === 'turnout') return { kind: 'turnout' };
  if (value?.startsWith('party:')) return { kind: 'party', option: value.slice(6) };
  if (value?.startsWith('indicator:')) return { kind: 'indicator', id: value.slice(10) };
  return { kind: 'winners' };
}

export const partyMap = (option: string) => `party:${option}`;
export const indicatorMap = (id: string) => `indicator:${id}`;

export interface LegendItem {
  label: string;
  color: string;
  /** Winners: areas won. */
  count?: number;
}

export interface Legend {
  title: string;
  kind: 'winners' | 'steps';
  items: LegendItem[];
}

export interface Coloring {
  colors: Map<string, string>;
  fillOpacity: number;
  /** Per map level; null without anything to show. */
  legend: Record<Level, Legend> | null;
  /** Step maps: the mapped value of each unit, for the hover card. */
  values: Map<string, string>;
  /** False when the state asks for something this election / view does not have. */
  valid: boolean;
}

export const optionLabel = (o: Pick<ResultOption, 'short_name' | 'parties'>) => o.short_name || (o.parties.length ? o.parties.join('–') : t.independent);

const empty = (valid: boolean): Coloring => ({ colors: new Map(), fillOpacity: FILL_OPACITY, legend: null, values: new Map(), valid });

export async function buildColoring(
  election: ElectionFile | null,
  meta: { election: ElectionMeta | undefined; indicators: IndicatorMeta[] },
  view: ResultViewId,
  map: string | null,
  levelOf: (unitId: string) => Level | null,
): Promise<Coloring> {
  const by = parseMapBy(map);
  const result = election?.views[view] ?? null;

  if (by.kind === 'indicator') {
    const indicator = meta.indicators.find((i) => i.id === by.id);
    if (!indicator) return empty(false);
    const file = await loadIndicator(indicator.id);
    const year = meta.election ? Number(meta.election.date.slice(0, 4)) : new Date().getFullYear();
    const values = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const [unitId, series] of Object.entries(file)) {
      const [y, value] = series.reduce((best, p) => (Math.abs(p[0] - year) < Math.abs(best[0] - year) ? p : best));
      values.set(unitId, value);
      labels.set(unitId, `${indicator.name}: ${formatValue(value, indicator.unit_of_measure, indicator.decimals)} ${t.indicatorYear(y)}`);
    }
    return steps(values, labels, INDICATOR_COLOR, indicator.name, formatCompact, levelOf);
  }

  if (!election || !result) return empty(by.kind === 'winners');
  const options = new Map(result.options.map((o) => [o.id, o]));

  if (by.kind === 'turnout') {
    const values = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const [unitId, summary] of Object.entries(result.summaries)) {
      if (summary.turnout === null) continue;
      values.set(unitId, summary.turnout);
      labels.set(unitId, `${t.turnout} ${formatShare(summary.turnout, 2)}`);
    }
    return steps(values, labels, TURNOUT_COLOR, t.mapTurnout, (v) => formatShare(v, 0), levelOf);
  }

  if (by.kind === 'party') {
    const option = options.get(by.option);
    if (!option) return { ...(await buildColoring(election, meta, view, null, levelOf)), valid: false };
    const shares = await loadShares(election.id, view, option.id);
    const values = new Map(Object.entries(shares));
    const labels = new Map([...values].map(([unitId, share]) => [unitId, `${optionLabel(option)} ${formatShare(share)}`]));
    return steps(values, labels, option.color, t.legendShare(optionLabel(option)), (v) => formatShare(v), levelOf);
  }

  // winners
  const colors = new Map<string, string>();
  const legend = {} as Record<Level, Legend>;
  const wins = new Map<Level, Map<string, number>>(LEVELS.map((l) => [l, new Map()]));
  for (const [unitId, winner] of Object.entries(result.winners)) {
    colors.set(unitId, options.get(winner)?.color ?? NO_DATA_COLOR);
    const level = levelOf(unitId);
    if (level) wins.get(level)!.set(winner, (wins.get(level)!.get(winner) ?? 0) + 1);
  }
  for (const level of LEVELS) {
    const counts = wins.get(level)!;
    legend[level] = {
      title: view === 'L' ? t.legendLists : t.legendCandidates,
      kind: 'winners',
      items: result.options
        .filter((o) => counts.has(o.id))
        .sort((a, b) => counts.get(b.id)! - counts.get(a.id)!)
        .map((o) => ({ label: optionLabel(o), color: o.color, count: counts.get(o.id) })),
    };
  }
  return { colors, fillOpacity: FILL_OPACITY, legend, values: new Map(), valid: true };
}

/** A step map of `values` in `color`, the steps cut separately for each map level. */
function steps(
  values: Map<string, number>,
  labels: Map<string, string>,
  color: string,
  title: string,
  format: (v: number) => string,
  levelOf: (unitId: string) => Level | null,
): Coloring {
  const colors = new Map<string, string>();
  const legend = {} as Record<Level, Legend>;
  const byLevel = new Map<Level, [string, number][]>(LEVELS.map((l) => [l, []]));
  for (const [unitId, value] of values) {
    const level = levelOf(unitId);
    if (level) byLevel.get(level)!.push([unitId, value]);
  }
  for (const level of LEVELS) {
    const entries = byLevel.get(level)!;
    const breaks = shareBreaks(entries.map(([, v]) => v));
    for (const [unitId, value] of entries) colors.set(unitId, stepColor(color, breaks, shareStep(breaks, value)));
    const lo = Math.min(...entries.map(([, v]) => v));
    const hi = Math.max(...entries.map(([, v]) => v));
    const bounds = entries.length ? [lo, ...breaks, hi] : [];
    legend[level] = {
      title,
      kind: 'steps',
      items: bounds.slice(1).map((upper, i) => ({ label: `${format(bounds[i])}–${format(upper)}`, color: stepColor(color, breaks, i) })),
    };
  }
  return { colors, fillOpacity: 1, legend, values: labels, valid: true };
}
