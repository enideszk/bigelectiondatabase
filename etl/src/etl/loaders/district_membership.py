"""Derived: which settlements / Budapest districts belong to which single-member district.

For every district set:
  * if an election of that set has polling-station data: from the polling stations (authoritative:
    NVI assigns every station to a district, so a city split between districts gets each of them);
  * otherwise spatially from the district maps (provisional): a unit belongs to the districts of
    its own county that hold at least 10% of its area, and always to the one holding most of it;
    and every district gets the unit holding most of it (a district inside a city may be under 10%
    of the city, e.g. 1990 Borsod-Abaúj-Zemplén 02 in Miskolc). (The OSM settlement map and the
    district maps come from different base data; slivers of a few percent along borders are not
    real membership.)
  * a unit that no polling station of a set covers (a settlement founded after the set's last
    election, e.g. Balatonakarattya for the 1990 set) gets the district holding most of its area,
    so the districts drawn from the settlements leave no hole.

Run it after the election loaders, and again after loading an election of a district set that had
no polling-station data before.

Requires: oevk_maps, osm_boundaries_2026, and the election loaders.
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from ._common import SourceInfo, replace_source

SOURCE = SourceInfo(
    name="Derived: settlement-district membership",
    publisher="hu-data-platform (computed from polling stations and district maps)",
)

MIN_SHARE = 0.10


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    """Nothing to clean: computed from data already in the database."""
    return []


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        from_stations = conn.execute(
            """
            INSERT INTO district_membership (local_unit_id, district_unit_id, source_id)
            SELECT DISTINCT ps.local_unit_id, ps.district_unit_id, %(sid)s
            FROM polling_station ps
            WHERE ps.district_unit_id IS NOT NULL
            """,
            {"sid": source_id},
        ).rowcount
        spatial = conn.execute(
            """
            WITH sets_with_stations AS (
                SELECT DISTINCT ed.district_set_id
                FROM polling_station ps JOIN electoral_district ed ON ed.unit_id = ps.district_unit_id
            ),
            local_county AS (
                SELECT a.unit_id, a.ancestor_id AS county_unit_id
                FROM v_unit_ancestor a
                JOIN unit c ON c.unit_id = a.ancestor_id AND c.unit_type = 'county'
                WHERE a.period @> CURRENT_DATE
            ),
            overlap AS (
                SELECT l.unit_id AS local_unit_id, ed.unit_id AS district_unit_id, ed.district_set_id,
                       ST_Area(ST_Intersection(lg.geom, dg.geom)) AS common, ST_Area(lg.geom) AS local_area
                FROM unit l
                JOIN local_county lc ON lc.unit_id = l.unit_id
                JOIN unit_geometry lg ON lg.unit_id = l.unit_id
                JOIN electoral_district ed ON ed.county_unit_id = lc.county_unit_id   -- districts never cross counties
                JOIN unit_geometry dg ON dg.unit_id = ed.unit_id AND dg.geom && lg.geom
                WHERE l.unit_type IN ('settlement', 'bp_district')
                  AND NOT EXISTS (SELECT 1 FROM district_membership dm
                                  JOIN electoral_district d2 ON d2.unit_id = dm.district_unit_id
                                  WHERE dm.local_unit_id = l.unit_id AND d2.district_set_id = ed.district_set_id)
            ),
            ranked AS (
                SELECT o.*, common / NULLIF(local_area, 0) AS share, s.district_set_id IS NOT NULL AS has_stations,
                       row_number() OVER (PARTITION BY local_unit_id, o.district_set_id ORDER BY common DESC) AS rank,
                       row_number() OVER (PARTITION BY district_unit_id ORDER BY common DESC) AS district_rank
                FROM overlap o
                LEFT JOIN sets_with_stations s ON s.district_set_id = o.district_set_id
            )
            INSERT INTO district_membership (local_unit_id, district_unit_id, source_id)
            SELECT local_unit_id, district_unit_id, %(sid)s
            FROM ranked
            WHERE rank = 1 OR (NOT has_stations AND (district_rank = 1 OR share >= %(min_share)s))
            """,
            {"sid": source_id, "min_share": MIN_SHARE},
        ).rowcount
    return {"district_membership (polling stations)": from_stations, "district_membership (spatial)": spatial}
