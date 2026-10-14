"""data/geo/*.json: map boundaries, one GeoJSON file per map level (per district set for the
electoral districts), drawn by the website's Leaflet map.

Every geometry *version* is a feature with its validity (half-open, null = open-ended):
    {"type": "Feature", "properties": {"id", "name", "valid_from", "valid_to"}, "geometry": ...}
The site shows, per level, the features valid on the selected election's date. meta.json lists the
files with the period they cover (`geo`), so the site fetches only the ones it needs.

Electoral districts come from detailed source maps and are simplified per district set with
ST_CoverageSimplify (borders shared by two districts stay shared; the largest area change is
< 1%). The other levels are light enough as they are. Coordinates have 5 decimals (~1 m).
"""

from __future__ import annotations

import json

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
SMD_TOLERANCE = 0.001  # degrees (~75-110 m)
PRECISION = 5

_LEVEL_CASE = " ".join(
    f"WHEN u.unit_type IN ({', '.join(repr(t) for t in types)}) THEN '{level}'" for level, types in LEVELS.items()
)
_TYPES = ", ".join(repr(t) for types in LEVELS.values() for t in types)

# GREATEST/LEAST ignore NULLs, so an open end on one side keeps the other side's bound.
FEATURES_SQL = f"""
WITH versions AS (
    SELECT CASE {_LEVEL_CASE} END AS level, ed.district_set_id AS district_set,
           u.unit_id, u.name, u.unit_type,
           GREATEST(g.valid_from, u.valid_from) AS valid_from,
           LEAST(g.valid_to, u.valid_to) AS valid_to,
           g.geom
    FROM unit_geometry g
    JOIN unit u USING (unit_id)
    LEFT JOIN electoral_district ed ON ed.unit_id = u.unit_id
    WHERE u.unit_type IN ({_TYPES})
), simplified AS (
    SELECT level, district_set, unit_id, name, valid_from, valid_to,
           ST_CoverageSimplify(geom, %(tolerance)s) OVER (PARTITION BY district_set) AS geom
    FROM versions WHERE unit_type = 'smd'
    UNION ALL
    SELECT level, district_set, unit_id, name, valid_from, valid_to, geom
    FROM versions WHERE unit_type <> 'smd'
)
SELECT level, district_set, unit_id, name, valid_from, valid_to, ST_AsGeoJSON(geom, {PRECISION})
FROM simplified
ORDER BY level, district_set, unit_id, valid_from NULLS FIRST
"""


def build_geo_files(conn: psycopg.Connection) -> tuple[dict[str, str], list[dict]]:
    """-> ({file path below data/: GeoJSON text}, the files' entries for meta.json)."""
    groups: dict[str, dict] = {}
    for level, district_set, unit_id, name, valid_from, valid_to, geometry in conn.execute(
        FEATURES_SQL, {"tolerance": SMD_TOLERANCE}
    ):
        path = f"geo/{level}-{district_set}.json" if district_set else f"geo/{level}.json"
        group = groups.setdefault(path, {"level": level, "starts": [], "ends": [], "features": []})
        group["starts"].append(valid_from)
        group["ends"].append(valid_to)
        properties = {"id": unit_id, "name": name, "valid_from": _iso(valid_from), "valid_to": _iso(valid_to)}
        properties_json = json.dumps(properties, ensure_ascii=False, separators=(",", ":"))
        group["features"].append(f'{{"type":"Feature","properties":{properties_json},"geometry":{geometry}}}')

    files = {path: '{"type":"FeatureCollection","features":[' + ",".join(g["features"]) + "]}" for path, g in groups.items()}
    manifest = [
        {
            "level": g["level"],
            "file": path,
            "valid_from": None if None in g["starts"] else _iso(min(g["starts"])),
            "valid_to": None if None in g["ends"] else _iso(max(g["ends"])),
        }
        for path, g in groups.items()
    ]
    return files, manifest


def _iso(d) -> str | None:
    return d.isoformat() if d else None
