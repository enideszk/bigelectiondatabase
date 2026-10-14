/**
 * Map style: no basemap; per level a fill, a border, a hover highlight and a "selected" outline.
 *
 * Every level's layers stay visible all the time and the shown level is chosen by opacity
 * (see ElectionMap.setLevel). MapLibre builds no render data for layers with visibility "none",
 * so toggling visibility re-processes every tile on screen and the map flashes; changing a
 * constant opacity is only a paint update. For the same reason the fill/border opacities are
 * constants: an opacity expression depending on feature state would count as data-driven and
 * changing it would re-process the tiles too. Hover therefore lives in its own layer.
 */

import type { ExpressionSpecification, FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { LEVELS, type Level } from '../state';
import type { ElectionFile } from '../lib/types';

export const SOURCE = 'units';
export const NO_DATA_COLOR = '#262d38';
export const FILL_OPACITY = 0.86;
export const OVERLAY_OPACITY = 0.45;
const BACKGROUND = '#0b0e13';
const BORDER = '#090b0f';

export const fillLayer = (level: Level) => `fill-${level}`;
export const lineLayer = (level: Level) => `line-${level}`;
export const hoverLayer = (level: Level) => `hover-${level}`;
export const selectedLayer = (level: Level) => `selected-${level}`;
export const COUNTY_OVERLAY = 'county-overlay';

const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];

export function buildStyle(tilesUrl: string): StyleSpecification {
  const layers: LayerSpecification[] = [{ id: 'background', type: 'background', paint: { 'background-color': BACKGROUND } }];
  for (const level of LEVELS) {
    layers.push(
      {
        id: fillLayer(level),
        type: 'fill',
        source: SOURCE,
        'source-layer': level,
        paint: { 'fill-color': NO_DATA_COLOR, 'fill-opacity': 0 },
      },
      {
        id: lineLayer(level),
        type: 'line',
        source: SOURCE,
        'source-layer': level,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': BORDER, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.4], 'line-opacity': 0 },
      },
      {
        // Hover state is only ever set on features of the shown level.
        id: hoverLayer(level),
        type: 'fill',
        source: SOURCE,
        'source-layer': level,
        paint: { 'fill-color': '#ffffff', 'fill-opacity': ['case', hovered, 0.16, 0] },
      },
    );
  }
  // County borders drawn over the finer levels for orientation.
  layers.push({
    id: COUNTY_OVERLAY,
    type: 'line',
    source: SOURCE,
    'source-layer': 'county',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#f2f5f9', 'line-width': 1, 'line-opacity': 0 },
  });
  // The selected unit stays outlined on top even while another level is shown.
  for (const level of LEVELS) {
    layers.push({
      id: selectedLayer(level),
      type: 'line',
      source: SOURCE,
      'source-layer': level,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': ['case', selected, 1, 0] },
    });
  }
  return {
    version: 8,
    sources: { [SOURCE]: { type: 'vector', url: `pmtiles://${tilesUrl}`, promoteId: 'id' } },
    layers,
    transition: { duration: 200, delay: 0 }, // levels cross-fade
  };
}

/** Only the geometry versions valid on the election date (and, for districts, of its district set). */
export function validityFilter(level: Level | 'county', dateInt: number, districtSet: string | null): FilterSpecification {
  const conditions: ExpressionSpecification[] = [
    ['<=', ['get', 'vf'], dateInt],
    ['>', ['get', 'vt'], dateInt],
  ];
  // With an election, its own district set; without one, whichever set is valid on the date.
  if (level === 'smd' && districtSet) conditions.push(['==', ['get', 'set'], districtSet]);
  return ['all', ...conditions];
}

/** Fill color = color of the winning party list of each unit. */
export function winnerColor(election: ElectionFile): ExpressionSpecification | string {
  const colors = new Map(election.lists.map((l) => [l.list_id, l.color]));
  const pairs: string[] = [];
  for (const [unitId, listId] of Object.entries(election.winners)) pairs.push(unitId, colors.get(listId) ?? NO_DATA_COLOR);
  if (pairs.length === 0) return NO_DATA_COLOR;
  return ['match', ['get', 'id'], ...pairs, NO_DATA_COLOR] as unknown as ExpressionSpecification;
}
