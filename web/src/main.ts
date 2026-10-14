/** Entry point: load meta + unit index, then keep map and sidebar in sync with the state (URL). */

import './styles.css';
import { loadElection, loadMeta, loadUnit, loadUnitIndex } from './lib/api';
import { t } from './lib/i18n';
import type { ElectionFile, IsoDate, UnitIndexEntry } from './lib/types';
import { levelOfType, validOn } from './lib/units';
import { cardContent } from './map/card';
import { renderLegend, renderLevelControl } from './map/controls';
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

  /** Selecting a unit also switches the map to the level that shows it. */
  const select = (unitId: string) => {
    const level = levelOf(unitId);
    setState(level ? { unit: unitId, level } : { unit: unitId });
  };

  /** When the pointer rests on a unit, fetch its file so a click shows it at once (files are small and cached). */
  let prefetchTimer: number | undefined;
  const prefetch = (unitId: string) => {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(() => {
      if (units.has(unitId)) loadUnit(unitId).catch(() => undefined);
    }, PREFETCH_DELAY_MS);
  };

  let electionFile: ElectionFile | null = null;
  const describe = (unitId: string) => {
    const unit = units.get(unitId);
    return unit ? cardContent(unit, units, meta, electionFile) : [];
  };
  const map = new ElectionMap(byId('map'), byId('map-card'), { onSelect: select, onHover: prefetch, describe }, meta.attribution, meta.geo);
  createSearch(byId('search'), meta, index.units, select);
  const sidebarPanel = byId('sidebar');
  const sidebar = byId('sidebar-content');

  /** The unit whose outline and sidebar are on screen. A newly selected unit replaces it only
   *  once its file has arrived, so map and sidebar never disagree and the panel never blanks. */
  let shownUnit: string | null = null;
  let loadingTimer: number | undefined;
  const setLoading = (on: boolean) => {
    window.clearTimeout(loadingTimer);
    if (on) loadingTimer = window.setTimeout(() => sidebarPanel.classList.add('loading'), LOADING_BAR_DELAY_MS);
    else sidebarPanel.classList.remove('loading');
  };
  const showSelection = (unitId: string | null) => {
    const entry = unitId ? units.get(unitId) : undefined;
    const layer = entry ? levelOfType(entry.type) : null;
    void map.select(entry && layer ? { level: layer, id: entry.id } : null);
    shownUnit = unitId;
  };

  const drawControls = () => {
    const state = getState();
    renderLevelControl(byId('level-control'), state.level, levelCounts(viewDate(state)), (level) => setState({ level }));
    const legend = byId('legend');
    legend.hidden = !electionFile;
    if (electionFile) renderLegend(legend, electionFile, levelOf, state.level);
  };

  let latestRender = 0;
  async function render(state: AppState, previous: AppState | null): Promise<void> {
    const token = ++latestRender;
    const election = currentElection(state);
    const electionChanged = !previous || currentElection(previous)?.id !== election?.id;

    if (electionChanged) {
      // Without an election (none loaded yet): today's boundaries, no colors.
      const file = election ? loadElection(election.id) : Promise.resolve(null);
      // The map keeps the previous view until both the boundaries and this file are in.
      void map.setView(viewDate(state), file);
      file
        .then((loaded) => {
          if (currentElection()?.id !== election?.id) return; // the user moved on meanwhile
          electionFile = loaded;
          drawControls();
          map.refreshCard();
        })
        .catch((error) => console.error(error));
    }
    if (!previous || previous.level !== state.level) void map.setLevel(state.level);
    if (electionChanged || previous?.level !== state.level) drawControls();

    if (!state.unit || !units.has(state.unit)) {
      setLoading(false);
      showSelection(null);
      return renderSidebarMessage(sidebar, state.unit ? t.loadError : t.selectPrompt);
    }
    const unitChanged = state.unit !== shownUnit;
    if (unitChanged) {
      // Keep the previous unit on screen while the new one loads; nothing to keep on first load.
      if (shownUnit === null) renderSidebarMessage(sidebar, t.loading);
      setLoading(true);
    }
    try {
      const unit = await loadUnit(state.unit);
      if (token !== latestRender) return; // a newer render started while loading
      setLoading(false);
      if (unitChanged) showSelection(state.unit);
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
      });
    } catch (error) {
      console.error(error);
      if (token === latestRender) {
        setLoading(false);
        showSelection(null);
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
