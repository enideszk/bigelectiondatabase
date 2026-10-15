/**
 * The polling station dialog (from the side panel; `?list=`): one table over a darkened page, which
 * shows the results at any level of the hierarchy the owner picked —
 *
 *     Hungary -> region -> county -> electoral district (OEVK) -> settlement -> polling station
 *
 * "Go up" does not open another view: it aggregates the same table one level up (the stations
 * themselves are the source of every aggregate, so mail votes are not in them), widening the area
 * when the level reaches it; clicking an area row opens it (one level down); the breadcrumb climbs
 * back. Polling station rows are the leaves: clicking one opens its results and participation in a
 * column beside the table (as the side panel sits beside the map), clicking it again closes it. The
 * open station is kept by its ID, so it stays open when the Party lists / Single-member switch
 * reloads the data, and shows that view's results.
 *
 * The columns: the area's name and the areas above it (station ID, settlement, electoral district…),
 * registered and turnout, the six leading parties of the shown view and "Other" (all parties on
 * request) as shares or votes with the largest in bold, and the winner. The header has two rows,
 * the second one sticking exactly under the first (the categories: geographical data | electoral
 * register data | party votes | result, separated by a brighter rule). Rows are tinted with the
 * winner's color, the search matches every word anywhere in a row's names, and the electoral
 * district filter works on top of the area.
 */

import { h } from '../components/dom';
import { resultRows, type ResultItem } from '../components/resultRows';
import { toggle } from '../components/toggle';
import { loadElection, loadStations } from '../lib/api';
import { formatInt, formatShare, normalizeForSearch } from '../lib/format';
import { t } from '../lib/i18n';
import type { ElectionMeta, ResultOption, ResultViewId, StationRow, UnitIndexEntry, UnitType } from '../lib/types';
import { displayName } from '../lib/units';
import { optionLabel } from '../map/coloring';
import type { Hierarchy } from '../map/hierarchy';
import { NO_DATA_COLOR } from '../map/style';
import { turnoutBlock } from '../sidebar/turnout';

const LEADING = 6;
const PAGE = 300;

/** Column widths (px); every party column gets `PARTY_W`, so they are all the same. */
const W = { id: 140, name: 160, district: 150, county: 140, region: 160, registered: 92, turnout: 82, winner: 150 };
const PARTY_W = 76;

/** The levels the table can show, widest first. */
type Level = 'country' | 'nuts2' | 'county' | 'smd' | 'settlement' | 'station';
const CHAIN: Level[] = ['country', 'nuts2', 'county', 'smd', 'settlement', 'station'];
/** The unit type an area of each rank has (the rank is the index in CHAIN). */
const TYPE_AT: Record<number, UnitType> = { 0: 'country', 1: 'nuts2', 2: 'county', 3: 'smd' };

/**
 * Where a unit type sits on the chain. The járások and the large regions have no level of their
 * own (the owner's choice for map navigation); as an area they behave like the level above them.
 */
function unitRank(type: UnitType | undefined): number {
  switch (type) {
    case 'country':
    case 'nuts1':
      return 0;
    case 'nuts2':
      return 1;
    case 'county':
    case 'jaras':
      return 2;
    case 'smd':
      return 3;
    case 'settlement':
    case 'bp_district':
      return 4;
    default:
      return 5;
  }
}

export interface DialogContext {
  units: Map<string, UnitIndexEntry>;
  hierarchy: Hierarchy;
  election: ElectionMeta;
  view: ResultViewId;
  /** The area selected in the side panel (the country when none is); where the table starts. */
  area: string;
  onView: (view: ResultViewId) => void;
  onClose: () => void;
}

/** A station with what the table needs, computed once per election and view. */
interface Station {
  row: StationRow;
  name: string;
  districtName: string;
  search: string;
  /** Its county, region and country: the keys it is aggregated under. */
  county: string | null;
  region: string | null;
  country: string | null;
  registered: number | null;
  voted: number | null;
  turnout: number | null;
  /** Votes per option, in the order of `options`. */
  votes: number[];
  /** What the shares are of. */
  total: number;
  winner: number;
}

