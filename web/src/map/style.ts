/**
 * Map colors and line styles (Leaflet path options).
 *
 * Fills carry no stroke: every border is drawn once, from the level's border mesh, above the fills
 * (a border stroked by both neighbors looked uneven). The fills let a darkened OpenStreetMap show
 * through a little.
 */

import type { PathOptions } from 'leaflet';
import type { Level } from '../state';

export const NO_DATA_COLOR = '#262d38';
const FILL_OPACITY = 0.8;
const BORDER = '#0b0e13';

/** The OpenStreetMap background: darkened (styles.css .osm-base) and half transparent. */
export const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_OPACITY = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function fillStyle(color: string): PathOptions {
  return { stroke: false, fill: true, fillColor: color, fillOpacity: FILL_OPACITY };
}

/** The shown level's own borders: hairlines across the country, clearer lines up close; the
 *  coarse levels (few, large units) a little heavier. */
export function meshStyle(level: Level, zoom: number): PathOptions {
  const coarse = level === 'county' || level === 'nuts2' || level === 'nuts1';
  const base = level === 'settlement' ? 0.5 : coarse ? 0.9 : 0.7;
  return { fill: false, color: BORDER, opacity: 0.9, weight: clamp(base + 0.18 * (zoom - 7), base, base + 0.8), lineJoin: 'round' };
}

/** County borders over the finer levels, for orientation: black and a little thicker. */
export function countyStyle(zoom: number): PathOptions {
  return { fill: false, color: '#000000', opacity: 0.95, weight: clamp(1.5 + 0.25 * (zoom - 7), 1.5, 2.6), lineJoin: 'round' };
}

export const HOVER_STYLE: PathOptions = {
  fill: true,
  fillColor: '#ffffff',
  fillOpacity: 0.14,
  stroke: true,
  color: '#ffffff',
  opacity: 0.75,
  weight: 1.1,
  lineJoin: 'round',
};

/** The selected unit: a white line on a dark casing, readable on light and dark fills alike. */
export const SELECTION_STYLES: PathOptions[] = [
  { fill: false, color: '#05070a', opacity: 0.75, weight: 3.4, lineJoin: 'round' },
  { fill: false, color: '#ffffff', opacity: 1, weight: 1.5, lineJoin: 'round' },
];
