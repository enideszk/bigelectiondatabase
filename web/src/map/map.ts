/** The MapLibre map: tiles from PMTiles, choropleth by winning list, hover, click, selection. */

import { Map as MapLibreMap, addProtocol, setWorkerUrl, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 runs its worker from a separate file; with Vite it must be handed over explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { PMTiles, Protocol } from 'pmtiles';
import { tilesUrl } from '../lib/api';
import { dateToInt } from '../lib/format';
import type { ElectionFile, ElectionMeta } from '../lib/types';
import { LEVELS, type Level } from '../state';
import { COUNTY_OVERLAY, SOURCE, buildStyle, fillLayer, lineLayer, selectedLayer, validityFilter, winnerColor } from './style';

setWorkerUrl(workerUrl);
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);

interface FeatureRef {
  sourceLayer: Level;
  id: string;
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
    private readonly onSelect: (unitId: string) => void,
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
    this.ready = new Promise((resolve) => this.map.once('load', () => resolve()));
    archive
      .getHeader()
      .then((h) => this.map.fitBounds([[h.minLon, h.minLat], [h.maxLon, h.maxLat]], { padding: 24, animate: false }))
      .catch((error) => console.error('Could not read the tiles header', error));
    for (const level of LEVELS) this.bindEvents(level);
  }

  async setElection(election: ElectionMeta, file: ElectionFile): Promise<void> {
    await this.ready;
    const day = dateToInt(election.date);
    const color = winnerColor(file);
    for (const level of LEVELS) {
      const filter = validityFilter(level, day, election.district_set);
      for (const layer of [fillLayer(level), lineLayer(level), selectedLayer(level)]) this.map.setFilter(layer, filter);
      this.map.setPaintProperty(fillLayer(level), 'fill-color', color);
    }
    this.map.setFilter(COUNTY_OVERLAY, validityFilter('county', day, null));
  }

  async setLevel(level: Level): Promise<void> {
    await this.ready;
    this.level = level;
    for (const l of LEVELS) {
      const visibility = l === level ? 'visible' : 'none';
      for (const layer of [fillLayer(l), lineLayer(l), selectedLayer(l)]) this.map.setLayoutProperty(layer, 'visibility', visibility);
    }
    const overlay = level === 'settlement' || level === 'jaras' || level === 'smd' ? 'visible' : 'none';
    this.map.setLayoutProperty(COUNTY_OVERLAY, 'visibility', overlay);
    this.setHovered(null);
  }

  /** Outline a unit (sourceLayer = the tile layer holding it), or clear with null. */
  async select(ref: FeatureRef | null): Promise<void> {
    await this.ready;
    if (this.selected) this.map.setFeatureState({ source: SOURCE, sourceLayer: this.selected.sourceLayer, id: this.selected.id }, { selected: false });
    this.selected = ref;
    if (ref) this.map.setFeatureState({ source: SOURCE, sourceLayer: ref.sourceLayer, id: ref.id }, { selected: true });
  }

  private bindEvents(level: Level): void {
    const layer = fillLayer(level);
    this.map.on('mousemove', layer, (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || feature.id === undefined) return;
      this.setHovered({ sourceLayer: level, id: String(feature.id) });
      this.map.getCanvas().style.cursor = 'pointer';
      this.tooltip.textContent = String(feature.properties?.name ?? feature.id);
      this.tooltip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
      this.tooltip.hidden = false;
    });
    this.map.on('mouseleave', layer, () => {
      this.setHovered(null);
      this.map.getCanvas().style.cursor = '';
      this.tooltip.hidden = true;
    });
    this.map.on('click', layer, (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.id;
      if (id !== undefined && level === this.level) this.onSelect(String(id));
    });
  }

  private setHovered(ref: FeatureRef | null): void {
    if (this.hovered) this.map.setFeatureState({ source: SOURCE, sourceLayer: this.hovered.sourceLayer, id: this.hovered.id }, { hover: false });
    this.hovered = ref;
    if (ref) this.map.setFeatureState({ source: SOURCE, sourceLayer: ref.sourceLayer, id: ref.id }, { hover: true });
  }
}
