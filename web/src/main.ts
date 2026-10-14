/** Entry point: load meta + unit index, then keep map and sidebar in sync with the state (URL). */

import './styles.css';
import { loadElection, loadMeta, loadUnit, loadUnitIndex } from './lib/api';
import { t } from './lib/i18n';
import type { ElectionFile, IsoDate, UnitIndexEntry } from './lib/types';
import { levelOfType, validOn } from './lib/units';
import { renderLegend, renderLevelControl } from './map/controls';
import { ElectionMap } from './map/map';
import { createSearch } from './sidebar/search';
import { renderSidebar, renderSidebarMessage } from './sidebar/sidebar';
import { LEVELS, currentElection, getState, initState, setState, subscribe, viewDate, type AppState, type Level } from './state';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

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
  const map = new ElectionMap(byId('map'), byId('map-tooltip'), select, meta.attribution);
  createSearch(byId('search'), meta, index.units, select);
  const sidebar = byId('sidebar-content');
  let electionFile: ElectionFile | null = null;

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

    if (electionChanged && election) {
      loadElection(election.id)
        .then((file) => {
          if (currentElection()?.id !== election.id) return; // the user moved on meanwhile
          electionFile = file;
          void map.setView(election.date, election.district_set, file);
          drawControls();
        })
        .catch((error) => console.error(error));
    } else if (electionChanged) {
      electionFile = null; // no election loaded yet: today's boundaries, no colors
      void map.setView(viewDate(state), null, null);
    }
    if (!previous || previous.level !== state.level) void map.setLevel(state.level);
    if (electionChanged || previous?.level !== state.level) drawControls();
    if (!previous || previous.unit !== state.unit) {
      const entry = state.unit ? units.get(state.unit) : undefined;
      const layer = entry ? levelOfType(entry.type) : null;
      void map.select(entry && layer ? { sourceLayer: layer, id: entry.id } : null);
    }

    if (!state.unit) return renderSidebarMessage(sidebar, t.selectPrompt);
    if (!units.has(state.unit)) return renderSidebarMessage(sidebar, t.loadError);
    if (!previous || previous.unit !== state.unit) renderSidebarMessage(sidebar, t.loading);
    try {
      const unit = await loadUnit(state.unit);
      if (token !== latestRender) return; // a newer render started while loading
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
      if (token === latestRender) renderSidebarMessage(sidebar, t.loadError);
    }
  }

  subscribe((state, previous) => void render(state, previous));
  await render(getState(), null);
}

main().catch((error) => {
  console.error(error);
  byId('sidebar-content').textContent = `${t.loadError} (${error instanceof Error ? error.message : error})`;
});
