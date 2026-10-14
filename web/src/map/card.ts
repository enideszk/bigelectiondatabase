/**
 * Content of the map's hover card, after the Israel dashboard's: the unit's name, its kind (and
 * county), the four leading options of the shown view (lists, or single-member candidates by party)
 * with their shares drawn as bars behind the rows, so a sweep across the map compares lengths
 * rather than reading numbers, and the turnout.
 */

import { h } from '../components/dom';
import { formatShare } from '../lib/format';
import { t } from '../lib/i18n';
import type { ElectionFile, Meta, ResultViewId, UnitIndexEntry, UnitType } from '../lib/types';
import { displayName } from '../lib/units';
import { optionLabel } from './coloring';
import { NO_DATA_COLOR } from './style';

/** Unit types whose county is named under the name. */
const WITH_COUNTY: UnitType[] = ['settlement', 'jaras', 'smd'];

export function cardContent(
  unit: UnitIndexEntry,
  units: Map<string, UnitIndexEntry>,
  meta: Meta,
  election: ElectionFile | null,
  view: ResultViewId,
  /** What a step map shows for this unit, e.g. "Population: 202,331 persons (2026)". */
  mapped?: string,
): Node[] {
  const kind = meta.unit_types.find((u) => u.type === unit.type)?.name ?? unit.type;
  const county = WITH_COUNTY.includes(unit.type) ? unit.parents.map((id) => units.get(id)).find((p) => p?.type === 'county') : undefined;
  const nodes: Node[] = [
    h('div', { class: 'mc-name' }, displayName(unit)),
    h('div', { class: 'mc-sub' }, county ? `${kind} · ${displayName(county)}` : kind),
  ];
  if (mapped) nodes.push(h('div', { class: 'mc-mapped' }, mapped));
  const result = election?.views[view];
  if (!result) return nodes;

  const summary = result.summaries[unit.id];
  if (!summary || summary.top.length === 0) {
    nodes.push(h('div', { class: 'mc-note' }, t.noResults));
    return nodes;
  }
  const options = new Map(result.options.map((o) => [o.id, o]));
  const rows = summary.top.map(([optionId, share]) => {
    const option = options.get(optionId);
    const bar = `width:${Math.min(100, share * 100).toFixed(1)}%;background:${option?.color ?? NO_DATA_COLOR}`;
    return h(
      'div',
      { class: 'mc-row' },
      h('span', { class: 'mc-bar' }, h('i', { style: bar })),
      h('span', { class: 'mc-lbl' }, option ? optionLabel(option) : '?'),
      h('span', { class: 'mc-pct' }, formatShare(share)),
    );
  });
  nodes.push(h('div', { class: 'mc-rows' }, ...rows));
  if (summary.turnout !== null) nodes.push(h('div', { class: 'mc-note' }, `${t.turnout} ${formatShare(summary.turnout)}`));
  return nodes;
}
