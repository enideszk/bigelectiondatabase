/**
 * Map controls: the level / election table and the party picker (in the toolbar above the map),
 * and the legend (bottom left of the map).
 *
 * The map control is one table of three rows: map level (with unit counts) · election type · the
 * years of that type. Types with no election loaded yet are shown, disabled.
 */

import { h } from '../components/dom';
import { toggle } from '../components/toggle';
import { formatDate } from '../lib/format';
import { t } from '../lib/i18n';
import type { ElectionMeta, ElectionType, ResultOption, ResultViewId } from '../lib/types';
import { optionLabel, type Legend } from './coloring';
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

/** The legend of the shown level: winners with the areas they won, or the vote-share steps. */
export function renderLegend(container: HTMLElement, legend: Legend | null): void {
  container.hidden = !legend;
  if (!legend) return;
  const items =
    legend.kind === 'winners'
      ? legend.items.map((item) =>
          h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:${item.color}` }), item.label, ' ', h('span', { class: 'legend-n' }, item.count ?? '')),
        )
      : [
          h(
            'span',
            { class: 'legend-steps' },
            ...legend.items.map((item) => h('span', { class: 'legend-step' }, h('i', { style: `background:${item.color}` }), h('small', null, item.label))),
          ),
        ];
  container.replaceChildren(
    h('span', { class: 'legend-title' }, legend.title),
    ...items,
    h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:${NO_DATA_COLOR}` }), t.noData),
  );
}

/** Party lists | Single-member districts: the result view of the map and the side panel. A view
 *  the election does not have (no single-member races) is disabled. */
export function renderViewSwitch(container: HTMLElement, view: ResultViewId, available: Record<ResultViewId, boolean>, onChange: (view: ResultViewId) => void): void {
  container.replaceChildren(
    toggle(
      t.aria.resultType,
      (['L', 'E'] as const).map((v) => ({ value: v, label: v === 'L' ? t.viewLTitle : t.viewETitle, disabled: !available[v] })),
      view,
      onChange,
    ),
  );
}

/** "Map: [Largest list in each area | <party> vote share ...]" below the search box. */
export function renderPartyPicker(
  container: HTMLElement,
  view: ResultViewId,
  options: ResultOption[],
  current: string | null,
  onChange: (party: string | null) => void,
): void {
  const select = h(
    'select',
    {
      'aria-label': t.mapShows,
      onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value || null),
    },
    h('option', { value: '', selected: current === null }, t.mapWinner[view]),
    ...options.map((o) => h('option', { value: o.id, selected: o.id === current }, t.mapShare(optionLabel(o)))),
  );
  container.replaceChildren(h('label', { class: 'ctl' }, h('span', null, t.mapShows), select));
}
