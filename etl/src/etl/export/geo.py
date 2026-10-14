"""data/geo/*.json: map boundaries, one GeoJSON file per map level (per district set for the
electoral districts), plus each file's border mesh, drawn by the website's Leaflet map.

Every geometry *version* is a feature with its validity (half-open, null = open-ended):
    {"type": "Feature", "properties": {"id", "name", "valid_from", "valid_to"}, "geometry": ...}
The site shows, per level, the features valid on the selected election's date. meta.json lists the
files with the period they cover (`geo`), so the site fetches only the ones it needs.

All levels share one set of borders, so no line is drawn twice slightly apart:
- settlements (and Budapest districts) are cleaned into an exact coverage (ST_CoverageClean: the
  source has a few edges that do not quite meet);
- districts (járás), counties and regions already are unions of settlements;
- electoral districts are rebuilt from the settlements: a settlement in one district goes in whole,
  and only a settlement split between districts is cut, along the district map (cleaned the same
  way). The district maps themselves are hand-drawn: their borders miss the settlement borders and
  each other by up to hundreds of meters, which showed as gaps and double lines.
The border mesh (`{name}.lines.json`) holds every border of a file's features once, as lines, per
period in which the same features are valid; the map draws it above the fills instead of stroking
each polygon (a shared border stroked by both neighbors looked uneven). Coordinates have 5
decimals (~1 m).
"""

from __future__ import annotations

import json
from datetime import date

import psycopg

# map level -> unit types it shows (keep in step with levelOfType() in web/src/lib/units.ts)
LEVELS: dict[str, tuple[str, ...]] = {
    "settlement": ("settlement", "bp_district"),
    "jaras": ("jaras",),
    "county": ("county",),
    "nuts2": ("nuts2",),
    "nuts1": ("nuts1",),
    "smd": ("smd",),
}
PRECISION = 5
GRID = 1e-8  # degrees (~1 mm): snapping when the cut settlement parts are put together

_LEVEL_CASE = " ".join(
    f"WHEN u.unit_type IN ({', '.join(repr(t) for t in types)}) THEN '{level}'" for level, types in LEVELS.items()
)
_OTHER_TYPES = ", ".join(repr(t) for level, types in LEVELS.items() if level not in ("settlement", "smd") for t in types)

PREPARE_SQL = f"""
CREATE TEMP TABLE geo_settlement AS
SELECT g.unit_id, g.valid_from, g.valid_to,
       ST_Multi(ST_CollectionExtract(ST_SetSRID(
           ST_CoverageClean(g.geom) OVER (PARTITION BY g.valid_from, g.valid_to), 4326), 3)) AS geom
FROM unit_geometry g JOIN unit u USING (unit_id)
WHERE u.unit_type IN ('settlement', 'bp_district');

CREATE TEMP TABLE geo_smd AS
WITH district_map AS (
    SELECT g.unit_id, ST_SetSRID(ST_CoverageClean(g.geom) OVER (PARTITION BY ed.district_set_id), 4326) AS geom
    FROM unit_geometry g JOIN electoral_district ed USING (unit_id)
), member AS (
    SELECT dm.local_unit_id, dm.district_unit_id, s.geom,
           count(*) OVER (PARTITION BY dm.local_unit_id, ed.district_set_id) AS n
    FROM district_membership dm
    JOIN electoral_district ed ON ed.unit_id = dm.district_unit_id
    JOIN district_set ds USING (district_set_id)
    JOIN geo_settlement s ON s.unit_id = dm.local_unit_id
     AND daterange(s.valid_from, s.valid_to) && daterange(ds.valid_from, ds.valid_to)
), cut AS (
    SELECT m.local_unit_id, m.district_unit_id, ST_CollectionExtract(ST_Intersection(m.geom, d.geom), 3) AS geom
    FROM member m JOIN district_map d ON d.unit_id = m.district_unit_id
    WHERE m.n > 1
), leftover AS (
    -- what the district map leaves uncovered of a split settlement goes to its largest part
    SELECT DISTINCT ON (c.local_unit_id) c.district_unit_id,
           ST_CollectionExtract(ST_Difference(m.geom, u.geom), 3) AS geom
    FROM cut c
    JOIN (SELECT local_unit_id, ST_Union(geom) AS geom FROM cut GROUP BY local_unit_id) u USING (local_unit_id)
    JOIN (SELECT DISTINCT ON (local_unit_id) local_unit_id, geom FROM member WHERE n > 1) m USING (local_unit_id)
    ORDER BY c.local_unit_id, ST_Area(c.geom) DESC
), piece AS (
    SELECT district_unit_id, geom FROM member WHERE n = 1
    UNION ALL SELECT district_unit_id, geom FROM cut
    UNION ALL SELECT district_unit_id, geom FROM leftover
)
SELECT district_unit_id AS unit_id, ST_Multi(ST_CollectionExtract(ST_Union(geom, {GRID}), 3)) AS geom
FROM piece WHERE NOT ST_IsEmpty(geom)
GROUP BY district_unit_id;

-- GREATEST/LEAST ignore NULLs, so an open end on one side keeps the other side's bound.
CREATE TEMP TABLE geo_feature AS
SELECT CASE {_LEVEL_CASE} END AS level, ed.district_set_id AS district_set,
       u.unit_id, u.name,
       GREATEST(g.valid_from, u.valid_from) AS valid_from,
       LEAST(g.valid_to, u.valid_to) AS valid_to,
       COALESCE(s.geom, d.geom, g.geom) AS geom
FROM unit_geometry g
JOIN unit u USING (unit_id)
LEFT JOIN electoral_district ed ON ed.unit_id = u.unit_id
LEFT JOIN geo_settlement s ON s.unit_id = g.unit_id AND s.valid_from IS NOT DISTINCT FROM g.valid_from
LEFT JOIN geo_smd d ON d.unit_id = g.unit_id
WHERE u.unit_type IN ('settlement', 'bp_district', 'smd', {_OTHER_TYPES});
"""