/** One line of the table: a polling station, or an area with its stations added up. */
interface Row {
  id: string;
  /** Set on polling station rows only (the leaves). */
  station: Station | null;
  /** The row's own name, then the areas above it (as many as the level has). */
  name: string;
  parent: string;
  grand: string;
  transfer: boolean;
  registered: number | null;
  voted: number | null;
  turnout: number | null;
  votes: number[];
  total: number;
  winner: number;
  search: string;
}

interface Data {
  key: string;
  options: ResultOption[];
  stations: Station[];
  /** Which result views the election has at all. */
  available: Record<ResultViewId, boolean>;
}

type SortKey = 'name' | 'parent' | 'grand' | 'registered' | 'turnout' | 'other' | 'winner' | `option:${number}`;

interface GeoColumn {
  key: SortKey;
  label: string;
  width: number;
  cls: string;
}

export class StationDialog {
  private readonly overlay: HTMLElement;
  private readonly body: HTMLElement;
  private ctx: DialogContext | null = null;
  private data: Data | null = null;

  /** The area the table is inside, and what its rows are. */
  private scope = '';
  private level: Level = 'station';
  private district = '';
  private query = '';
  private sort: { key: SortKey; dir: 1 | -1 } = { key: 'name', dir: 1 };
  private expanded = false;
  private votesMode = false;
  private limit: number = PAGE;
  /** The polling station whose results are open beside the table (by ID: it survives a reload
   *  of the data for the other result view). */
  private openId: string | null = null;

  /** The last pointer press landed on the backdrop itself (not inside the dialog). */
  private pressedBackdrop = false;

  constructor() {
    this.body = h('div', { class: 'sd-body' });
    const close = h('button', { type: 'button', class: 'btn btn-ghost btn-close', title: t.stations.close, 'aria-label': t.stations.close, onclick: () => this.ctx?.onClose() }, '×');
    const dialog = h(
      'div',
      { class: 'sd-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.stations.title },
      h('header', { class: 'sd-head' }, h('h2', null, t.stations.title), close),
      this.body,
    );
    // A click counts as "beside the dialog" only if the press landed there too: selecting text in
    // the search box and releasing the button outside it must not close the dialog.
    this.overlay = h(
      'div',
      {
        class: 'sd-overlay',
        hidden: true,
        onpointerdown: (e: Event) => {
          this.pressedBackdrop = e.target === this.overlay;
        },
        onclick: (e: Event) => {
          if (e.target === this.overlay && this.pressedBackdrop) this.ctx?.onClose();
        },
      },
      dialog,
    );
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
      this.scope = ctx.area;
      this.level = 'station';
      this.district = '';
      this.limit = PAGE;
      this.openId = null;
    }
    if (!wasOpen) {
      this.overlay.hidden = false;
      document.body.classList.add('modal-open');
    }
    void this.render();
  }

