/** Entry point: load meta + unit index, then keep map, controls and sidebar in sync with the state (URL). */

import './styles.css';
import { renderElectionBar } from './electionBar';
import { loadElection, loadMeta, loadUnit, loadUnitIndex } from './lib/api';
import { t } from './lib/i18n';
import type { ElectionFile, IsoDate, UnitIndexEntry } from './lib/types';
import { displayName, levelOfType, validOn } from './lib/units';
import { cardContent } from './map/card';
import { buildColoring, legendFor, type Coloring } from './map/coloring';
import { renderLegend, renderMapControl, renderMapPicker, renderNavToggle, renderViewSwitch } from './map/controls';
import { Hierarchy, TOP_LEVEL } from './map/hierarchy';
import { StationDialog } from './stations/dialog';
import { ElectionMap } from './map/map';
import { createSearch } from './sidebar/search';
import { renderSidebar, renderSidebarMessage } from './sidebar/sidebar';
import { LEVELS, currentElection, getState, initState, setState, subscribe, viewDate, type AppState, type Level } from './state';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

/** A loading bar appears only if a unit takes longer than this (on a normal connection: never). */
const LOADING_BAR_DELAY_MS = 150;
/** How long the pointer must rest on a unit before its file is fetched in advance. */
const PREFETCH_DELAY_MS = 120;

