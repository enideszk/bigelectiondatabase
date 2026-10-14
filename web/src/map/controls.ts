/**
 * Map overlays: the map control (top left) and the legend with win counts (bottom left).
 *
 * The map control is one table of three rows: map level (with unit counts) · election type · the
 * years of that type. Types with no election loaded yet are shown, disabled.
 */

import { h } from '../components/dom';
import { toggle } from '../components/toggle';
import { formatDate } from '../lib/format';
import { t } from '../lib/i18n';
import type { ElectionFile, ElectionMeta, ElectionType } from '../lib/types';
import { LEVELS, type Level } from '../state';
import { NO_DATA_COLOR } from './style';

const ELECTION_TYPES = Object.keys(t.electionTypes) as ElectionType[];

export interface MapControlOptions {
  level: Level;
  /** Units per level on the shown date. */
  counts: Record<Level, number>;
  /** Every loaded election, oldest first (meta.elections). */
  elections: ElectionMeta[];
  current: ElectionMeta | undefined;
  onLevel: (level: Level) => void;
  onElection: (election: ElectionMeta) => void;
}

export function renderMapControl(container: HTMLElement, o: MapControlOptions): void {
  const rows = [toggle(t.aria.mapLevel, LEVELS.map((l) => ({ value: l, label: t.levels[l], count: o.counts[l] })), o.level, o.onLevel)];
  if (o.current) {
    const ofType = (type: ElectionType) => o.elections.filter((e) => e.type === type);
    rows.push(
      toggle(
        t.aria.electionType,
        ELECTION_TYPES.map((type) => {
          const loaded = ofType(type).length > 0;
          return { value: type, label: t.electionTypes[type], disabled: !loaded, title: loaded ? undefined : t.notLoaded };
        }),
        o.current.type,
        (type) => {
          const latest = ofType(type).at(-1);
          if (latest) o.onElection(latest);
        },
      ),
      toggle(
        t.aria.electionYear,
        ofType(o.current.type).map((e) => ({ value: e.id, label: String(e.year), title: `${e.type_name}, ${formatDate(e.date)}` })),
        o.current.id,
        (id) => {
          const election = o.elections.find((e) => e.id === id);
          if (election) o.onElection(election);
        },
      ),
    );
  }
  container.replaceChildren(...rows);
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
