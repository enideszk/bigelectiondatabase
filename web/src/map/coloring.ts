/**
 * What the map is colored by: each area's winner in the shown result view (L lists, E single-member
 * candidates), or one option's vote share in steps. Gives every unit its color and, per map level,
 * the legend; the share steps are cut separately for each level (counties and settlements spread
 * differently).
 */

import { loadShares } from '../lib/api';
import { shareBreaks, shareStep, shareStepColor } from '../lib/color';
import { t } from '../lib/i18n';
import type { ElectionFile, ResultOption, ResultViewId } from '../lib/types';
import { LEVELS, type Level } from '../state';
import { NO_DATA_COLOR } from './style';

export interface LegendItem {
  label: string;
  color: string;
  /** Winners: areas won. */
  count?: number;
}

export interface Legend {
  title: string;
  kind: 'winners' | 'share';
  items: LegendItem[];
}

export interface Coloring {
  colors: Map<string, string>;
  /** Per map level; null without an election. */
  legend: Record<Level, Legend> | null;
}

export const optionLabel = (o: Pick<ResultOption, 'short_name' | 'parties'>) => o.short_name || (o.parties.length ? o.parties.join('–') : t.independent);

export async function buildColoring(
  election: ElectionFile | null,
  view: ResultViewId,
  party: string | null,
  levelOf: (unitId: string) => Level | null,
): Promise<Coloring> {
  const result = election?.views[view];
  if (!election || !result) return { colors: new Map(), legend: null };
  const options = new Map(result.options.map((o) => [o.id, o]));
  const colors = new Map<string, string>();
  const legend = {} as Record<Level, Legend>;
  const option = party ? options.get(party) : undefined;

  if (!option) {
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
    return { colors, legend };
  }

  const shares = await loadShares(election.id, view, option.id);
  const byLevel = new Map<Level, [string, number][]>(LEVELS.map((l) => [l, []]));
  for (const [unitId, share] of Object.entries(shares)) {
    const level = levelOf(unitId);
    if (level) byLevel.get(level)!.push([unitId, share]);
  }
  for (const level of LEVELS) {
    const entries = byLevel.get(level)!;
    const breaks = shareBreaks(entries.map(([, share]) => share));
    for (const [unitId, share] of entries) colors.set(unitId, shareStepColor(option.color, breaks, shareStep(breaks, share)));
    const max = Math.max(0, ...entries.map(([, share]) => share));
    const bounds = [Math.min(...entries.map(([, share]) => share), max), ...breaks, max];
    legend[level] = {
      title: t.legendShare(optionLabel(option)),
      kind: 'share',
      items: bounds.slice(1).map((upper, i) => ({
        label: t.shareRange(bounds[i], upper),
        color: shareStepColor(option.color, breaks, i),
      })),
    };
  }
  return { colors, legend };
}
