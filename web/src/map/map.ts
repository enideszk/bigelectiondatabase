/**
 * The Leaflet map: unit boundaries from the GeoJSON files in data/geo/, drawn on canvas over a
 * darkened OpenStreetMap, colored as the caller says (winners or a step map, see coloring.ts),
 * with a hover card, click and a selection outline.
 *
 * Each level's units valid on a date become one layer (fills + the level's border mesh), built once
 * and kept: every election since the last boundary change reuses it, so switching the year or the
 * coloring only repaints fills, and switching the level swaps two prebuilt layers on the same
 * canvas. Nothing changes on screen until both the boundaries and the colors are there, so the
 * previous view stays up until the new one is ready (no flash). Borders are drawn once, from the
 * mesh, above the fills; on the finer levels the county borders go on top. Hover and selection
 * outlines live on their own canvases. Paths are not simplified (smoothFactor 0): Leaflet simplifies
 * each path on its own, so neighbors' shared borders drifted apart and left gaps.
 *
 * Hover does not use Leaflet's canvas events: its renderer checks the pointer at most every 32 ms
 * and drops the moves in between (Canvas._handleMouseHover), so the highlight trailed the cursor
 * and could stay on the previous unit when the cursor stopped. Instead the raw mouse position is
 * taken once per animation frame, the unit under it is found here (see hitTest), and highlight,
 * card content and card position all change in that same frame. As in the owner's Israel
 * dashboard, the card is one element for the life of the map, moved by a transform alone; its
 * content is rebuilt, and its size measured (the only layout read), when the unit changes.
 */

import type { Feature } from 'geojson';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { loadGeo, loadGeoLines } from '../lib/api';
import type { GeoFeature, GeoFileMeta, GeoLinesFeature, IsoDate } from '../lib/types';
import { validOn } from '../lib/units';
import { LEVELS, type Level } from '../state';
import { HOVER_STYLES, NO_DATA_COLOR, OSM_OPACITY, OSM_URL, SELECTION_STYLES, countyStyle, fillStyle, meshStyle } from './style';

/** Levels drawn with the county borders on top, for orientation. */
const WITH_COUNTY_OVERLAY: Level[] = ['settlement', 'jaras', 'smd'];

/** Drawing panes, bottom to top (the OSM tiles are below, in Leaflet's tile pane). None takes
 *  pointer events: the map hit-tests itself. */
const PANES = { fill: 400, mesh: 410, county: 415, hover: 420, select: 430 } as const;
type Pane = keyof typeof PANES;

/** Shown until the first boundaries are in (Hungary). */
const INITIAL_BOUNDS = L.latLngBounds([45.74, 16.11], [48.59, 22.9]);

/** Hover card placement: centered above the cursor, below it when there is no room above. */
const CARD_GAP = 14;
const CARD_MARGIN = 4;

/** Unit id -> fill color (others gray), and the fills' opacity. */
export interface MapColors {
  colors: Map<string, string>;
  fillOpacity: number;
}

const NO_COLORS: MapColors = { colors: new Map(), fillOpacity: 1 };

export interface FeatureRef {
  level: Level;
  id: string;
}

export interface MapCallbacks {
  onSelect: (unitId: string) => void;
  /** A click that hit no unit: with hierarchical navigation it leaves the area that is open. */
  onOutside?: () => void;
  /** The pointer moved onto a unit (used to prefetch its data). */
  onHover?: (unitId: string) => void;
  /** The hover card's content for a unit. */
  describe: (unitId: string) => Node[];
}

/** What part of the shown level the map draws (hierarchical navigation, see hierarchy.ts). */
export interface MapScope {
  /** The units drawn; null = all of the level. */
  members: Set<string> | null;
  /** The area to zoom to when it changes; null = the whole country. */
  focus: FeatureRef | null;
}

/** One level's units valid on one date (or the members of a scope). */
interface LevelLayer {
  level: Level;
  fills: L.FeatureGroup;
  /** The level's borders, each once. */
  mesh: L.GeoJSON | null;
  byId: Map<string, L.Polygon>;
  /** The colors it was last painted with; repainted only when they change. */
  painted: MapColors | null;
}

interface Hit {
  id: string;
  polygon: L.Polygon;
}

