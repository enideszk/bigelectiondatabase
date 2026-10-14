/** Map colors and line styles (Leaflet path options). No basemap: units on a dark plane. */

import type { PathOptions } from 'leaflet';
import type { ElectionFile } from '../lib/types';

export const NO_DATA_COLOR = '#262d38';
const FILL_OPACITY = 0.86;
const BORDER = '#090b0f';

/** Unit borders thicken as the map zooms in: hairlines across the country, clear lines up close. */
export function borderWeight(zoom: number): number {
  return Math.min(1.6, Math.max(0.35, 0.35 + 0.25 * (zoom - 7)));
}

export function fillStyle(color: string, zoom: number): PathOptions {
  return {
    fill: true,
    fillColor: color,
    fillOpacity: FILL_OPACITY,
    stroke: true,
    color: BORDER,
    weight: borderWeight(zoom),
    opacity: 1,
    lineJoin: 'round',
  };
}

/** County borders drawn over the finer levels for orientation. */
export function overlayStyle(zoom: number): PathOptions {
  return { fill: false, stroke: true, color: '#f2f5f9', opacity: 0.45, weight: zoom >= 9 ? 1.4 : 1, lineJoin: 'round' };
}

export const HOVER_STYLE: PathOptions = {
  fill: true,
  fillColor: '#ffffff',
  fillOpacity: 0.16,
  stroke: true,
  color: '#ffffff',
  opacity: 0.7,
  weight: 1.2,
  lineJoin: 'round',
};

/** The selected unit: a white line on a dark casing, readable on light and dark fills alike. */
export const SELECTION_STYLES: PathOptions[] = [
  { fill: false, color: '#05070a', opacity: 0.8, weight: 5, lineJoin: 'round' },
  { fill: false, color: '#ffffff', opacity: 1, weight: 2.2, lineJoin: 'round' },
];

/** Unit id -> color of the winning party list (empty without an election). */
export function winnerColors(election: ElectionFile | null): Map<string, string> {
  const colors = new Map<string, string>();
  if (!election) return colors;
  const listColors = new Map(election.lists.map((l) => [l.list_id, l.color]));
  for (const [unitId, listId] of Object.entries(election.winners)) colors.set(unitId, listColors.get(listId) ?? NO_DATA_COLOR);
  return colors;
}