FEATURES_SQL = f"""
SELECT level, district_set, unit_id, name, valid_from, valid_to, ST_AsGeoJSON(geom, {PRECISION})
FROM geo_feature
ORDER BY level, district_set, unit_id, valid_from NULLS FIRST
"""

# every border once: the boundaries of the features valid throughout [start, end)
MESH_SQL = f"""
SELECT ST_AsGeoJSON(ST_LineMerge(ST_Union(ST_Boundary(geom))), {PRECISION})
FROM geo_feature
WHERE level = %(level)s AND district_set IS NOT DISTINCT FROM %(district_set)s
  AND (valid_from IS NULL OR (%(start)s::date IS NOT NULL AND valid_from <= %(start)s::date))
  AND (valid_to IS NULL OR (%(end)s::date IS NOT NULL AND valid_to >= %(end)s::date))
"""

CLEANUP_SQL = "DROP TABLE IF EXISTS geo_feature, geo_smd, geo_settlement"


def build_geo_files(conn: psycopg.Connection) -> tuple[dict[str, str], list[dict]]:
    """-> ({file path below data/: GeoJSON text}, the files' entries for meta.json)."""
    conn.execute(CLEANUP_SQL)
    conn.execute(PREPARE_SQL)
    try:
        groups: dict[str, dict] = {}
        for level, district_set, unit_id, name, valid_from, valid_to, geometry in conn.execute(FEATURES_SQL):
            path = f"geo/{level}-{district_set}.json" if district_set else f"geo/{level}.json"
            group = groups.setdefault(path, {"level": level, "set": district_set, "periods": set(), "features": []})
            group["periods"].add((valid_from, valid_to))
            properties = {"id": unit_id, "name": name, "valid_from": _iso(valid_from), "valid_to": _iso(valid_to)}
            properties_json = json.dumps(properties, ensure_ascii=False, separators=(",", ":"))
            group["features"].append(f'{{"type":"Feature","properties":{properties_json},"geometry":{geometry}}}')

        files: dict[str, str] = {}
        manifest = []
        for path, g in groups.items():
            files[path] = _collection(g["features"])
            lines_path = path.removesuffix(".json") + ".lines.json"
            meshes = []
            for start, end in _intervals(g["periods"]):
                params = {"level": g["level"], "district_set": g["set"], "start": start, "end": end}
                mesh = conn.execute(MESH_SQL, params).fetchone()[0]
                if mesh:
                    props = json.dumps({"valid_from": _iso(start), "valid_to": _iso(end)}, separators=(",", ":"))
                    meshes.append(f'{{"type":"Feature","properties":{props},"geometry":{mesh}}}')
            files[lines_path] = _collection(meshes)
            starts = [p[0] for p in g["periods"]]
            ends = [p[1] for p in g["periods"]]
            manifest.append(
                {
                    "level": g["level"],
                    "file": path,
                    "lines": lines_path,
                    "valid_from": None if None in starts else _iso(min(starts)),
                    "valid_to": None if None in ends else _iso(max(ends)),
                }
            )
        return files, manifest
    finally:
        conn.execute(CLEANUP_SQL)


def _intervals(periods: set[tuple[date | None, date | None]]) -> list[tuple[date | None, date | None]]:
    """The periods in which the same features are valid: cut the timeline at every start and end."""
    cuts = sorted({d for p in periods for d in p if d is not None})
    bounds = [None, *cuts, None]
    out = []
    for start, end in zip(bounds, bounds[1:]):
        # keep only intervals that some feature covers
        if any((s is None or (start is not None and s <= start)) and (e is None or (end is not None and e >= end)) for s, e in periods):
            out.append((start, end))
    return out


def _collection(features: list[str]) -> str:
    return '{"type":"FeatureCollection","features":[' + ",".join(features) + "]}"


def _iso(d) -> str | None:
    return d.isoformat() if d else None
