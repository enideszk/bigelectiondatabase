/** Panel head (name, the next larger area, close) and the unit's identity: kind, parents, districts, lineage. */

import { h } from '../components/dom';
import { formatDate } from '../lib/format';
import { t } from '../lib/i18n';
import type { UnitType } from '../lib/types';
import { displayName, parentsOn, referenceDate } from '../lib/units';
import type { SidebarContext } from './context';

export function unitLink(ctx: SidebarContext, id: string, label: string): HTMLElement {
  return h('button', { type: 'button', class: 'd-link', onclick: () => ctx.select(id) }, label);
}

/** Links separated by a dot: "West Fakeland · Alfa · Próbavárosi járás". */
function linkList(ctx: SidebarContext, items: { id: string; name: string }[]): (Node | string)[] {
  return items.flatMap((item, i) => [...(i > 0 ? [h('span', { class: 'd-sep' }, ' · ')] : []), unitLink(ctx, item.id, item.name)]);
}

/** The next larger area a unit is named with under its name: Debrecen -> Hajdú-Bihar, Fejér 01 -> Fejér. */
const REGION_TYPE: Partial<Record<UnitType, UnitType>> = {
  settlement: 'county',
  bp_district: 'county',
  jaras: 'county',
  smd: 'county',
  county: 'nuts2',
  nuts2: 'nuts1',
  nuts1: 'country',
};

function regionOf(ctx: SidebarContext): { id: string; name: string } | null {
  const { unit } = ctx;
  const want = REGION_TYPE[unit.type];
  if (!want) return null;
  const parent = parentsOn(unit.parents, referenceDate(unit, ctx.date)).find((p) => p.type === want);
  if (parent) return { id: parent.id, name: displayName(parent) };
  // Electoral districts carry their county in the code: "2024-09-01" = set, county, number.
  const county = unit.type === 'smd' ? ctx.units.get(`county-${unit.code.split('-')[1]}`) : undefined;
  return county ? { id: county.id, name: displayName(county) } : null;
}

export function renderSideHead(ctx: SidebarContext): HTMLElement {
  const region = regionOf(ctx);
  return h(
    'header',
    { class: 'side-head' },
    h('div', { class: 'side-title' }, h('h2', null, displayName(ctx.unit)), region ? h('div', { class: 'side-region' }, unitLink(ctx, region.id, region.name)) : null),
    ctx.isDefault ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-close', title: t.close, 'aria-label': t.close, onclick: () => ctx.update({ unit: null }) }, '×'),
  );
}

export function renderIdentity(ctx: SidebarContext): HTMLElement[] {
  const { unit } = ctx;
  const typeName = ctx.meta.unit_types.find((u) => u.type === unit.type)?.name ?? unit.type;

  // Parents as of the election date (or the nearest day the unit existed). The country is implied.
  const parents = parentsOn(unit.parents, referenceDate(unit, ctx.date))
    .filter((p) => p.type !== 'country')
    .map((p) => ({ id: p.id, name: displayName(p) }));
  const districts = ctx.results?.districts ?? [];
  const altNames = [
    unit.name_en && unit.name_en !== unit.name ? unit.name : null,
    ...unit.former_names.map((n) => `${t.formerly}: ${n.name}${n.valid_to ? ` (until ${formatDate(n.valid_to)})` : ''}`),
  ].filter((x): x is string => x !== null);

  const out: HTMLElement[] = [h('div', { class: 'd-head' }, h('span', { class: 'd-kind' }, `${typeName} · ${unit.code}`))];
  if (altNames.length) out.push(h('div', { class: 'd-altname' }, altNames.join(' · ')));
  if (parents.length) out.push(h('div', { class: 'd-parent' }, `${t.inPrefix} `, ...linkList(ctx, parents)));
  if (districts.length && unit.type !== 'smd') out.push(h('div', { class: 'd-parent' }, `${t.electoralDistricts}: `, ...linkList(ctx, districts)));
  for (const event of unit.lineage) {
    const [before, after] = t.lineage(event.type, event.direction, formatDate(event.date));
    out.push(h('p', { class: 'd-note' }, before, unitLink(ctx, event.other_id, event.other_name), after));
  }
  return out;
}
