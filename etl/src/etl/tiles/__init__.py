"""unit_geometry -> vector tiles (cut by PostGIS ST_AsMVT) -> one PMTiles file.

Every geometry *version* becomes a feature, with its validity as integer dates:
    id     unit_id (the map's promoteId, also the key for colors)
    name   unit name (hover label)
    vf, vt valid_from / valid_to as YYYYMMDD integers (0 and 99991231 when open-ended)
    set    district set id (smd layer only)
The website filters each layer with  vf <= election date < vt  so it shows the boundaries in
force on the selected election day. One tile layer per unit level, see LAYERS.
"""

from __future__ import annotations

import gzip
import math
import os
import shutil
import time
from pathlib import Path

import psycopg
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

# tile layer -> unit types it contains
LAYERS: dict[str, tuple[str, ...]] = {
    "country": ("country",),
    "nuts1": ("nuts1",),
    "nuts2": ("nuts2",),
    "county": ("county",),
    "jaras": ("jaras",),
    "smd": ("smd",),
    "settlement": ("settlement", "bp_district"),
}
EXTENT = 4096
BUFFER = 64
WORLD_M = 2 * 20037508.342789244   # width of the Web Mercator world in meters

FEATURES_SQL = """
CREATE TEMP TABLE tile_feature ON COMMIT DROP AS
SELECT CASE {layer_case} END AS layer,
       u.unit_id AS id,
       u.name,
       COALESCE(to_char(GREATEST(g.valid_from, u.valid_from), 'YYYYMMDD')::int, 0) AS vf,
       COALESCE(to_char(LEAST(g.valid_to, u.valid_to), 'YYYYMMDD')::int, 99991231) AS vt,
       ed.district_set_id AS set,
       ST_Transform(g.geom, 3857) AS geom
FROM unit_geometry g
JOIN unit u USING (unit_id)
LEFT JOIN electoral_district ed ON ed.unit_id = u.unit_id
WHERE u.unit_type IN ({types});
CREATE INDEX ON tile_feature USING gist (geom);
ANALYZE tile_feature;
"""


def _layer_sql(layer: str) -> str:
    return f"""COALESCE((
        SELECT ST_AsMVT(q, '{layer}', {EXTENT}, 'geom')
        FROM (SELECT id, name, vf, vt, set, ST_AsMVTGeom(ST_Simplify(f.geom, %(tol)s, true), b.env, {EXTENT}, {BUFFER}, true) AS geom
              FROM tile_feature f, b
              WHERE f.layer = '{layer}' AND f.geom && b.env_buffered) q
        WHERE q.geom IS NOT NULL), ''::bytea)"""


TILE_SQL = (
    "WITH b AS (SELECT ST_TileEnvelope(%(z)s, %(x)s, %(y)s) AS env, "
    "ST_TileEnvelope(%(z)s, %(x)s, %(y)s, margin => %(margin)s) AS env_buffered) SELECT "
    + " || ".join(_layer_sql(layer) for layer in LAYERS)
)


def _tile_xy(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def build_pmtiles(conn: psycopg.Connection, out: Path, max_zoom: int = 10, min_zoom: int = 0) -> dict[str, int]:
    types = [t for ts in LAYERS.values() for t in ts]
    layer_case = " ".join(f"WHEN u.unit_type IN ({', '.join(repr(t) for t in ts)}) THEN '{layer}'" for layer, ts in LAYERS.items())
    tiles: list[tuple[int, bytes]] = []
    with conn.transaction():
        conn.execute(FEATURES_SQL.format(layer_case=layer_case, types=", ".join(repr(t) for t in types)))
        extent = conn.execute(
            "SELECT ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e) FROM (SELECT ST_Extent(ST_Transform(geom, 4326)) AS e FROM tile_feature) s"
        ).fetchone()
        if extent is None or extent[0] is None:
            raise RuntimeError("unit_geometry is empty: nothing to tile. Load geometries first.")
        min_lon, min_lat, max_lon, max_lat = extent
        for z in range(min_zoom, max_zoom + 1):
            x0, y0 = _tile_xy(min_lon, max_lat, z)
            x1, y1 = _tile_xy(max_lon, min_lat, z)
            tile_m = WORLD_M / 2**z
            params = {"z": z, "tol": tile_m / EXTENT, "margin": BUFFER / EXTENT}
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    data = conn.execute(TILE_SQL, params | {"x": x, "y": y}).fetchone()[0]
                    if data:
                        tiles.append((zxy_to_tileid(z, x, y), gzip.compress(bytes(data), mtime=0)))
    if not tiles:
        raise RuntimeError("No tiles were produced.")

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".pmtiles.tmp")
    with tmp.open("wb") as f:
        writer = Writer(f)
        for tile_id, data in sorted(tiles):
            writer.write_tile(tile_id, data)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(min_lon * 1e7),
                "min_lat_e7": int(min_lat * 1e7),
                "max_lon_e7": int(max_lon * 1e7),
                "max_lat_e7": int(max_lat * 1e7),
                "center_zoom": max(min_zoom, min(6, max_zoom)),
                "center_lon_e7": int((min_lon + max_lon) / 2 * 1e7),
                "center_lat_e7": int((min_lat + max_lat) / 2 * 1e7),
            },
            {
                "name": "hu-data-platform units",
                "description": "Boundaries of clickable units, all geometry versions (filter by vf/vt).",
                "vector_layers": [
                    {
                        "id": layer,
                        "minzoom": min_zoom,
                        "maxzoom": max_zoom,
                        "fields": {"id": "String", "name": "String", "vf": "Number", "vt": "Number", "set": "String"},
                    }
                    for layer in LAYERS
                ],
            },
        )
    _replace(tmp, out)
    return {"tiles": len(tiles), "bytes": out.stat().st_size}


def _replace(tmp: Path, out: Path, attempts: int = 10) -> None:
    """Swap the new file in. On Windows a file another program has open (the dev server, a virus
    scanner) cannot be replaced; retry for a few seconds, then overwrite its contents in place."""
    for attempt in range(attempts):
        try:
            os.replace(tmp, out)
            return
        except PermissionError:
            time.sleep(0.5 * (attempt + 1))
    shutil.copyfile(tmp, out)
    tmp.unlink()
