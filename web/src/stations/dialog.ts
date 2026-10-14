/**
 * The polling station dialog (from the side panel; ?list=stations|hierarchy), a modal over a
 * darkened page with two tabs:
 *
 *   Polling stations  the stations of the area selected in the side panel (or of all Hungary) in a
 *                     sortable table: ID (MAZ-OEVK-TAZ-SZK), settlement, electoral district,
 *                     registered, turnout, the six leading parties of the shown view and "Other"
 *                     (all parties on request), as shares or votes, and the winner; each row
 *                     tinted with the winner's color. The search matches every word anywhere
 *                     (settlement, járás, county, region, district, station ID): "Szék 49" finds
 *                     the stations matching both. An electoral district filter works on top of the
 *                     area. A click selects a station (double click: open it in the hierarchy).
 *   Hierarchy         one area at a time: polling station -> municipality -> electoral district ->
 *                     county -> region -> Hungary. Its results and turnout, and the areas below it
 *                     (a row opens one); "Go up" climbs. Starts at the selected station, else at
 *                     the side panel's area.
 */

import { h } from '../components/dom';
import { resultRows, type ResultItem } from '../components/resultRows';
import { toggle } from '../components/toggle';
import { loadElection, loadStations, loadUnit } from '../lib/api';
import { formatInt, formatShare, normalizeForSearch } from '../lib/format';
import { t } from '../lib/i18n';
import { optionVotes, withoutMail } from '../lib/results';
import type { ElectionMeta, MapLevel, Meta, ResultOption, ResultViewId, StationRow, UnitIndexEntry, UnitSummary } from '../lib/types';
import { displayName } from '../lib/units';
import { optionLabel } from '../map/coloring';
import type { Hierarchy } from '../map/hierarchy';
import { NO_DATA_COLOR } from '../map/style';
import type { ListTab } from '../state';

const LEADING = 6;
const PAGE = 300;

export interface DialogContext {
  meta: Meta;
  units: Map<string, UnitIndexEntry>;
  hierarchy: Hierarchy;
  election: ElectionMeta;
  view: ResultViewId;
  /** The area selected in the side panel (the country when none is). */
  area: string;
  /** National results with the votes cast by mail. */
  postal: boolean;
  tab: ListTab;
  onTab: (tab: ListTab) => void;
  onClose: () => void;
}

/** A station with what the table needs, computed once per election and view. */
interface Station {
  row: StationRow;
  name: string;
  districtName: string;
  search: string;
  registered: number | null;
  voted: number | null;
  turnout: number | null;
  /** Votes per option, in the order of `options`. */
  votes: number[];
  /** What the shares are of. */
  total: number;
  winner: number;
}

interface Data {
  key: string;
  options: ResultOption[];
  stations: Station[];
  /** The election file's summaries of the view: the winners of the areas in the hierarchy. */
  summaries: Record<string, UnitSummary>;
}

type Node = { kind: 'unit'; id: string } | { kind: 'station'; station: Station };
type SortKey = 'id' | 'name' | 'district' | 'registered' | 'turnout' | 'other' | 'winner' | `option:${number}`;

export class StationDialog {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private ctx: DialogContext | null = null;
  private data: Data | null = null;

  // polling stations tab
  private all = false;
  private district = '';
  private query = '';
  private sort: { key: SortKey; dir: 1 | -1 } = { key: 'id', dir: 1 };
  private expanded = false;
  private votesMode = false;
  private limit = PAGE;
  private selected: Station | null = null;
  // hierarchy tab
  private path: Node[] = [];

