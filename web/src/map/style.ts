/** Map style: no basemap, one fill + one border + one "selected" outline layer per level. */

import type { ExpressionSpecification, FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { LEVELS, type Level } from '../state';
import type { ElectionFile } from '../lib/types';

export const SOURCE = 'units';
export const NO_DATA_COLOR = '#262d38';
const BACKGROUND = '#0b0e13';
const BORDER = '#090b0f';

export const fillLayer = (level: Level) => `fill-${level}`;
export const lineLayer = (level: Level) => `line-${level}`;
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
        layout: { visibility: 'none' },
        paint: { 'fill-color': NO_DATA_COLOR, 'fill-opacity': ['case', hovered, 1, 0.86] },
      },
      {
        id: lineLayer(level),
        type: 'line',
        source: SOURCE,
        'source-layer': level,
        layout: { visibility: 'none', 'line-join': 'round' },
        paint: { 'line-color': BORDER, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.4] },
      },
    );
  }
  // County borders drawn over the finer levels for orientation.
  layers.push({
    id: COUNTY_OVERLAY,
    type: 'line',
    source: SOURCE,
    'source-layer': 'county',
    layout: { visibility: 'none', 'line-join': 'round' },
    paint: { 'line-color': '#f2f5f9', 'line-width': 1, 'line-opacity': 0.45 },
  });
  for (const level of LEVELS) {
    layers.push({
      id: selectedLayer(level),
      type: 'line',
      source: SOURCE,
      'source-layer': level,
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-opacity': ['case', selected, 1, 0] },
    });
  }
  return {
    version: 8,
    sources: { [SOURCE]: { type: 'vector', url: `pmtiles://${tilesUrl}`, promoteId: 'id' } },
    layers,
  };
}

/** Only the geometry versions valid on the election date (and, for districts, of its district set). */
export function validityFilter(level: Level | 'county', dateInt: number, districtSet: string | null): FilterSpecification {
  const conditions: ExpressionSpecification[] = [
    ['<=', ['get', 'vf'], dateInt],
    ['>', ['get', 'vt'], dateInt],
  ];
  if (level === 'smd') conditions.push(['==', ['get', 'set'], districtSet ?? '']);
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