type Rings = L.LatLngExpression[] | L.LatLngExpression[][] | L.LatLngExpression[][][];

/** Leaflet internals (1.9.4, pinned in package.json) used for hit-testing: a polygon's projected
 *  pixel bounds and the point-in-polygon test its canvas renderer itself uses for clicks. */
interface Projected {
  _map?: L.Map;
  _pxBounds?: L.Bounds;
  _containsPoint(point: L.Point): boolean;
}

function contains(polygon: L.Polygon, layerPoint: L.Point): boolean {
  const p = polygon as unknown as Projected;
  return p._map !== undefined && p._pxBounds !== undefined && p._containsPoint(layerPoint);
}

export class ElectionMap {
  private readonly map: L.Map;
  private readonly renderers: Record<Pane, L.Canvas>;
  /** Built layers and county meshes, by a date-independent key (see layerFor). */
  private readonly layers = new Map<string, LevelLayer>();
  private readonly countyMeshes = new Map<string, L.GeoJSON>();
  private readonly prefetched = new Set<IsoDate>();
  private level: Level = 'settlement';
  private date: IsoDate | null = null;
  private colors: Promise<MapColors> = Promise.resolve(NO_COLORS);
  private shown: LevelLayer | null = null;
  private scope: MapScope = { members: null, focus: null };
  /** The last scoped layer, rebuilt when the scope or the level's layer changes. */
  private scoped: { base: LevelLayer; members: Set<string>; layer: LevelLayer } | null = null;
  /** The focus last zoomed to (null = the whole country, as at the start). */
  private zoomedTo: string | null = null;
  private county: L.GeoJSON | null = null;
  private selected: FeatureRef | null = null;
  private selection: L.LayerGroup | null = null;
  private renderToken = 0;

  // hover
  private hovered: Hit | null = null;
  private outline: L.Polygon[] = [];
  /** Last mouse position (client coordinates); null while the pointer is off the map. */
  private pointer: { x: number; y: number } | null = null;
  /** The map's box on the page, measured once and again after a resize or scroll. */
  private box: DOMRect | null = null;
  private cardSize = { width: 0, height: 0 };
  /** Panning or zooming: Leaflet's projected coordinates are stale until it ends. */
  private moving = false;
  private frame = 0;

  constructor(
    container: HTMLElement,
    private readonly card: HTMLElement,
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
      // Mouse events go straight to the map container. A canvas that took them would run Leaflet's
      // own hover check, which reads the canvas's page position (a layout read) on every move.
      pane.style.pointerEvents = 'none';
    }
    this.renderers = {
      fill: L.canvas({ pane: 'fill', padding: 0.4 }),
      mesh: L.canvas({ pane: 'mesh', padding: 0.4 }),
      county: L.canvas({ pane: 'county', padding: 0.4 }),
      hover: L.canvas({ pane: 'hover', padding: 0.4 }),
      select: L.canvas({ pane: 'select', padding: 0.4 }),
    };
    L.tileLayer(OSM_URL, { maxZoom: 19, opacity: OSM_OPACITY, className: 'osm-base' }).addTo(this.map);
    this.map.fitBounds(INITIAL_BOUNDS, { padding: [24, 24], animate: false });
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    if (attribution.length) {
      const control = L.control.attribution({ position: 'bottomright', prefix: false }).addTo(this.map);
      for (const text of attribution) control.addAttribution(text);
    }
    // Dev builds only: the Leaflet instance for debugging in the browser console.
    if (import.meta.env.DEV) (globalThis as { __electionMap?: L.Map }).__electionMap = this.map;
    this.card.hidden = true;