async function main(): Promise<void> {
  document.title = t.appTitle;
  const [meta, index] = await Promise.all([loadMeta(), loadUnitIndex()]);
  const units = new Map<string, UnitIndexEntry>(index.units.map((u) => [u.id, u]));
  const levelOf = (unitId: string): Level | null => {
    const unit = units.get(unitId);
    return unit ? levelOfType(unit.type) : null;
  };
  /** How many units each map level shows on a date. */
  const levelCounts = (date: IsoDate): Record<Level, number> => {
    const counts = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
    for (const unit of index.units) {
      const level = levelOfType(unit.type);
      if (level && validOn(unit, date)) counts[level] += 1;
    }
    return counts;
  };

  if (meta.is_fixture) {
    const banner = byId('fixture-banner');
    banner.textContent = t.fixtureBanner;
    banner.hidden = false;
  }
  initState(meta);

  const hierarchy = new Hierarchy(units);
  /** With hierarchical navigation: the area shown, moved up past areas that did not exist on the
   *  date shown (e.g. a region of 2014 after switching to 2022). */
  const focusOf = (state: AppState): string | null => {
    let focus = state.nav ? state.focus : null;
    while (focus !== null && !(units.has(focus) && validOn(units.get(focus)!, viewDate(state)))) focus = hierarchy.parent(focus, viewDate(state));
    return focus;
  };
  /** The units the map draws (null = all of the level). */
  let members: Set<string> | null = null;

  /** Selecting a unit (search, side panel links) also switches the map to the level that shows it;
   *  with hierarchical navigation, to the area one up from it, so it shows among its neighbors. */
  const select = (unitId: string) => {
    const state = getState();
    const level = levelOf(unitId);
    if (!level) return setState({ unit: unitId });
    setState(state.nav ? { unit: unitId, level, focus: hierarchy.parent(unitId, viewDate(state)) } : { unit: unitId, level });
  };

  /** A click on the map selects the unit; with hierarchical navigation it also opens the area one
   *  level down (settlements and electoral districts have nothing below: they are only selected). */
  const click = (unitId: string) => {
    const state = getState();
    if (!state.nav) return select(unitId);
    const child = hierarchy.childLevel(unitId, viewDate(state));
    setState(child ? { unit: unitId, focus: unitId, level: child } : { unit: unitId });
  };

  /** When the pointer rests on a unit, fetch its file so a click shows it at once (files are small and cached). */
  let prefetchTimer: number | undefined;
  const prefetch = (unitId: string) => {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(() => {
      if (units.has(unitId)) loadUnit(unitId).catch(() => undefined);
    }, PREFETCH_DELAY_MS);
  };

  /** The selected election's file (once loaded), the promise of it, and what the map shows from it. */
  let electionFile: ElectionFile | null = null;
  let electionRequest: Promise<ElectionFile | null> = Promise.resolve(null);
  let coloring: Coloring | null = null;

  const describe = (unitId: string) => {
    const unit = units.get(unitId);
    return unit ? cardContent(unit, units, meta, electionFile, getState().view, coloring?.values.get(unitId)) : [];
  };
  const map = new ElectionMap(byId('map'), byId('map-card'), { onSelect: click, onHover: prefetch, describe }, meta.attribution, meta.geo);
  createSearch(byId('search'), meta, index.units, select);
  const sidebarPanel = byId('sidebar');
  const sidebar = byId('sidebar-content');

  /** With nothing selected the panel shows the national results. */
  const countryId = index.units.find((u) => u.type === 'country')?.id ?? null;
  /** The unit whose sidebar (and outline) is on screen. A newly selected unit replaces it only
   *  once its file has arrived, so map and sidebar never disagree and the panel never blanks. */
  let shownUnit: string | null = null;
  let loadingTimer: number | undefined;
  const setLoading = (on: boolean) => {
    window.clearTimeout(loadingTimer);
    if (on) loadingTimer = window.setTimeout(() => sidebarPanel.classList.add('loading'), LOADING_BAR_DELAY_MS);
    else sidebarPanel.classList.remove('loading');
  };
  /** `panelUnit` in the side panel; `selected` (null: the national default) outlined on the map. */
  const showSelection = (panelUnit: string | null, selected: string | null) => {
    const entry = selected ? units.get(selected) : undefined;
    const layer = entry ? levelOfType(entry.type) : null;
    void map.select(entry && layer ? { level: layer, id: entry.id } : null);
    shownUnit = panelUnit;
  };

  // The polling station dialog (?list=), and Escape: closes it, else clears the selection.
  const dialog = new StationDialog();
  const syncDialog = (state: AppState) => {
    const election = currentElection(state);
    const area = state.unit && units.has(state.unit) ? state.unit : countryId;
    if (!state.list || !election || !area) {
      if (dialog.isOpen) dialog.close();
      return;
    }
    dialog.show({
      units,
      hierarchy,
      election,
      view: state.view,
      area,
      onView: (view) => setState({ view }),
      onClose: () => setState({ list: false }),
    });
  };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const state = getState();
    if (state.list) return setState({ list: false });
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, select, textarea')) return; // e.g. the search box clears itself
    if (state.unit) setState({ unit: null });
  });

  const drawControls = () => {
    const state = getState();
    const election = currentElection(state);
    renderElectionBar(byId('election-bar'), election, state.view);
    renderMapControl(byId('map-control'), {
      level: state.level,
      counts: levelCounts(viewDate(state)),
      elections: meta.elections,
      current: election,
      onLevel: (level) => setState(state.nav ? { level, focus: hierarchy.focusFor(focusOf(state), level, viewDate(state)) } : { level }),
      onElection: (e) => setState({ year: e.year, type: e.type }),
    });
    const views = electionFile?.views;
    renderViewSwitch(byId('view-switch'), state.view, { L: !views || !!views.L, E: !views || !!views.E }, (view) => setState({ view }));
    renderMapPicker(byId('party-picker'), state.view, electionFile?.views[state.view]?.options ?? [], meta.indicators, state.map, (value) =>
      setState({ map: value }),
    );
    renderLegend(byId('legend'), legendFor(coloring, state.level, members));
    renderNavToggle(byId('nav-toggle'), state.nav, (on) => setState(on ? { nav: true, focus: null, level: TOP_LEVEL } : { nav: false, focus: null }));
    // "Go one up", while an area is open
    const up = byId('nav-up') as HTMLButtonElement;
    const focus = focusOf(state);
    up.hidden = focus === null;
    if (focus !== null) {
      const parent = hierarchy.parent(focus, viewDate(state));
      up.textContent = t.goUp(parent ? displayName(units.get(parent)!) : t.country);
      up.onclick = () => setState({ focus: parent, level: hierarchy.levelOf(focus) ?? TOP_LEVEL });
    }
  };

  /** Recolor the map for the state's election, view and map choice. The map keeps its colors
   *  until the new ones (and the share or indicator file they need) are in. */
  let coloringToken = 0;
  const recolor = (state: AppState) => {
    const token = ++coloringToken;
    const context = { election: currentElection(state), indicators: meta.indicators };
    const next = electionRequest.then((file) => buildColoring(file, context, state.view, state.map, levelOf));
    void map.setView(viewDate(state), next);
    next
      .then((c) => {
        if (token !== coloringToken) return; // a newer coloring was asked for meanwhile
        // Something this election / view does not have (e.g. a party that did not run): back to the winners.
        if (!c.valid && getState().map === state.map) return setState({ map: null });
        coloring = c;
        drawControls();
        map.refreshCard();
      })
      .catch((error) => console.error(error));
  };

  let latestRender = 0;
  async function render(state: AppState, previous: AppState | null): Promise<void> {
    const token = ++latestRender;
    const election = currentElection(state);
    const electionChanged = !previous || currentElection(previous)?.id !== election?.id;

    if (electionChanged) {
      // Without an election (none loaded yet): today's boundaries, no colors.
      electionRequest = election ? loadElection(election.id) : Promise.resolve(null);
      const request = electionRequest;
      request
        .then((file) => {
          if (request !== electionRequest) return; // the user moved on meanwhile
          electionFile = file;
          drawControls();
        })
        .catch((error) => console.error(error));
    }
    if (electionChanged || previous?.view !== state.view || previous?.map !== state.map) recolor(state);
    if (!previous || previous.level !== state.level) void map.setLevel(state.level);
    const focus = focusOf(state);
    if (!previous || electionChanged || previous.level !== state.level || previous.nav !== state.nav || previous.focus !== state.focus) {
      members = state.nav ? hierarchy.members(focus, state.level, viewDate(state)) : null;
      const focusLevel = focus ? hierarchy.levelOf(focus) : null;
      void map.setScope({ members, focus: focus && focusLevel ? { level: focusLevel, id: focus } : null });
    }
    // An area that did not exist on this date: keep the URL in step with the one shown.
    if (state.nav && focus !== state.focus) queueMicrotask(() => setState({ focus }));
    drawControls();
    syncDialog(state);

    if (state.unit && !units.has(state.unit)) {
      setLoading(false);
      showSelection(null, null);
      return renderSidebarMessage(sidebar, t.loadError);
    }
    // Nothing selected: the national results.
    const panelUnit = state.unit ?? countryId;
    if (!panelUnit) {
      setLoading(false);
      showSelection(null, null);
      return renderSidebarMessage(sidebar, t.selectPrompt);
    }
    const unitChanged = panelUnit !== shownUnit;
    if (unitChanged) {
      // Keep the previous unit on screen while the new one loads; nothing to keep on first load.
      if (shownUnit === null) renderSidebarMessage(sidebar, t.loading);
      setLoading(true);
    }
    try {
      const unit = await loadUnit(panelUnit);
      if (token !== latestRender) return; // a newer render started while loading
      setLoading(false);
      if (unitChanged) showSelection(panelUnit, state.unit);
      renderSidebar(sidebar, {
        meta,
        units,
        unit,
        election,
        date: viewDate(state),
        results: election ? unit.elections[election.id] : undefined,
        state,
        select,
        update: setState,
        isDefault: state.unit === null,
      });
    } catch (error) {
      console.error(error);
      if (token === latestRender) {
        setLoading(false);
        showSelection(null, null);
        renderSidebarMessage(sidebar, t.loadError);
      }
    }
  }

  subscribe((state, previous) => void render(state, previous));
  await render(getState(), null);
}

main().catch((error) => {
  console.error(error);
  byId('sidebar-content').textContent = `${t.loadError} (${error instanceof Error ? error.message : error})`;
});
