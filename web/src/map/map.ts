/**
 * The Leaflet map: unit boundaries from the GeoJSON files in data/geo/, drawn on canvas, colored
 * by the winning party list, with hover, click and a selection outline.
 *
 * Each level's units valid on a date become one Leaflet layer, built once and kept: every election
 * since the last boundary change reuses it, so switching the year only repaints colors, and
 * switching the level swaps two prebuilt layers on the same canvas. Nothing is shown until both
 * the boundaries and the colors are there, so the previous view stays up until the new one is
 * ready (no flash). Hover and selection outlines live on their own canvases above the fills.
 */

import type { Feature } from 'geojson';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { loadGeo } from '../lib/api';
import type { ElectionFile, GeoFeature, GeoFileMeta, IsoDate } from '../lib/types';
import { validOn } from '../lib/units';
import { LEVELS, type Level } from '../state';
import { HOVER_STYLE, NO_DATA_COLOR, SELECTION_STYLES, borderWeight, fillStyle, overlayStyle, winnerColors } from './style';

/** Levels drawn with the county borders on top, for orientation. */
const WITH_COUNTY_OVERLAY: Level[] = ['settlement', 'jaras', 'smd'];

/** Drawing panes, bottom to top. Only the fills take pointer events. */
const PANES = { fill: 400, lines: 410, hover: 420, select: 430 } as const;
type Pane = keyof typeof PANES;

/** Shown until the first boundaries are in (Hungary). */
const INITIAL_BOUNDS = L.latLngBounds([45.74, 16.11], [48.59, 22.9]);

export interface FeatureRef {
  level: Level;
  id: string;
}

export interface MapCallbacks {
  onSelect: (unitId: string) => void;
  /** The pointer moved onto a unit (used to prefetch its data). */
  onHover?: (unitId: string) => void;
}

/** One level's units valid on one date. */
interface LevelLayer {
  group: L.GeoJSON;
  byId: Map<string, L.Polygon>;
  /** What the layer was last painted with; repainted only when that changes. */
  painted: { colors: Map<string, string>; weight: number } | null;
}

type Rings = L.LatLngExpression[] | L.LatLngExpression[][] | L.LatLngExpression[][][];

export class ElectionMap {
  private readonly map: L.Map;
  private readonly renderers: Record<Pane, L.Canvas>;
  /** Built layers by level, date-independent key (see layerFor). */
  private readonly layers = new Map<string, LevelLayer>();
  private readonly prefetched = new Set<IsoDate>();
  private level: Level = 'settlement';
  private date: IsoDate | null = null;
  private colors: Promise<Map<string, string>> = Promise.resolve(new Map());
  private shown: LevelLayer | null = null;
  private overlay: LevelLayer | null = null;
  private hovered: { id: string; outline: L.Polygon } | null = null;
  private selected: FeatureRef | null = null;
  private selection: L.LayerGroup | null = null;
  private renderToken = 0;
  private pointer: L.Point | null = null;
  private frame = 0;

  constructor(
    container: HTMLElement,
    private readonly tooltip: HTMLElement,
    private readonly callbacks: MapCallbacks,
    attribution: string[],
    private readonly geoFiles: GeoFileMeta[],
  ) {
    this.map = L.map(container, {
      preferCanvas: true,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      minZoom: 6,
      maxZoom: 14,
      zoomControl: false,
      attributionControl: false,
    });
    for (const [name, z] of Object.entries(PANES)) {
      const pane = this.map.createPane(name);
      pane.style.zIndex = String(z);
      if (name !== 'fill') pane.style.pointerEvents = 'none';
    }
    this.renderers = {
      fill: L.canvas({ pane: 'fill', padding: 0.4, tolerance: 2 }),
      lines: L.canvas({ pane: 'lines', padding: 0.4 }),
      hover: L.canvas({ pane: 'hover', padding: 0.4 }),
      select: L.canvas({ pane: 'select', padding: 0.4 }),
    };
    this.map.fitBounds(INITIAL_BOUNDS, { padding: [24, 24], animate: false });
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    if (attribution.length) {
      const control = L.control.attribution({ position: 'bottomright', prefix: false }).addTo(this.map);
      for (const text of attribution) control.addAttribution(text);
    }
    // Dev builds only: the Leaflet instance for debugging in the browser console.
    if (import.meta.env.DEV) (globalThis as { __electionMap?: L.Map }).__electionMap = this.map;

    this.map.on('zoomend', () => this.repaint());
    this.map.on('mousemove', (e: L.LeafletMouseEvent) => {
      this.pointer = e.containerPoint;
      if (this.hovered && !this.frame) this.frame = requestAnimationFrame(() => this.placeTooltip());
    });
    this.map.on('mouseout movestart zoomstart', () => this.unhover());
  }

  /** Show the boundaries valid on `date`, colored by the election's winners (gray without one).
   *  The election file may still be loading: the map changes once both it and the boundaries are in. */
  setView(date: IsoDate, election: Promise<ElectionFile | null>): Promise<void> {
    this.date = date;
    this.colors = election.then(winnerColors).catch((error) => {
      console.error(error);
      return new Map<string, string>();
    });
    return this.render();
  }

  /** Show one level. */
  setLevel(level: Level): Promise<void> {
    this.level = level;
    return this.render();
  }

  /** Outline a unit (drawn even while another level is shown), or clear with null. */
  async select(ref: FeatureRef | null): Promise<void> {
    this.selected = ref;
    await this.drawSelection();
  }