  constructor() {
    this.tabs = h('div', { class: 'sd-tabs' });
    this.body = h('div', { class: 'sd-body' });
    const close = h('button', { type: 'button', class: 'btn btn-ghost btn-close', title: t.stations.close, 'aria-label': t.stations.close, onclick: () => this.ctx?.onClose() }, '×');
    const dialog = h(
      'div',
      { class: 'sd-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.stations.title },
      h('header', { class: 'sd-head' }, h('h2', null, t.stations.title), this.tabs, close),
      this.body,
    );
    this.overlay = h('div', { class: 'sd-overlay', hidden: true, onclick: (e: Event) => e.target === this.overlay && this.ctx?.onClose() }, dialog);
    document.body.append(this.overlay);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Open or refresh with the page's current state. */
  show(ctx: DialogContext): void {
    const wasOpen = this.isOpen;
    const previous = this.ctx;
    this.ctx = ctx;
    if (!wasOpen || previous?.area !== ctx.area) {
      this.all = false;
      this.district = '';
      this.limit = PAGE;
    }
    if (!wasOpen) {
      this.overlay.hidden = false;
      document.body.classList.add('modal-open');
    }
    if (ctx.tab === 'hierarchy' && (!wasOpen || previous?.tab !== 'hierarchy' || previous.area !== ctx.area || previous.election.id !== ctx.election.id)) {
      this.path = [];
    }
    this.tabs.replaceChildren(
      toggle(
        t.stations.title,
        [
          { value: 'stations' as ListTab, label: t.stations.tabStations },
          { value: 'hierarchy' as ListTab, label: t.stations.tabHierarchy },
        ],
        ctx.tab,
        (tab) => ctx.onTab(tab),
      ),
    );
    void this.render();
  }

  close(): void {
    this.overlay.hidden = true;
    document.body.classList.remove('modal-open');
    this.ctx = null;
  }

  // ---- data -------------------------------------------------------------------------------

  private async load(ctx: DialogContext): Promise<Data | null> {
    const key = `${ctx.election.id}/${ctx.view}`;
    if (this.data?.key === key) return this.data;
    const [file, election] = await Promise.all([loadStations(ctx.election.id).catch(() => null), loadElection(ctx.election.id)]);
    const view = election.views[ctx.view];
    if (!file || !view) return null;
    const options = view.options;
    const position = new Map(options.map((o, i) => [o.id, i]));
    const fileOptions = (file.options[ctx.view] ?? []).map((id) => position.get(id) ?? -1);
    const date = ctx.election.date;
    const names = new Map<string, string>(); // unit -> search words of its area
    const unitName = (id: string | null) => (id && ctx.units.has(id) ? displayName(ctx.units.get(id)!) : '');
    const stations = file.stations.map((row): Station => {
      const votes = new Array<number>(options.length).fill(0);
      if (ctx.view === 'L') row.L.forEach((v, i) => fileOptions[i] >= 0 && (votes[fileOptions[i]] += v));
      else for (const [i, v] of row.E) if (fileOptions[i] >= 0) votes[fileOptions[i]] += v;
      const ballot = ctx.view === 'L' ? row.tl : row.te;
      const [registered, voted, valid] = ballot;
      const sum = votes.reduce((a, b) => a + b, 0);
      const total = ctx.view === 'L' && valid ? valid : sum;
      let winner = -1;
      votes.forEach((v, i) => v > 0 && (winner < 0 || v > votes[winner]) && (winner = i));
      if (!names.has(row.unit)) {
        names.set(row.unit, ctx.hierarchy.ancestors(row.unit, date).filter((id) => !id.startsWith('country-') && !id.startsWith('smd-')).map(unitName).join(' '));
      }
      const name = unitName(row.unit);
      const districtName = unitName(row.district);
      return {
        row,
        name,
        districtName,
        search: normalizeForSearch(`${row.id} ${row.id.replaceAll('-', ' ')} ${name} ${districtName} ${names.get(row.unit)} ${row.transfer ? t.stations.transfer : ''}`),
        registered,
        voted,
        turnout: registered && voted !== null ? voted / registered : null,
        votes,
        total,
        winner,
      };
    });
    this.data = { key, options, stations, summaries: view.summaries };
    return this.data;
  }

  private async render(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.data || this.data.key !== `${ctx.election.id}/${ctx.view}`) this.body.replaceChildren(h('p', { class: 'sd-note' }, t.stations.loading));
    const data = await this.load(ctx);
    if (ctx !== this.ctx) return; // closed or changed meanwhile
    if (!data) {
      this.body.replaceChildren(h('p', { class: 'sd-note' }, t.stations.unavailable));
      return;
    }
    if (ctx.tab === 'stations') this.renderStations(ctx, data);
    else await this.renderHierarchy(ctx, data);
  }

  // ---- polling stations tab --------------------------------------------------------------------

  /** Stations of the side panel's area (or all), then of the chosen electoral district. */
  private scoped(ctx: DialogContext, data: Data): Station[] {
    const area = ctx.units.get(ctx.area);
    let list = data.stations;
    if (!this.all && area && area.type !== 'country') {
      const date = ctx.election.date;
      list =
        area.type === 'smd'
          ? list.filter((s) => s.row.district === area.id)
          : area.type === 'settlement' || area.type === 'bp_district'
            ? list.filter((s) => s.row.unit === area.id)
            : list.filter((s) => s.row.unit === area.id || ctx.hierarchy.ancestors(s.row.unit, date).includes(area.id));
    }
    return list;
  }

  private renderStations(ctx: DialogContext, data: Data): void {
    const inArea = this.scoped(ctx, data);
    const districts = [...new Map(inArea.filter((s) => s.row.district).map((s) => [s.row.district!, s.districtName])).entries()].sort((a, b) =>
      a[1].localeCompare(b[1], 'hu', { numeric: true }),
    );
    if (this.district && !districts.some(([id]) => id === this.district)) this.district = '';
    const inDistrict = this.district ? inArea.filter((s) => s.row.district === this.district) : inArea;

    // the leading parties of what is on the list (before the search)
    const totals = data.options.map((_, i) => inDistrict.reduce((sum, s) => sum + s.votes[i], 0));
    const order = data.options.map((_, i) => i).filter((i) => totals[i] > 0).sort((a, b) => totals[b] - totals[a]);
    const shown = this.expanded ? order : order.slice(0, LEADING);
    const rest = this.expanded ? [] : order.slice(LEADING);

    const terms = normalizeForSearch(this.query).split(/\s+/).filter(Boolean);
    const matches = terms.length ? inDistrict.filter((s) => terms.every((term) => s.search.includes(term))) : inDistrict;
    const other = (s: Station) => rest.reduce((sum, i) => sum + s.votes[i], 0);
    const value = (s: Station, votes: number) => (this.votesMode ? votes : s.total ? votes / s.total : 0);
    const sortValue = (s: Station): number | string => {
      const key = this.sort.key;
      if (key === 'id') return s.row.id;
      if (key === 'name') return s.name;
      if (key === 'district') return s.districtName;
      if (key === 'registered') return s.registered ?? -1;
      if (key === 'turnout') return s.turnout ?? -1;
      if (key === 'other') return value(s, other(s));
      if (key === 'winner') return s.winner >= 0 ? optionLabel(data.options[s.winner]) : '';
      return value(s, s.votes[Number(key.slice(7))]);
    };
    const sorted = [...matches].sort((a, b) => {
      const x = sortValue(a);
      const y = sortValue(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string, 'hu', { numeric: true }) : x - (y as number);
      return c * this.sort.dir || a.row.id.localeCompare(b.row.id);
    });

    const header = (key: SortKey, label: string, cls = '', title?: string) =>
      h(
        'th',
        { class: `${cls} sortable${this.sort.key === key ? (this.sort.dir === 1 ? ' asc' : ' desc') : ''}`, title: title ?? label, 'aria-sort': this.sort.key === key ? (this.sort.dir === 1 ? 'ascending' : 'descending') : null },
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              const text = key === 'id' || key === 'name' || key === 'district' || key === 'winner';
              this.sort = this.sort.key === key ? { key, dir: this.sort.dir === 1 ? -1 : 1 } : { key, dir: text ? 1 : -1 };
              this.renderStations(ctx, data);
            },
          },
          label,
        ),
      );
    const cell = (s: Station, votes: number) =>
      h('td', { class: 'num', title: `${formatInt(votes)} · ${s.total ? formatShare(votes / s.total, 2) : '–'}` }, this.votesMode ? formatInt(votes) : s.total ? formatShare(votes / s.total, 1) : '–');
    const rows = sorted.slice(0, this.limit).map((s) => {
      const win = s.winner >= 0 ? data.options[s.winner] : null;
      return h(
        'tr',
        {
          class: s === this.selected ? 'selected' : null,
          style: `--tint:${win?.color ?? NO_DATA_COLOR}`,
          onclick: () => {
            this.selected = s;
            this.renderStations(ctx, data);
          },
          ondblclick: () => {
            this.selected = s;
            this.path = [];
            ctx.onTab('hierarchy');
          },
        },
        h('td', { class: 'mono' }, s.row.id),
        h('td', null, s.name, s.row.transfer ? h('small', null, ` (${t.stations.transfer})`) : null),
        h('td', null, s.districtName),
        h('td', { class: 'num' }, formatInt(s.registered)),
        h('td', { class: 'num' }, s.turnout === null ? '–' : formatShare(s.turnout, 1)),
        ...shown.map((i) => cell(s, s.votes[i])),
        ...(rest.length ? [cell(s, other(s))] : []),
        h('td', { class: 'winner' }, win ? h('span', { class: 'swatch', style: `background:${win.color}` }) : null, win ? optionLabel(win) : '–'),
      );
    });

    const search = h('input', {
      type: 'search',
      class: 'sd-search',
      value: this.query,
      placeholder: t.stations.search,
      'aria-label': t.stations.search,
      oninput: (e: Event) => {
        this.query = (e.target as HTMLInputElement).value;
        this.limit = PAGE;
        this.renderStations(ctx, data);
        const input = this.body.querySelector<HTMLInputElement>('.sd-search');
        input?.focus();
        input?.setSelectionRange(this.query.length, this.query.length);
      },
    });
    const area = ctx.units.get(ctx.area);
    const tools = h(
      'div',
      { class: 'sd-tools' },
      search,
      area && area.type !== 'country'
        ? h(
            'label',
            { class: 'nav-switch sd-switch' },
            h('input', {
              type: 'checkbox',
              role: 'switch',
              checked: this.all,
              onchange: (e: Event) => {
                this.all = (e.target as HTMLInputElement).checked;
                this.limit = PAGE;
                this.renderStations(ctx, data);
              },
            }),
            h('span', { class: 'nav-track', 'aria-hidden': 'true' }),
            h('span', null, t.stations.entireHungary),
          )
        : null,
      h(
        'select',
        {
          'aria-label': t.stations.columns.district,
          onchange: (e: Event) => {
            this.district = (e.target as HTMLSelectElement).value;
            this.limit = PAGE;
            this.renderStations(ctx, data);
          },
        },
        h('option', { value: '', selected: this.district === '' }, t.stations.allDistricts),
        ...districts.map(([id, name]) => h('option', { value: id, selected: id === this.district }, name)),
      ),
      toggle(t.stations.showShares, [{ value: 'share', label: t.stations.showShares }, { value: 'votes', label: t.stations.showVotes }], this.votesMode ? 'votes' : 'share', (v) => {
        this.votesMode = v === 'votes';
        this.renderStations(ctx, data);
      }, true),
      order.length > LEADING
        ? h(
            'label',
            { class: 'nav-switch sd-switch' },
            h('input', {
              type: 'checkbox',
              role: 'switch',
              checked: this.expanded,
              onchange: (e: Event) => {
                this.expanded = (e.target as HTMLInputElement).checked;
                this.renderStations(ctx, data);
              },
            }),
            h('span', { class: 'nav-track', 'aria-hidden': 'true' }),
            h('span', null, t.stations.allParties),
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          disabled: !this.selected,
          onclick: () => {
            this.path = [];
            ctx.onTab('hierarchy');
          },
        },
        t.stations.openHierarchy,
      ),
    );
    const c = t.stations.columns;
    const table = h(
      'div',
      { class: 'sd-tablewrap' },
      h(
        'table',
        { class: 'tbl sd-table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            header('id', c.id),
            header('name', c.name),
            header('district', c.district),
            header('registered', c.registered, 'num'),
            header('turnout', c.turnout, 'num'),
            ...shown.map((i) => header(`option:${i}`, optionLabel(data.options[i]), 'num', data.options[i].name || optionLabel(data.options[i]))),
            ...(rest.length ? [header('other', c.other, 'num', rest.map((i) => optionLabel(data.options[i])).join(', '))] : []),
            header('winner', c.winner),
          ),
        ),
        h('tbody', null, ...rows),
      ),
      sorted.length === 0 ? h('p', { class: 'sd-note' }, t.stations.none) : null,
      sorted.length > this.limit
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn sd-more',
              onclick: () => {
                this.limit += PAGE;
                this.renderStations(ctx, data);
              },
            },
            t.stations.more(sorted.length - this.limit),
          )
        : null,
    );
    const scroll = this.body.querySelector('.sd-tablewrap')?.scrollTop ?? 0;
    this.body.replaceChildren(tools, h('p', { class: 'sd-count' }, t.stations.count(Math.min(sorted.length, this.limit), sorted.length)), table);
    const wrap = this.body.querySelector('.sd-tablewrap');
    if (wrap) wrap.scrollTop = scroll;
  }

  // ---- hierarchy tab -----------------------------------------------------------------------

  /** Hungary -> region -> county -> electoral district -> municipality (-> station). */
  private pathTo(ctx: DialogContext, unitId: string, district?: string | null): Node[] {
    const date = ctx.election.date;
    const type = (id: string) => ctx.units.get(id)?.type;
    const ancestors = ctx.hierarchy.ancestors(unitId, date);
    const chain: string[] = [];
    const country = ancestors.find((id) => type(id) === 'country') ?? [...ctx.units.values()].find((u) => u.type === 'country')?.id;
    if (country && country !== unitId) chain.push(country);
    const own = type(unitId);
    for (const id of ancestors) if (type(id) === 'nuts2' || type(id) === 'county') chain.push(id);
    if (own === 'settlement' || own === 'bp_district') {
      const districts = ancestors.filter((id) => type(id) === 'smd');
      const smd = district && districts.includes(district) ? district : districts[0];
      if (smd) chain.push(smd);
    }
    chain.push(unitId);
    return [...new Set(chain)].map((id) => ({ kind: 'unit', id }));
  }

  private startPath(ctx: DialogContext): Node[] {
    if (this.selected) return [...this.pathTo(ctx, this.selected.row.unit, this.selected.row.district), { kind: 'station', station: this.selected }];
    return this.pathTo(ctx, ctx.area);
  }

  private async renderHierarchy(ctx: DialogContext, data: Data): Promise<void> {
    if (!this.path.length) this.path = this.startPath(ctx);
    const node = this.path.at(-1)!;
    const crumbs = h(
      'nav',
      { class: 'sd-crumbs' },
      ...this.path.flatMap((n, i) => [
        ...(i ? [h('span', { class: 'd-sep' }, ' › ')] : []),
        h(
          'button',
          {
            type: 'button',
            class: 'd-link',
            disabled: i === this.path.length - 1,
            onclick: () => {
              this.path = this.path.slice(0, i + 1);
              void this.renderHierarchy(ctx, data);
            },
          },
          this.nodeName(ctx, n),
        ),
      ]),
    );
    const up = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        disabled: this.path.length < 2,
        onclick: () => {
          this.path = this.path.slice(0, -1);
          void this.renderHierarchy(ctx, data);
        },
      },
      `↑ ${t.stations.goUp}`,
    );
    const head = h(
      'div',
      { class: 'sd-hhead' },
      up,
      h('div', null, h('div', { class: 'sd-hname' }, this.nodeName(ctx, node)), h('div', { class: 'sd-hkind' }, this.nodeKind(ctx, node))),
    );
    this.body.replaceChildren(h('div', { class: 'sd-hier' }, crumbs, head, h('p', { class: 'sd-note' }, t.loading)));

    const { items, turnout } = await this.nodeResults(ctx, data, node);
    const below = this.children(ctx, data, node);
    if (ctx !== this.ctx || this.path.at(-1) !== node) return; // moved on meanwhile
    const [registered, voted, valid, invalid] = turnout;
    const body: HTMLElement[] = [crumbs, head];
    if (registered !== null && voted !== null) {
      body.push(
        h('p', { class: 'sd-turnout' }, t.stations.turnoutLine(formatInt(registered), formatInt(voted), registered ? formatShare(voted / registered, 2) : '–', formatInt(valid), formatInt(invalid))),
      );
    }
    body.push(items.length ? resultRows(items, { key: `H:${node.kind === 'unit' ? node.id : node.station.row.id}` }) : h('p', { class: 'sd-note' }, t.stations.noResults));
    if (below.length) {
      body.push(
        h('h4', { class: 'd-h' }, t.stations.below),
        h(
          'div',
          { class: 'sd-tablewrap' },
          h(
            'table',
            { class: 'tbl sd-table sd-children' },
            h('tbody', null, ...below.map((child) => {
              const win = child.winner;
              return h(
                'tr',
                {
                  style: `--tint:${win?.color ?? NO_DATA_COLOR}`,
                  onclick: () => {
                    this.path = [...this.path, child.node];
                    void this.renderHierarchy(ctx, data);
                  },
                },
                h('td', null, child.name),
                h('td', { class: 'winner' }, win ? h('span', { class: 'swatch', style: `background:${win.color}` }) : null, win ? win.label : '–'),
                h('td', { class: 'num' }, child.share === null ? '–' : formatShare(child.share, 1)),
                h('td', { class: 'num' }, child.turnout === null ? '–' : `${t.turnout} ${formatShare(child.turnout, 1)}`),
              );
            })),
          ),
        ),
      );
    }
    this.body.replaceChildren(h('div', { class: 'sd-hier' }, ...body));
  }

  private nodeName(ctx: DialogContext, node: Node): string {
    if (node.kind === 'station') return t.stations.station(node.station.row.id);
    const unit = ctx.units.get(node.id);
    return unit ? displayName(unit) : node.id;
  }

  private nodeKind(ctx: DialogContext, node: Node): string {
    if (node.kind === 'station') return `${t.stations.stationKind} · ${node.station.name}${node.station.row.transfer ? ` (${t.stations.transfer})` : ''}`;
    const unit = ctx.units.get(node.id);
    return ctx.meta.unit_types.find((u) => u.type === unit?.type)?.name ?? '';
  }

  /** The node's results as rows, and its turnout [registered, voted, valid, invalid]. */
  private async nodeResults(ctx: DialogContext, data: Data, node: Node): Promise<{ items: ResultItem[]; turnout: (number | null)[] }> {
    if (node.kind === 'station') {
      const s = node.station;
      const items = data.options
        .map((o, i) => ({ o, v: s.votes[i] }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .map(({ o, v }): ResultItem => ({ label: o.name || optionLabel(o), color: o.color, share: s.total ? v / s.total : 0, count: v }));
      return { items, turnout: ctx.view === 'L' ? s.row.tl : s.row.te };
    }
    const unit = await loadUnit(node.id).catch(() => null);
    let results = unit?.elections[ctx.election.id];
    if (!results) return { items: [], turnout: [null, null, null, null] };
    if (!ctx.postal && results.mail) results = withoutMail(results);
    const { rows, total } = optionVotes(results, ctx.view);
    const names = new Map(data.options.map((o) => [o.id, o]));
    const items = rows.map((r): ResultItem => {
      const option = names.get(r.option);
      return { label: (option && (option.name || optionLabel(option))) || r.name || t.independent, color: r.color, share: total ? r.votes / total : 0, count: r.votes };
    });
    const ballot = ctx.view === 'L' ? 'list' : 'candidate';
    const row = results.turnout.filter((x) => x.ballot === ballot).sort((a, b) => (ctx.view === 'L' ? a.round - b.round : b.round - a.round))[0];
    return { items, turnout: row ? [row.registered, row.voted, row.valid, row.invalid] : [null, null, null, null] };
  }

  /** The areas (or stations) one level below a node, with their winners. */
  private children(ctx: DialogContext, data: Data, node: Node): { node: Node; name: string; winner: { label: string; color: string } | null; share: number | null; turnout: number | null }[] {
    if (node.kind === 'station') return [];
    const unit = ctx.units.get(node.id);
    if (!unit) return [];
    if (unit.type === 'settlement' || unit.type === 'bp_district') {
      const district = this.path.map((n) => (n.kind === 'unit' && ctx.units.get(n.id)?.type === 'smd' ? n.id : null)).find(Boolean);
      return data.stations
        .filter((s) => s.row.unit === unit.id && (!district || s.row.district === district))
        .map((s) => {
          const win = s.winner >= 0 ? data.options[s.winner] : null;
          return {
            node: { kind: 'station' as const, station: s },
            name: t.stations.station(s.row.id),
            winner: win ? { label: optionLabel(win), color: win.color } : null,
            share: win && s.total ? s.votes[s.winner] / s.total : null,
            turnout: s.turnout,
          };
        });
    }
    const date = ctx.election.date;
    const next: Partial<Record<string, MapLevel>> = { country: 'nuts2', nuts1: 'nuts2', nuts2: 'county', county: 'smd', smd: 'settlement', jaras: 'settlement' };
    const level = next[unit.type];
    if (!level) return [];
    const ids =
      unit.type === 'country'
        ? [...ctx.units.values()].filter((u) => u.type === 'nuts2' && (u.valid_from === null || u.valid_from <= date) && (u.valid_to === null || date < u.valid_to)).map((u) => u.id)
        : [...(ctx.hierarchy.members(unit.id, level, date) ?? [])];
    const options = new Map(data.options.map((o) => [o.id, o]));
    return ids
      .map((id) => {
        const summary = data.summaries[id];
        const top = summary?.top[0];
        const option = top ? options.get(top[0]) : undefined;
        return {
          node: { kind: 'unit' as const, id },
          name: displayName(ctx.units.get(id)!),
          winner: option ? { label: optionLabel(option), color: option.color } : null,
          share: top ? top[1] : null,
          turnout: summary?.turnout ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'hu', { numeric: true }));
  }
}