  close(): void {
    this.overlay.hidden = true;
    document.body.classList.remove('modal-open');
    this.ctx = null;
    this.query = '';
    this.limit = PAGE;
    this.openId = null;
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
    const unitName = (id: string | null) => (id && ctx.units.has(id) ? displayName(ctx.units.get(id)!) : '');
    /** Per settlement: its county, region and country, and the words of all of them. */
    const above = new Map<string, { county: string | null; region: string | null; country: string | null; words: string }>();
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
      if (!above.has(row.unit)) {
        // The county and the region only: the járás would make a settlement match the name of the
        // town its járás is named after (searching "Székesfehér" found Polgárdi and Nádasdladány).
        const ancestors = ctx.hierarchy.ancestors(row.unit, date);
        const ofType = (type: UnitType) => ancestors.find((id) => ctx.units.get(id)?.type === type) ?? null;
        const county = ofType('county');
        const region = ofType('nuts2');
        const country = ofType('country') ?? [...ctx.units.values()].find((u) => u.type === 'country')?.id ?? null;
        above.set(row.unit, { county, region, country, words: `${unitName(county)} ${unitName(region)}` });
      }
      const up = above.get(row.unit)!;
      const name = unitName(row.unit);
      const districtName = unitName(row.district);
      return {
        row,
        name,
        districtName,
        search: normalizeForSearch(`${row.id} ${row.id.replaceAll('-', ' ')} ${name} ${districtName} ${up.words} ${row.transfer ? t.stations.transfer : ''}`),
        county: up.county,
        region: up.region,
        country: up.country,
        registered,
        voted,
        turnout: registered && voted !== null ? voted / registered : null,
        votes,
        total,
        winner,
      };
    });
    this.data = { key, options, stations, available: { L: !!election.views.L, E: !!election.views.E } };
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
    this.draw(ctx, data);
  }

  // ---- the hierarchy the table walks ----------------------------------------------------------

  private countryId(ctx: DialogContext): string {
    return [...ctx.units.values()].find((u) => u.type === 'country')?.id ?? ctx.area;
  }

  /** The area of `rank` that contains `unitId` (or the nearest one above it). */
  private areaAtRank(ctx: DialogContext, unitId: string, rank: number): string {
    const ancestors = ctx.hierarchy.ancestors(unitId, ctx.election.date);
    for (let r = rank; r > 0; r--) {
      const found = ancestors.find((id) => ctx.units.get(id)?.type === TYPE_AT[r]);
      if (found) return found;
    }
    return this.countryId(ctx);
  }

  /** The areas from Hungary down to the scope, for the breadcrumb: one per level of the chain. */
  private crumbIds(ctx: DialogContext): string[] {
    const ancestors = ctx.hierarchy.ancestors(this.scope, ctx.election.date);
    const ids = [this.countryId(ctx)];
    for (let r = 1; r < unitRank(ctx.units.get(this.scope)?.type); r++) {
      // the first one only: a city split between two electoral districts lies in both
      const found = ancestors.find((id) => ctx.units.get(id)?.type === TYPE_AT[r]);
      if (found) ids.push(found);
    }
    ids.push(this.scope);
    return [...new Set(ids)].filter((id) => ctx.units.has(id));
  }

  /** One level up: the same table aggregated, in a wider area when the level reaches this one. */
  private goUp(ctx: DialogContext): void {
    const rank = CHAIN.indexOf(this.level);
    if (rank <= 0) return;
    const next = CHAIN[rank - 1];
    const want = rank - 2; // the area holding `next` rows sits one rank above them
    if (want < 0) this.scope = this.countryId(ctx);
    else if (unitRank(ctx.units.get(this.scope)?.type) > want) this.scope = this.areaAtRank(ctx, this.scope, want);
    this.level = next;
    this.afterMove();
  }

  /** One level down, in the same area: every one of its units at that level. */
  private goDown(): void {
    const rank = CHAIN.indexOf(this.level);
    if (rank >= CHAIN.length - 1) return;
    this.level = CHAIN[rank + 1];
    this.afterMove();
  }

  /** All the way back: the polling stations of the whole country. */
  private goBack(ctx: DialogContext): void {
    this.scope = this.countryId(ctx);
    this.level = 'station';
    this.afterMove();
  }

  /** Open an area row: its own units one level down. */
  private open(unitId: string): void {
    const rank = CHAIN.indexOf(this.level);
    if (rank >= CHAIN.length - 1) return;
    this.scope = unitId;
    this.level = CHAIN[rank + 1];
    this.afterMove();
  }

  /** A breadcrumb jump: the same level in a wider area, or that area's own units. */
  private jump(ctx: DialogContext, unitId: string): void {
    this.scope = unitId;
    const rank = unitRank(ctx.units.get(unitId)?.type);
    if (CHAIN.indexOf(this.level) <= rank) this.level = CHAIN[Math.min(rank + 1, CHAIN.length - 1)];
    this.afterMove();
  }

  private afterMove(): void {
    this.district = '';
    this.limit = PAGE;
    this.openId = null;
  }

  // ---- rows -----------------------------------------------------------------------------------

  /** The stations inside the scope area (every aggregate is built from these). */
  private inScope(ctx: DialogContext, data: Data): Station[] {
    const area = ctx.units.get(this.scope);
    if (!area || area.type === 'country') return data.stations;
    const date = ctx.election.date;
    if (area.type === 'smd') return data.stations.filter((s) => s.row.district === area.id);
    if (area.type === 'settlement' || area.type === 'bp_district') return data.stations.filter((s) => s.row.unit === area.id);
    return data.stations.filter((s) => s.row.unit === area.id || ctx.hierarchy.ancestors(s.row.unit, date).includes(area.id));
  }

  /** What a station is aggregated under at `level`, and the areas shown beside it. */
  private keysOf(s: Station, level: Level): { key: string | null; parent: string | null; grand: string | null } {
    switch (level) {
      case 'settlement':
        return { key: s.row.unit, parent: s.row.district, grand: s.county };
      case 'smd':
        return { key: s.row.district, parent: s.county, grand: s.region };
      case 'county':
        return { key: s.county, parent: s.region, grand: null };
      case 'nuts2':
        return { key: s.region, parent: null, grand: null };
      default:
        return { key: s.country, parent: null, grand: null };
    }
  }

  private buildRows(ctx: DialogContext, data: Data, stations: Station[]): Row[] {
    if (this.level === 'station') {
      return stations.map((s) => ({
        id: s.row.id,
        station: s,
        name: s.row.id,
        parent: s.name,
        grand: s.districtName,
        transfer: !!s.row.transfer,
        registered: s.registered,
        voted: s.voted,
        turnout: s.turnout,
        votes: s.votes,
        total: s.total,
        winner: s.winner,
        search: s.search,
      }));
    }
    const level = this.level;
    interface Group {
      parents: Set<string>;
      grands: Set<string>;
      registered: number | null;
      voted: number | null;
      votes: number[];
      total: number;
    }
    const groups = new Map<string, Group>();
    for (const s of stations) {
      const { key, parent, grand } = this.keysOf(s, level);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) {
        g = { parents: new Set(), grands: new Set(), registered: null, voted: null, votes: new Array<number>(data.options.length).fill(0), total: 0 };
        groups.set(key, g);
      }
      if (parent) g.parents.add(parent);
      if (grand) g.grands.add(grand);
      if (s.registered !== null) g.registered = (g.registered ?? 0) + s.registered;
      if (s.voted !== null) g.voted = (g.voted ?? 0) + s.voted;
      for (let i = 0; i < g.votes.length; i++) g.votes[i] += s.votes[i];
      g.total += s.total;
    }
    const nameOf = (id: string) => (ctx.units.has(id) ? displayName(ctx.units.get(id)!) : id);
    const joinNames = (ids: Set<string>) =>
      [...ids]
        .map(nameOf)
        .sort((a, b) => a.localeCompare(b, 'hu', { numeric: true }))
        .join(', ');
    return [...groups.entries()].map(([id, g]): Row => {
      let winner = -1;
      g.votes.forEach((v, i) => v > 0 && (winner < 0 || v > g.votes[winner]) && (winner = i));
      const name = nameOf(id);
      const parent = joinNames(g.parents);
      const grand = joinNames(g.grands);
      return {
        id,
        station: null,
        name,
        parent,
        grand,
        transfer: false,
        registered: g.registered,
        voted: g.voted,
        turnout: g.registered && g.voted !== null ? g.voted / g.registered : null,
        votes: g.votes,
        total: g.total,
        winner,
        search: normalizeForSearch(`${name} ${parent} ${grand}`),
      };
    });
  }

  /** The geographical columns of the shown level: the row's own name, then the areas above it. */
  private geoColumns(): GeoColumn[] {
    const c = t.stations.columns;
    switch (this.level) {
      case 'station':
        return [
          { key: 'name', label: c.id, width: W.id, cls: 'mono' },
          { key: 'parent', label: c.name, width: W.name, cls: '' },
          { key: 'grand', label: c.district, width: W.district, cls: 'caps' },
        ];
      case 'settlement':
        return [
          { key: 'name', label: c.name, width: W.name, cls: '' },
          { key: 'parent', label: c.district, width: W.district, cls: 'caps' },
          { key: 'grand', label: c.county, width: W.county, cls: '' },
        ];
      case 'smd':
        return [
          { key: 'name', label: c.district, width: W.district, cls: 'caps' },
          { key: 'parent', label: c.county, width: W.county, cls: '' },
          { key: 'grand', label: c.region, width: W.region, cls: '' },
        ];
      case 'county':
        return [
          { key: 'name', label: c.county, width: W.county, cls: '' },
          { key: 'parent', label: c.region, width: W.region, cls: '' },
        ];
      case 'nuts2':
        return [{ key: 'name', label: c.region, width: W.region, cls: '' }];
      default:
        return [{ key: 'name', label: c.area, width: W.region, cls: '' }];
    }
  }

  // ---- drawing --------------------------------------------------------------------------------

  private draw(ctx: DialogContext, data: Data): void {
    if (!ctx.units.has(this.scope)) this.scope = ctx.area;
    const inScope = this.inScope(ctx, data);
    const districts = [...new Map(inScope.filter((s) => s.row.district).map((s) => [s.row.district!, s.districtName])).entries()].sort((a, b) =>
      a[1].localeCompare(b[1], 'hu', { numeric: true }),
    );
    if (this.district && !districts.some(([id]) => id === this.district)) this.district = '';
    const filterable = this.level === 'station' || this.level === 'settlement';
    const stations = filterable && this.district ? inScope.filter((s) => s.row.district === this.district) : inScope;
    const rows = this.buildRows(ctx, data, stations);

    // the leading parties of what is on the list (before the search)
    const totals = data.options.map((_, i) => rows.reduce((sum, r) => sum + r.votes[i], 0));
    const order = data.options.map((_, i) => i).filter((i) => totals[i] > 0).sort((a, b) => totals[b] - totals[a]);
    const shown = this.expanded ? order : order.slice(0, LEADING);
    const rest = this.expanded ? [] : order.slice(LEADING);

    const terms = normalizeForSearch(this.query).split(/\s+/).filter(Boolean);
    const matches = terms.length ? rows.filter((r) => terms.every((term) => r.search.includes(term))) : rows;
    const other = (r: Row) => rest.reduce((sum, i) => sum + r.votes[i], 0);
    const value = (r: Row, votes: number) => (this.votesMode ? votes : r.total ? votes / r.total : 0);
    const geo = this.geoColumns();
    const sortValue = (r: Row): number | string => {
      const key = this.sort.key;
      if (key === 'name') return r.name;
      if (key === 'parent') return r.parent;
      if (key === 'grand') return r.grand;
      if (key === 'registered') return r.registered ?? -1;
      if (key === 'turnout') return r.turnout ?? -1;
      if (key === 'other') return value(r, other(r));
      if (key === 'winner') return r.winner >= 0 ? optionLabel(data.options[r.winner]) : '';
      return value(r, r.votes[Number(key.slice(7))]);
    };
    const sorted = [...matches].sort((a, b) => {
      const x = sortValue(a);
      const y = sortValue(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string, 'hu', { numeric: true }) : x - (y as number);
      return c * this.sort.dir || a.name.localeCompare(b.name, 'hu', { numeric: true });
    });

    const redraw = () => this.draw(ctx, data);
    const header = (key: SortKey, label: string, cls = '', title?: string) =>
      h(
        'th',
        { class: `${cls} sortable${this.sort.key === key ? (this.sort.dir === 1 ? ' asc' : ' desc') : ''}`, title: title ?? label, 'aria-sort': this.sort.key === key ? (this.sort.dir === 1 ? 'ascending' : 'descending') : null },
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              const text = key === 'name' || key === 'parent' || key === 'grand' || key === 'winner';
              this.sort = this.sort.key === key ? { key, dir: this.sort.dir === 1 ? -1 : 1 } : { key, dir: text ? 1 : -1 };
              redraw();
            },
          },
          label,
        ),
      );

    // Shares are centered with two decimals, votes right-aligned; the largest of a row is bold.
    const partyCount = shown.length + (rest.length ? 1 : 0);
    const align = this.votesMode ? 'num' : 'pct';
    const cell = (r: Row, votes: number, best: boolean, edge: boolean) =>
      h(
        'td',
        { class: `${align}${best ? ' max' : ''}${edge ? ' ge' : ''}`, title: `${formatInt(votes)} · ${r.total ? formatShare(votes / r.total, 2) : '–'}` },
        this.votesMode ? formatInt(votes) : r.total ? formatShare(votes / r.total, 2) : '–',
      );
    const body = sorted.slice(0, this.limit).map((r) => {
      const win = r.winner >= 0 ? data.options[r.winner] : null;
      const open = r.station !== null && r.station.row.id === this.openId;
      const values = [...shown.map((i) => r.votes[i]), ...(rest.length ? [other(r)] : [])];
      const top = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
      const bold = values.length > 1 && values[top] > 0;
      const row = h(
        'tr',
        {
          class: open ? 'selected' : null,
          style: `--tint:${win?.color ?? NO_DATA_COLOR}`,
          title: r.station ? (open ? t.stations.hide : t.stations.expand) : t.stations.open(r.name),
          onclick: () => {
            if (!r.station) this.open(r.id);
            else this.openId = open ? null : r.station.row.id;
            redraw();
          },
        },
        ...geo.map((column, i) => {
          const text = column.key === 'name' ? r.name : column.key === 'parent' ? r.parent : r.grand;
          return h(
            'td',
            { class: `${column.cls}${i === geo.length - 1 ? ' ge' : ''}`, title: text },
            text,
            column.key === 'name' && r.transfer ? h('small', { class: 'sd-transfer', title: t.stations.transfer }, `-${t.stations.transferShort}`) : null,
          );
        }),
        h('td', { class: 'num' }, formatInt(r.registered)),
        h('td', { class: 'pct ge' }, r.turnout === null ? '–' : formatShare(r.turnout, 2)),
        ...values.map((v, i) => cell(r, v, bold && i === top, i === values.length - 1)),
        h('td', { class: 'winner' }, win ? optionLabel(win) : '–'),
      );
      return row;
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
        redraw();
        const input = this.body.querySelector<HTMLInputElement>('.sd-search');
        input?.focus();
        input?.setSelectionRange(this.query.length, this.query.length);
      },
    });
    const crumbs = h(
      'nav',
      { class: 'sd-crumbs' },
      ...this.crumbIds(ctx).flatMap((id, i, all) => [
        ...(i ? [h('span', { class: 'd-sep' }, ' › ')] : []),
        h(
          'button',
          {
            type: 'button',
            class: 'd-link',
            disabled: i === all.length - 1,
            onclick: () => {
              this.jump(ctx, id);
              redraw();
            },
          },
          displayName(ctx.units.get(id)!),
        ),
      ]),
    );
    const rank = CHAIN.indexOf(this.level);
    const tools = h(
      'div',
      { class: 'sd-tools' },
      h(
        'div',
        { class: 'sd-toolrow' },
        search,
        toggle(
          t.aria.resultType,
          (['L', 'E'] as const).map((v) => ({ value: v, label: v === 'L' ? t.viewLTitle : t.viewETitle, disabled: !data.available[v] })),
          ctx.view,
          (v) => ctx.onView(v),
          true,
        ),
        filterable
          ? h(
              'select',
              {
                'aria-label': t.stations.columns.district,
                onchange: (e: Event) => {
                  this.district = (e.target as HTMLSelectElement).value;
                  this.limit = PAGE;
                  redraw();
                },
              },
              h('option', { value: '', selected: this.district === '' }, t.stations.allDistricts),
              ...districts.map(([id, name]) => h('option', { value: id, selected: id === this.district }, name)),
            )
          : null,
      ),
      h(
        'div',
        { class: 'sd-toolrow' },
        h(
          'div',
          { class: 'sd-moves', role: 'group', 'aria-label': t.stations.moves },
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: rank <= 0,
              title: rank > 0 ? t.stations.upTo(t.stations.rows[CHAIN[rank - 1]]) : t.stations.goUp,
              onclick: () => {
                this.goUp(ctx);
                redraw();
              },
            },
            `↑ ${t.stations.goUp}`,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: rank >= CHAIN.length - 1,
              title: rank < CHAIN.length - 1 ? t.stations.downTo(t.stations.rows[CHAIN[rank + 1]]) : t.stations.goDown,
              onclick: () => {
                this.goDown();
                redraw();
              },
            },
            `↓ ${t.stations.goDown}`,
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: this.level === 'station' && this.scope === this.countryId(ctx),
              title: t.stations.backToStations,
              onclick: () => {
                this.goBack(ctx);
                redraw();
              },
            },
            `⤓ ${t.stations.goBack}`,
          ),
        ),
        crumbs,
        h('span', { class: 'sd-spacer' }),
        h('p', { class: 'sd-count' }, t.stations.count(Math.min(sorted.length, this.limit), sorted.length, t.stations.rows[this.level])),
        toggle(t.stations.showShares, [{ value: 'share', label: t.stations.showShares }, { value: 'votes', label: t.stations.showVotes }], this.votesMode ? 'votes' : 'share', (v) => {
          this.votesMode = v === 'votes';
          redraw();
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
                  redraw();
                },
              }),
              h('span', { class: 'nav-track', 'aria-hidden': 'true' }),
              h('span', null, t.stations.allParties),
            )
          : null,
      ),
    );

    const c = t.stations.columns;
    const g = t.stations.groups;
    const table = h(
      'div',
      { class: 'sd-tablewrap' },
      h(
        'table',
        { class: 'tbl sd-table sd-stations' },
        h(
          'colgroup',
          null,
          ...geo.map((column) => h('col', { style: `width:${column.width}px` })),
          h('col', { style: `width:${W.registered}px` }),
          h('col', { style: `width:${W.turnout}px` }),
          ...Array.from({ length: partyCount }, () => h('col', { style: `width:${PARTY_W}px` })),
          h('col', { style: `width:${W.winner}px` }),
        ),
        h(
          'thead',
          null,
          h(
            'tr',
            { class: 'sd-groups' },
            h('th', { colspan: geo.length, class: 'ge' }, g.geo),
            h('th', { colspan: 2, class: 'ge' }, g.register),
            // colspan="0" would span every remaining column: an area without any votes has none
            ...(partyCount ? [h('th', { colspan: partyCount, class: 'ge' }, g.votes)] : []),
            h('th', null, g.result),
          ),
          h(
            'tr',
            { class: 'sd-cols' },
            ...geo.map((column, i) => header(column.key, column.label, `${column.cls === 'mono' ? '' : column.cls}${i === geo.length - 1 ? ' ge' : ''}`)),
            header('registered', c.registered, 'num'),
            header('turnout', c.turnout, 'pct ge'),
            ...shown.map((i, n) => header(`option:${i}`, optionLabel(data.options[i]), `${align}${n === partyCount - 1 ? ' ge' : ''}`, data.options[i].name || optionLabel(data.options[i]))),
            ...(rest.length ? [header('other', c.other, `${align} ge`, rest.map((i) => optionLabel(data.options[i])).join(', '))] : []),
            header('winner', c.winner),
          ),
        ),
        h('tbody', null, ...body),
      ),
      sorted.length === 0 ? h('p', { class: 'sd-note' }, t.stations.none) : null,
      sorted.length > this.limit
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn sd-more',
              onclick: () => {
                this.limit = Number.POSITIVE_INFINITY;
                redraw();
              },
            },
            t.stations.showAll(sorted.length - this.limit),
          )
        : null,
    );

    // the open station (it may be gone: another election has other stations)
    const station = this.openId ? (data.stations.find((x) => x.row.id === this.openId) ?? null) : null;
    if (!station) this.openId = null;
    const scroll = this.body.querySelector('.sd-tablewrap')?.scrollTop ?? 0;
    const panel = this.body.querySelector<HTMLElement>('.sd-drawer-body');
    const panelScroll = panel && panel.dataset.station === this.openId ? panel.scrollTop : 0;
    this.body.replaceChildren(tools, h('div', { class: 'sd-main' }, table, station ? this.stationPanel(ctx, data, station, redraw) : null));
    const newPanel = this.body.querySelector<HTMLElement>('.sd-drawer-body');
    if (newPanel) newPanel.scrollTop = panelScroll;
    // The second header row sticks exactly under the first: measure it instead of guessing, or
    // the table shows through the gap between them while scrolling.
    const groupRow = this.body.querySelector<HTMLElement>('.sd-groups');
    const colRow = this.body.querySelector<HTMLElement>('.sd-cols');
    if (groupRow && colRow) {
      const top = colRow.getBoundingClientRect().top - groupRow.getBoundingClientRect().top;
      if (top > 0) for (const th of colRow.querySelectorAll<HTMLElement>('th')) th.style.top = `${top}px`;
    }
    const wrap = this.body.querySelector('.sd-tablewrap');
    if (wrap) wrap.scrollTop = scroll;
  }

  /** A station's results and participation in a column beside the table, as the side panel shows
   *  them beside the map: the results boxed like the participation, at the side panel's width. */
  private stationPanel(ctx: DialogContext, data: Data, s: Station, redraw: () => void): HTMLElement {
    const items = data.options
      .map((o, i) => ({ o, v: s.votes[i] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .map(({ o, v }): ResultItem => ({ label: o.name || optionLabel(o), color: o.color, share: s.total ? v / s.total : 0, count: v }));
    const win = s.winner >= 0 ? data.options[s.winner] : null;
    const [registered, voted, valid, invalid] = ctx.view === 'L' ? s.row.tl : s.row.te;
    const block = turnoutBlock(registered ?? null, voted ?? null, valid ?? null, invalid ?? null);
    return h(
      'aside',
      { class: 'sd-drawer', style: `--tint:${win?.color ?? NO_DATA_COLOR}`, 'aria-label': t.stations.station(s.row.id) },
      h(
        'header',
        { class: 'sd-drawer-head' },
        h(
          'div',
          { class: 'sd-drawer-title' },
          h('div', { class: 'sd-hname' }, t.stations.station(s.row.id)),
          h('div', { class: 'sd-hkind' }, [s.name, s.districtName, s.row.transfer ? t.stations.transfer : ''].filter(Boolean).join(' · ')),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-close',
            title: t.stations.hide,
            'aria-label': t.stations.hide,
            onclick: () => {
              this.openId = null;
              redraw();
            },
          },
          '×',
        ),
      ),
      h(
        'div',
        { class: 'sd-drawer-body', 'data-station': s.row.id },
        h('h4', { class: 'd-h' }, h('span', null, t.results, h('small', null, ctx.view === 'L' ? t.viewLTitle : t.viewETitle))),
        items.length ? h('div', { class: 'sd-card' }, resultRows(items, { key: `S:${s.row.id}` })) : h('p', { class: 'sd-note' }, t.stations.noResults),
        h('h4', { class: 'd-h' }, t.participation),
        block ?? h('p', { class: 'sd-note' }, t.noTurnout),
      ),
    );
  }
}
