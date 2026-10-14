/** Map overlays: level switch with unit counts (top left) and the legend with win counts (bottom left). */

import { h } from '../components/dom';
import { toggle } from '../components/toggle';
import { t } from '../lib/i18n';
import type { ElectionFile } from '../lib/types';
import { LEVELS, type Level } from '../state';
import { NO_DATA_COLOR } from './style';

export function renderLevelControl(
  container: HTMLElement,
  level: Level,
  counts: Record<Level, number>,
  onChange: (level: Level) => void,
): void {
  container.replaceChildren(
    toggle(
      t.aria.mapLevel,
      LEVELS.map((l) => ({ value: l, label: t.levels[l], count: counts[l] })),
      level,
      onChange,
    ),
  );
}

/** Lists that won at least one unit of the shown level, with how many they won. */
export function renderLegend(container: HTMLElement, election: ElectionFile, levelOf: (unitId: string) => Level | null, level: Level): void {
  const wins = new Map<number, number>();
  for (const [unitId, listId] of Object.entries(election.winners)) {
    if (levelOf(unitId) === level) wins.set(listId, (wins.get(listId) ?? 0) + 1);
  }
  const items = election.lists
    .filter((l) => wins.has(l.list_id))
    .sort((a, b) => wins.get(b.list_id)! - wins.get(a.list_id)!)
    .map((l) =>
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:${l.color}` }), l.short_name, ' ', h('span', { class: 'legend-n' }, wins.get(l.list_id)!)),
    );
  container.replaceChildren(
    h('span', { class: 'legend-title' }, t.legend),
    ...items,
    h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:${NO_DATA_COLOR}` }), t.noData),
  );
}