  private async render(): Promise<void> {
    const { level, date } = this;
    if (date === null) return; // no view yet: setView comes first
    const token = ++this.renderToken;
    const [layer, overlay, colors] = await Promise.all([
      this.layerFor(level, date),
      WITH_COUNTY_OVERLAY.includes(level) ? this.layerFor('county', date, true) : null,
      this.colors,
    ]);
    if (token !== this.renderToken) return; // a newer view was asked for meanwhile
    const zoom = this.map.getZoom();
    if (layer) this.paint(layer, colors, zoom);
    if (overlay) overlay.group.setStyle(overlayStyle(zoom));
    // Add the new layer before removing the old: both happen in the same canvas frame.
    if (layer !== this.shown) {
      this.unhover();
      layer?.group.addTo(this.map);
      this.shown?.group.remove();
      this.shown = layer;
    }
    if (overlay !== this.overlay) {
      overlay?.group.addTo(this.map);
      this.overlay?.group.remove();
      this.overlay = overlay;
    }
    void this.drawSelection();
    this.prefetchLevels(date);
  }

  /** The layer with `level`'s units valid on `date`, built on first use (null: no boundaries). */
  private async layerFor(level: Level, date: IsoDate, asOverlay = false): Promise<LevelLayer | null> {
    const files = this.geoFiles.filter((g) => g.level === level && validOn(g, date));
    if (files.length === 0) return null;
    const collections = await Promise.all(files.map((f) => loadGeo(f.file)));
    const features = collections.flatMap((c) => c.features).filter((f) => validOn(f.properties, date));
    // Dates that select the same geometry versions share one layer.
    const versions = [...new Set(features.map((f) => `${f.properties.valid_from}/${f.properties.valid_to}`))].sort();
    const key = [asOverlay ? 'overlay' : 'fill', ...files.map((f) => f.file), ...versions].join('|');
    let layer = this.layers.get(key);
    if (!layer) {
      layer = asOverlay ? this.buildOverlay(features) : this.buildFill(features);
      this.layers.set(key, layer);
    }
    return layer;
  }

  private buildFill(features: GeoFeature[]): LevelLayer {
    const byId = new Map<string, L.Polygon>();
    const zoom = this.map.getZoom();
    const options = {
      pane: 'fill',
      renderer: this.renderers.fill,
      style: () => fillStyle(NO_DATA_COLOR, zoom),
      onEachFeature: (feature: GeoFeature, layer: L.Layer) => {
        const { id, name } = feature.properties;
        const polygon = layer as L.Polygon;
        byId.set(id, polygon);
        polygon.on('mouseover', () => this.hover(id, name, polygon));
        polygon.on('mouseout', () => {
          if (this.hovered?.id === id) this.unhover();
        });
        polygon.on('click', () => this.callbacks.onSelect(id));
      },
    } as L.GeoJSONOptions;
    return { group: L.geoJSON(features as unknown as Feature[], options), byId, painted: null };
  }

  private buildOverlay(features: GeoFeature[]): LevelLayer {
    const options = {
      pane: 'lines',
      renderer: this.renderers.lines,
      interactive: false,
      style: () => overlayStyle(this.map.getZoom()),
    } as L.GeoJSONOptions;
    return { group: L.geoJSON(features as unknown as Feature[], options), byId: new Map(), painted: null };
  }

  /** Color every unit by its winner and set the border weight for the zoom (only what changed). */
  private paint(layer: LevelLayer, colors: Map<string, string>, zoom: number): void {
    const weight = borderWeight(zoom);
    const before = layer.painted;
    if (before?.colors === colors && before.weight === weight) return;
    for (const [id, polygon] of layer.byId) {
      polygon.setStyle(before?.colors === colors ? { weight } : { fillColor: colors.get(id) ?? NO_DATA_COLOR, weight });
    }
    layer.painted = { colors, weight };
  }

  private repaint(): void {
    const zoom = this.map.getZoom();
    if (this.shown?.painted) this.paint(this.shown, this.shown.painted.colors, zoom);
    this.overlay?.group.setStyle(overlayStyle(zoom));
  }

  /** Build the other levels' layers for this date while the browser is idle, so switching is instant. */
  private prefetchLevels(date: IsoDate): void {
    if (this.prefetched.has(date)) return;
    this.prefetched.add(date);
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    idle(() => {
      for (const level of LEVELS) this.layerFor(level, date).catch(() => undefined);
      this.layerFor('county', date, true).catch(() => undefined);
    });
  }

  private hover(id: string, name: string, polygon: L.Polygon): void {
    if (this.hovered?.id === id) return;
    this.unhover();
    const outline = L.polygon(polygon.getLatLngs() as Rings, {
      ...HOVER_STYLE,
      pane: 'hover',
      renderer: this.renderers.hover,
      interactive: false,
    }).addTo(this.map);
    this.hovered = { id, outline };
    this.tooltip.textContent = name;
    this.tooltip.hidden = false;
    this.placeTooltip();
    this.callbacks.onHover?.(id);
  }

  private unhover(): void {
    if (!this.hovered) return;
    this.hovered.outline.remove();
    this.hovered = null;
    this.tooltip.hidden = true;
  }

  private placeTooltip(): void {
    this.frame = 0;
    if (!this.pointer || !this.hovered) return;
    this.tooltip.style.transform = `translate(${this.pointer.x + 14}px, ${this.pointer.y + 14}px)`;
  }

  private async drawSelection(): Promise<void> {
    const { selected, date } = this;
    const layer = selected && date ? await this.layerFor(selected.level, date) : null;
    if (selected !== this.selected || date !== this.date) return; // changed meanwhile
    this.selection?.remove();
    this.selection = null;
    const polygon = selected ? layer?.byId.get(selected.id) : undefined;
    if (!polygon) return;
    const rings = polygon.getLatLngs() as Rings;
    this.selection = L.layerGroup(
      SELECTION_STYLES.map((style) => L.polygon(rings, { ...style, pane: 'select', renderer: this.renderers.select, interactive: false })),
    ).addTo(this.map);
  }
}
