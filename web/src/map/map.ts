/** The MapLibre map: tiles from PMTiles, choropleth by winning list, hover, click, selection. */

import { AttributionControl, Map as MapLibreMap, addProtocol, setWorkerUrl, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 runs its worker from a separate file; with Vite it must be handed over explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, Protocol } from 'pmtiles';
import { tilesUrl } from '../lib/api';
import { dateToInt } from '../lib/format';
import type { ElectionFile, IsoDate } from '../lib/types';
import { LEVELS, type Level } from '../state';
import {
  COUNTY_OVERLAY,
  FILL_OPACITY,
  NO_DATA_COLOR,
  OVERLAY_OPACITY,
  SOURCE,
  buildStyle,
  fillLayer,
  hoverLayer,
  lineLayer,
  selectedLayer,
  validityFilter,
  winnerColor,
} from './style';

setWorkerUrl(workerUrl);
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

/** Levels drawn with the county borders on top, for orientation. */
const WITH_COUNTY_OVERLAY: Level[] = ['settlement', 'jaras', 'smd'];

export interface FeatureRef {
  sourceLayer: Level;
  id: string;
}

export interface MapCallbacks {
  onSelect: (unitId: string) => void;
  /** The pointer came to rest on a unit (used to prefetch its data). */
  onHover?: (unitId: string) => void;
}

export class ElectionMap {
  private readonly map: MapLibreMap;
  private readonly ready: Promise<void>;
  private level: Level = 'settlement';
  private hovered: FeatureRef | null = null;
  private selected: FeatureRef | null = null;

  constructor(
    container: HTMLElement,
    private readonly tooltip: HTMLElement,
    private readonly callbacks: MapCallbacks,
    attribution: string[],
  ) {
    const url = tilesUrl();
    const archive = new PMTiles(url);
    protocol.add(archive);
    this.map = new MapLibreMap({
      container,
      style: buildStyle(url),
      center: [19.5, 47.2],
      zoom: 6,
      minZoom: 4,
      maxZoom: 14,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });
    this.map.touchZoomRotate.disableRotation();
    // Dev builds only: the MapLibre instance for debugging in the browser console.
    if (import.meta.env.DEV) (globalThis as { __electionMap?: MapLibreMap }).__electionMap = this.map;
    if (attribution.length) this.map.addControl(new AttributionControl({ compact: true, customAttribution: attribution }), 'bottom-right');
    this.ready = new Promise((resolve) => this.map.once('load', () => resolve()));
    archive
      .getHeader()
      .then((h) => this.map.fitBounds([[h.minLon, h.minLat], [h.maxLon, h.maxLat]], { padding: 24, animate: false }))
      .catch((error) => console.error('Could not read the tiles header', error));
    for (const level of LEVELS) this.bindEvents(level);
  }

  /** Show the boundaries valid on `date`, colored by the election's winners (gray without an election). */
  async setView(date: IsoDate, districtSet: string | null, file: ElectionFile | null): Promise<void> {
    await this.ready;
    const day = dateToInt(date);
    const color = file ? winnerColor(file) : NO_DATA_COLOR;
    for (const level of LEVELS) {
      const filter = validityFilter(level, day, districtSet);
      for (const layer of [fillLayer(level), lineLayer(level), hoverLayer(level), selectedLayer(level)]) this.map.setFilter(layer, filter);
      this.map.setPaintProperty(fillLayer(level), 'fill-color', color);
    }
    this.map.setFilter(COUNTY_OVERLAY, validityFilter('county', day, null));
  }

  /** Show one level. Only constant opacities change, so nothing is re-processed (no flash). */
  async setLevel(level: Level): Promise<void> {
    await this.ready;
    this.level = level;
    for (const l of LEVELS) {
      this.map.setPaintProperty(fillLayer(l), 'fill-opacity', l === level ? FILL_OPACITY : 0);
      this.map.setPaintProperty(lineLayer(l), 'line-opacity', l === level ? 1 : 0);
    }
    this.map.setPaintProperty(COUNTY_OVERLAY, 'line-opacity', WITH_COUNTY_OVERLAY.includes(level) ? OVERLAY_OPACITY : 0);
    this.setHovered(null);
    this.tooltip.hidden = true;
  }

  /** Outline a unit (sourceLayer = the tile layer holding it), or clear with null. */
  async select(ref: FeatureRef | null): Promise<void> {
    await this.ready;
    if (this.selected) this.map.setFeatureState({ source: SOURCE, sourceLayer: this.selected.sourceLayer, id: this.selected.id }, { selected: false });
    this.selected = ref;
    if (ref) this.map.setFeatureState({ source: SOURCE, sourceLayer: ref.sourceLayer, id: ref.id }, { selected: true });
  }

  private bindEvents(level: Level): void {
    // Every level's layers are rendered (transparent when not shown) and so still report
    // features under the pointer: only the shown level may react.
    const layer = fillLayer(level);
    this.map.on('mousemove', layer, (e: MapLayerMouseEvent) => {
      if (level !== this.level) return;
      const feature = e.features?.[0];
      if (!feature || feature.id === undefined) return;
      const id = String(feature.id);
      if (this.hovered?.id !== id) {
        this.setHovered({ sourceLayer: level, id });
        this.callbacks.onHover?.(id);
      }
      this.map.getCanvas().style.cursor = 'pointer';
      this.tooltip.textContent = String(feature.properties?.name ?? feature.id);
      this.tooltip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
      this.tooltip.hidden = false;
    });
    this.map.on('mouseleave', layer, () => {
      if (level !== this.level) return;
      this.setHovered(null);
      this.map.getCanvas().style.cursor = '';
      this.tooltip.hidden = true;
    });
    this.map.on('click', layer, (e: MapLayerMouseEvent) => {
      if (level !== this.level) return;
      const id = e.features?.[0]?.id;
      if (id !== undefined) this.callbacks.onSelect(String(id));
    });
  }

  private setHovered(ref: FeatureRef | null): void {
    if (this.hovered) this.map.setFeatureState({ source: SOURCE, sourceLayer: this.hovered.sourceLayer, id: this.hovered.id }, { hover: false });
    this.hovered = ref;
    if (ref) this.map.setFeatureState({ source: SOURCE, sourceLayer: ref.sourceLayer, id: ref.id }, { hover: true });
  }
}