    container.addEventListener(
      'mousemove',
      (e) => {
        this.pointer = { x: e.clientX, y: e.clientY };
        this.requestFrame();
      },
      { passive: true },
    );
    container.addEventListener('mouseleave', () => {
      this.pointer = null;
      this.unhover();
    });
    window.addEventListener('scroll', () => (this.box = null), { passive: true, capture: true });
    // The container follows the page layout (toolbar, side panel), not only the window.
    new ResizeObserver(() => {
      this.map.invalidateSize();
      this.box = null;
    }).observe(container);
    this.map.on('resize', () => (this.box = null));
    this.map.on('movestart zoomstart', () => {
      this.moving = true;
      this.unhover();
    });
    // The card comes back where the cursor rests (after Leaflet has re-projected the layers).
    this.map.on('moveend zoomend', () => {
      this.moving = false;
      this.requestFrame();
    });
    this.map.on('zoomend', () => this.restyleLines());
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const hit = this.hitTest(e.containerPoint);
      if (hit) this.callbacks.onSelect(hit.id);
      else this.callbacks.onOutside?.();
    });
  }

  /** Show the boundaries valid on `date` in these colors. They may still be loading: the map
   *  changes once both they and the boundaries are in. */
  setView(date: IsoDate, colors: Promise<MapColors>): Promise<void> {
    this.date = date;
    this.colors = colors.catch((error) => {
      console.error(error);
      return NO_COLORS;
    });
    return this.render();
  }

  /** Show one level. */
  setLevel(level: Level): Promise<void> {
    this.level = level;
    return this.render();
  }

  /** Draw only some units of the level, zoomed to their area (hierarchical navigation). */
  setScope(scope: MapScope): Promise<void> {
    this.scope = scope;
    return this.render();
  }

  /** Outline a unit (drawn even while another level is shown), or clear with null. */
  async select(ref: FeatureRef | null): Promise<void> {
    this.selected = ref;
    await this.drawSelection();
  }

  /** Rebuild the hover card (its data changed, e.g. another election was loaded). */
  refreshCard(): void {
    if (!this.hovered) return;
    this.fillCard(this.hovered.id);
    this.requestFrame();
  }

  private async render(): Promise<void> {
    const { level, date } = this;
    if (date === null) return; // no view yet: setView comes first
    const token = ++this.renderToken;
    const [base, county, colors] = await Promise.all([
      this.layerFor(level, date),
      WITH_COUNTY_OVERLAY.includes(level) ? this.countyMeshFor(date) : null,
      this.colors,
    ]);
    if (token !== this.renderToken) return; // a newer view was asked for meanwhile
    const zoom = this.map.getZoom();
    const layer = base && this.scope.members ? this.scopedLayer(base, this.scope.members) : base;
    if (layer) {
      this.paint(layer, colors);
      if (layer.mesh) layer.mesh.setStyle(meshStyle(layer.level, zoom));
      else if (layer !== base) layer.fills.setStyle({ weight: meshStyle(layer.level, zoom).weight });
    }
    county?.setStyle(countyStyle(zoom));
    // Add the new layers before removing the old: both happen in the same canvas frame.
    if (layer !== this.shown) {
      this.unhover();
      layer?.fills.addTo(this.map);
      layer?.mesh?.addTo(this.map);
      this.shown?.fills.remove();
      this.shown?.mesh?.remove();
      this.shown = layer;
      this.requestFrame(); // hover whatever is now under the cursor
    }
    if (county !== this.county) {
      county?.addTo(this.map);
      this.county?.remove();
      this.county = county;
    }
    void this.drawSelection();
    void this.zoomToFocus();
    this.prefetchLevels(date);
  }

  /** The members of a scope as a layer of their own: the same polygons, each stroked (the border
   *  mesh covers the whole level, so it cannot be used for a part of it). */
  private scopedLayer(base: LevelLayer, members: Set<string>): LevelLayer {
    if (this.scoped?.base === base && this.scoped.members === members) return this.scoped.layer;
    const border = meshStyle(base.level, this.map.getZoom());
    const byId = new Map<string, L.Polygon>();
    const fills = L.featureGroup();
    for (const id of members) {
      const polygon = base.byId.get(id);
      if (!polygon) continue;
      const part = L.polygon(polygon.getLatLngs() as Rings, {
        ...fillStyle(NO_DATA_COLOR),
        stroke: true,
        color: border.color,
        opacity: border.opacity,
        weight: border.weight,
        lineJoin: 'round',
        pane: 'fill',
        renderer: this.renderers.fill,
        interactive: false,
        smoothFactor: 0,
      });
      byId.set(id, part);
      fills.addLayer(part);
    }
    const layer: LevelLayer = { level: base.level, fills, mesh: null, byId, painted: null };
    this.scoped = { base, members, layer };
    return layer;
  }

  /** When the focus changed: fly to its area (or back to the whole country). */
  private async zoomToFocus(): Promise<void> {
    const { focus } = this.scope;
    const key = focus?.id ?? null;
    if (key === this.zoomedTo || this.date === null) return;
    this.zoomedTo = key;
    if (!focus) {
      this.map.flyToBounds(INITIAL_BOUNDS, { padding: [24, 24], duration: 0.6 });
      return;
    }
    const layer = await this.layerFor(focus.level, this.date);
    const polygon = layer?.byId.get(focus.id);
    if (polygon && this.zoomedTo === key) this.map.flyToBounds(polygon.getBounds(), { padding: [30, 30], duration: 0.6 });
  }

  /** The files of `level` that cover `date`. */
  private filesFor(level: Level, date: IsoDate): GeoFileMeta[] {
    return this.geoFiles.filter((g) => g.level === level && validOn(g, date));
  }

  /** The layer with `level`'s units valid on `date`, built on first use (null: no boundaries). */
  private async layerFor(level: Level, date: IsoDate): Promise<LevelLayer | null> {
    const files = this.filesFor(level, date);
    if (files.length === 0) return null;
    const [collections, meshes] = await Promise.all([
      Promise.all(files.map((f) => loadGeo(f.file))),
      Promise.all(files.map((f) => loadGeoLines(f.lines))),
    ]);
    const features = collections.flatMap((c) => c.features).filter((f) => validOn(f.properties, date));
    const lines = meshes.flatMap((c) => c.features).filter((f) => validOn(f.properties, date));
    // Dates that select the same geometry versions share one layer.
    const versions = [...new Set(features.map((f) => `${f.properties.valid_from}/${f.properties.valid_to}`))].sort();
    const key = [...files.map((f) => f.file), ...versions].join('|');
    let layer = this.layers.get(key);
    if (!layer) {
      layer = this.buildLayer(level, features, lines);
      this.layers.set(key, layer);
    }
    return layer;
  }

  /** The county borders valid on `date`, from the county mesh. */
  private async countyMeshFor(date: IsoDate): Promise<L.GeoJSON | null> {
    const files = this.filesFor('county', date);
    if (files.length === 0) return null;
    const meshes = await Promise.all(files.map((f) => loadGeoLines(f.lines)));
    const lines = meshes.flatMap((c) => c.features).filter((f) => validOn(f.properties, date));
    const key = lines.map((f) => `${f.properties.valid_from}/${f.properties.valid_to}`).join('|');
    let mesh = this.countyMeshes.get(key);
    if (!mesh) {
      mesh = this.lineLayer(lines, 'county', countyStyle(this.map.getZoom()));
      this.countyMeshes.set(key, mesh);
    }
    return mesh;
  }

  private buildLayer(level: Level, features: GeoFeature[], lines: GeoLinesFeature[]): LevelLayer {
    const byId = new Map<string, L.Polygon>();
    const options = {
      pane: 'fill',
      renderer: this.renderers.fill,
      interactive: false, // hover and click are handled by the map itself (hitTest)
      smoothFactor: 0,
      style: () => fillStyle(NO_DATA_COLOR),
      onEachFeature: (feature: GeoFeature, layer: L.Layer) => byId.set(feature.properties.id, layer as L.Polygon),
    } as L.GeoJSONOptions;
    const fills = L.geoJSON(features as unknown as Feature[], options);
    const mesh = lines.length ? this.lineLayer(lines, 'mesh', meshStyle(level, this.map.getZoom())) : null;
    return { level, fills, mesh, byId, painted: null };
  }

  private lineLayer(lines: GeoLinesFeature[], pane: 'mesh' | 'county', style: L.PathOptions): L.GeoJSON {
    const options = { pane, renderer: this.renderers[pane], interactive: false, smoothFactor: 0, style: () => style } as L.GeoJSONOptions;
    return L.geoJSON(lines as unknown as Feature[], options);
  }

  /** Color every unit (only when the colors changed). */
  private paint(layer: LevelLayer, colors: MapColors): void {
    if (layer.painted === colors) return;
    for (const [id, polygon] of layer.byId) {
      polygon.setStyle({ fillColor: colors.colors.get(id) ?? NO_DATA_COLOR, fillOpacity: colors.fillOpacity });
    }
    layer.painted = colors;
  }

  /** Line weights follow the zoom. */
  private restyleLines(): void {
    const zoom = this.map.getZoom();
    if (this.shown?.mesh) this.shown.mesh.setStyle(meshStyle(this.shown.level, zoom));
    else this.shown?.fills.setStyle({ weight: meshStyle(this.shown.level, zoom).weight });
    this.county?.setStyle(countyStyle(zoom));
  }

  /** Build the other levels' layers for this date while the browser is idle, so switching is instant. */
  private prefetchLevels(date: IsoDate): void {
    if (this.prefetched.has(date)) return;
    this.prefetched.add(date);
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 200));
    idle(() => {
      for (const level of LEVELS) this.layerFor(level, date).catch(() => undefined);
      this.countyMeshFor(date).catch(() => undefined);
    });
  }

  // ---- hover ----------------------------------------------------------------------------------

  private requestFrame(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.onFrame());
  }

  /** Once per animation frame while the pointer moves: find the unit under it, then move the card. */
  private onFrame(): void {
    this.frame = 0;
    if (!this.pointer || this.moving) return;
    const box = (this.box ??= this.map.getContainer().getBoundingClientRect());
    const x = this.pointer.x - box.left;
    const y = this.pointer.y - box.top;
    const hit = this.hitTest(L.point(x, y));
    if (hit?.id !== this.hovered?.id) {
      if (hit) this.hover(hit);
      else this.unhover();
    }
    if (this.hovered) this.placeCard(x, y, box.width);
  }

  /** The unit of the shown level under a point of the map container. */
  private hitTest(containerPoint: L.Point): Hit | null {
    if (!this.shown) return null;
    const p = this.map.containerPointToLayerPoint(containerPoint);
    // Usually the pointer is still in the same unit; keeping it also stops the pixels on a shared
    // border from flickering between the two neighbors.
    if (this.hovered && contains(this.hovered.polygon, p)) return this.hovered;
    for (const [id, polygon] of this.shown.byId) {
      if (contains(polygon, p)) return { id, polygon };
    }
    return null;
  }

  private hover(hit: Hit): void {
    this.hovered = hit;
    // Traced from the latlngs the fill polygon already holds: nothing is parsed or built again.
    const rings = hit.polygon.getLatLngs() as Rings;
    if (this.outline.length) for (const line of this.outline) line.setLatLngs(rings);
    else {
      this.outline = HOVER_STYLES.map((style) =>
        L.polygon(rings, { ...style, pane: 'hover', renderer: this.renderers.hover, interactive: false, smoothFactor: 0 }),
      );
    }
    for (const line of this.outline) if (!this.map.hasLayer(line)) line.addTo(this.map);
    this.map.getContainer().classList.add('unit-hover');
    this.fillCard(hit.id);
    this.callbacks.onHover?.(hit.id);
  }

  private unhover(): void {
    if (!this.hovered) return;
    this.hovered = null;
    for (const line of this.outline) line.remove();
    this.card.hidden = true;
    this.map.getContainer().classList.remove('unit-hover');
  }

  private fillCard(unitId: string): void {
    this.card.replaceChildren(...this.callbacks.describe(unitId));
    this.card.hidden = false;
    // The one layout read, taken when the content changes rather than every frame.
    this.cardSize = { width: this.card.offsetWidth, height: this.card.offsetHeight };
  }

  private placeCard(x: number, y: number, mapWidth: number): void {
    const { width, height } = this.cardSize;
    const left = Math.min(Math.max(CARD_MARGIN, x - width / 2), Math.max(CARD_MARGIN, mapWidth - width - CARD_MARGIN));
    const above = y - height - CARD_GAP;
    const top = above >= CARD_MARGIN ? above : y + CARD_GAP + 6;
    this.card.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  // ---- selection ------------------------------------------------------------------------------

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
      SELECTION_STYLES.map((style) =>
        L.polygon(rings, { ...style, pane: 'select', renderer: this.renderers.select, interactive: false, smoothFactor: 0 }),
      ),
    ).addTo(this.map);
  }
}
