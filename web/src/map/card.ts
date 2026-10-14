/**
 * Content of the map's hover card, after the Israel dashboard's: the unit's name, its kind (and
 * county), the four leading party lists with their shares drawn as bars behind the rows, so a sweep
 * across the map compares lengths rather than reading numbers, and the turnout.
 */

import { h } from '../components/dom';
import { formatShare } from '../lib/format';
import { t } from '../lib/i18n';
import type { ElectionFile, Meta, UnitIndexEntry, UnitType } from '../lib/types';
import { displayName } from '../lib/units';
import { NO_DATA_COLOR } from './style';

/** Unit types whose county is named under the name. */
const WITH_COUNTY: UnitType[] = ['settlement', 'jaras', 'smd'];

export function cardContent(unit: UnitIndexEntry, units: Map<string, UnitIndexEntry>, meta: Meta, election: ElectionFile | null): Node[] {
  const kind = meta.unit_types.find((u) => u.type === unit.type)?.name ?? unit.type;
  const county = WITH_COUNTY.includes(unit.type) ? unit.parents.map((id) => units.get(id)).find((p) => p?.type === 'county') : undefined;
  const nodes: Node[] = [
    h('div', { class: 'mc-name' }, displayName(unit)),
    h('div', { class: 'mc-sub' }, county ? `${kind} · ${displayName(county)}` : kind),
  ];
  if (!election) return nodes;

  const summary = election.summaries[unit.id];
  if (!summary || summary.top.length === 0) {
    nodes.push(h('div', { class: 'mc-note' }, t.noResults));
    return nodes;
  }
  const lists = new Map(election.lists.map((l) => [l.list_id, l]));
  const rows = summary.top.map(([listId, share]) => {
    const list = lists.get(listId);
    const bar = `width:${Math.min(100, share * 100).toFixed(1)}%;background:${list?.color ?? NO_DATA_COLOR}`;
    return h(
      'div',
      { class: 'mc-row' },
      h('span', { class: 'mc-bar' }, h('i', { style: bar })),
      h('span', { class: 'mc-lbl' }, list?.short_name ?? '?'),
      h('span', { class: 'mc-pct' }, formatShare(share)),
    );
  });
  nodes.push(h('div', { class: 'mc-rows' }, ...rows));
  if (summary.turnout !== null) nodes.push(h('div', { class: 'mc-note' }, `${t.turnout} ${formatShare(summary.turnout)}`));
  return nodes;
}
