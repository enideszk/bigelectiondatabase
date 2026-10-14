/** Panel head (name + close) and the unit's identity: kind, status, parents, districts, lineage. */

import { h } from '../components/dom';
import { formatDate } from '../lib/format';
import { t } from '../lib/i18n';
import { displayName, parentsOn, referenceDate, validOn } from '../lib/units';
import type { SidebarContext } from './context';

export function unitLink(ctx: SidebarContext, id: string, label: string): HTMLElement {
  return h('button', { type: 'button', class: 'd-link', onclick: () => ctx.select(id) }, label);
}

/** Links separated by a dot: "West Fakeland · Alfa · Próbavárosi járás". */
function linkList(ctx: SidebarContext, items: { id: string; name: string }[]): (Node | string)[] {
  return items.flatMap((item, i) => [...(i > 0 ? [h('span', { class: 'd-sep' }, ' · ')] : []), unitLink(ctx, item.id, item.name)]);
}

export function renderSideHead(ctx: SidebarContext): HTMLElement {
  return h(
    'header',
    { class: 'side-head' },
    h('h3', null, displayName(ctx.unit)),
    h('button', { type: 'button', class: 'btn btn-ghost btn-close', title: t.close, 'aria-label': t.close, onclick: () => ctx.update({ unit: null }) }, '×'),
  );
}

export function renderIdentity(ctx: SidebarContext): HTMLElement[] {
  const { unit, election } = ctx;
  const typeName = ctx.meta.unit_types.find((u) => u.type === unit.type)?.name ?? unit.type;
  const exists = validOn(unit, election.date);
  const pill = !exists
    ? h('span', { class: 'state-pill hist' }, t.pill.notExisting)
    : ctx.results
      ? h('span', { class: 'state-pill done' }, t.pill.final)
      : h('span', { class: 'state-pill none' }, t.pill.noData);

  // Parents as of the election date (or the nearest day the unit existed). The country is implied.
  const parents = parentsOn(unit.parents, referenceDate(unit, election.date))
    .filter((p) => p.type !== 'country')
    .map((p) => ({ id: p.id, name: displayName(p) }));
  const districts = ctx.results?.districts ?? [];
  const altNames = [
    unit.name_en && unit.name_en !== unit.name ? unit.name : null,
    ...unit.former_names.map((n) => `${t.formerly}: ${n.name}${n.valid_to ? ` (until ${formatDate(n.valid_to)})` : ''}`),
  ].filter((x): x is string => x !== null);

  const out: HTMLElement[] = [
    h('div', { class: 'd-head' }, h('span', { class: 'd-kind' }, `${typeName} · ${unit.code}`), pill),
  ];
  if (altNames.length) out.push(h('div', { class: 'd-altname' }, altNames.join(' · ')));
  if (parents.length) out.push(h('div', { class: 'd-parent' }, `${t.inPrefix} `, ...linkList(ctx, parents)));
  if (districts.length) out.push(h('div', { class: 'd-parent' }, `${t.electoralDistricts}: `, ...linkList(ctx, districts)));
  for (const event of unit.lineage) {
    const [before, after] = t.lineage(event.type, event.direction, formatDate(event.date));
    out.push(h('p', { class: 'd-note' }, before, unitLink(ctx, event.other_id, event.other_name), after));
  }
  return out;
}
