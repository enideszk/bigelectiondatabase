"""Single-member electoral district (OEVK) maps for the three district sets, and which settlements
belong to which district.

Raw:      data/raw/oevk_terkepek/{1990,2014,2022,2026}_oevk.geojson  (EPSG:4326, one property: name,
          e.g. "Budapest 01", "Csongrád 03")
Interim:  data/interim/oevk_maps/{districts.csv,districts.geojson}

District sets:
  '1990'  176 districts, used 1990–2010                      <- 1990_oevk.geojson
  '2011'  106 OEVK (Act CCIII of 2011), used 2014–2022        <- 2022_oevk.geojson
          (2014_oevk.geojson has identical geometry; only "Csongrád" became "Csongrád-Csanád")
  '2024'  106 OEVK as redrawn in 2024 (Budapest 18 -> 16, Pest 12 -> 14), used from 2026
                                                              <- 2026_oevk.geojson
The sets' start/end dates are approximate (any date between the last election of one set and the
first of the next works: the map selects districts by set, not by date).

Membership (settlement / Budapest district -> district) is derived spatially and is PROVISIONAL:
a unit belongs to the districts of its own county holding at least 10% of its area, and always to
the one holding most of it, so split cities get several districts. Polling-station data from the
election loaders is authoritative and will replace this once elections are loaded.

Requires: reference_regions, ksh_helysegnevtar, osm_boundaries_2026.
"""

from __future__ import annotations

import re
from pathlib import Path

import geopandas as gpd
import pandas as pd
import psycopg

from .. import config
from ..hu_names import county_key
from ._common import SourceInfo, copy_rows, load_geojson_geometries, read_csv, replace_source

SOURCE = SourceInfo(
    name="OEVK maps 1990, 2011, 2024",
    publisher="Provided by the project owner (oevk_maps)",
    file_name="1990_oevk.geojson, 2022_oevk.geojson, 2026_oevk.geojson",
    notes="2014_oevk.geojson is geometrically identical to 2022_oevk.geojson and is not loaded.",
)

SOURCE_DIR = "oevk_maps"
RAW_DIR = "oevk_terkepek"
# The OSM settlement map and the district maps come from different base data, so slivers of a few
# percent appear along borders; a second district needs at least this share of the unit's area.
MIN_SHARE = 0.10

# set id, raw file, name, valid_from, valid_to
SETS = [
    ("1990", "1990_oevk.geojson", "Single-member districts 1990–2010 (176)", None, "2012-01-01"),
    ("2011", "2022_oevk.geojson", "OEVK 2014–2022 (106, Act CCIII of 2011)", "2012-01-01", "2024-01-01"),
    ("2024", "2026_oevk.geojson", "OEVK from 2026 (106, redrawn in 2024)", "2024-01-01", None),
]
NAME = re.compile(r"^(?P<county>.+?)\s+(?P<number>\d{1,2})$")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    counties = {county_key(c["name"]): c for c in read_csv(config.REPO_ROOT / "data" / "reference" / "counties.csv")}
    rows, shapes = [], []
    for set_id, file_name, _, valid_from, valid_to in SETS:
        g = gpd.read_file(raw_dir / RAW_DIR / file_name)
        for name, geom in zip(g["name"], g.geometry):
            m = NAME.match(name.strip())
            county = counties.get(county_key(m.group("county"))) if m else None
            if county is None:
                raise ValueError(f"{file_name}: cannot read county and number from district name {name!r}")
            number = int(m.group("number"))
            unit_id = f"smd-{set_id}-{county['code']}-{number:02d}"
            rows.append({"unit_id": unit_id, "district_set_id": set_id, "county_code": county["code"], "number": number,
                         "name": f"{county['name']} {number:02d}", "valid_from": valid_from, "valid_to": valid_to})
            shapes.append({"unit_id": unit_id, "valid_from": valid_from, "valid_to": valid_to, "geometry": geom})
    districts = pd.DataFrame(rows)
    duplicated = districts["unit_id"][districts["unit_id"].duplicated()].tolist()
    if duplicated:
        raise ValueError(f"duplicate districts: {duplicated}")

    out_dir = interim_dir / SOURCE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / "districts.csv", out_dir / "districts.geojson"]
    districts.to_csv(paths[0], index=False, encoding="utf-8")
    gpd.GeoDataFrame(shapes, crs="EPSG:4326").to_file(paths[1], driver="GeoJSON")
    return paths


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    districts = read_csv(interim_dir / SOURCE_DIR / "districts.csv")
    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        counts = {
            "district_set": copy_rows(conn, "district_set", ["district_set_id", "name", "valid_from", "valid_to", "source_id"],
                                      [[s, name, vf, vt, source_id] for s, _, name, vf, vt in SETS]),
            "unit": copy_rows(conn, "unit", ["unit_id", "unit_type", "code", "name", "valid_from", "valid_to", "source_id"],
                              [[d["unit_id"], "smd", d["unit_id"].removeprefix("smd-"), d["name"], d["valid_from"], d["valid_to"], source_id]
                               for d in districts]),
            "electoral_district": copy_rows(conn, "electoral_district", ["unit_id", "district_set_id", "county_unit_id", "number", "source_id"],
                                            [[d["unit_id"], d["district_set_id"], f"county-{d['county_code']}", d["number"], source_id]
                                             for d in districts]),
        }
        counts["unit_geometry"] = load_geojson_geometries(conn, interim_dir / SOURCE_DIR / "districts.geojson", source_id)
        counts["district_membership"] = conn.execute(
            """
            WITH local_county AS (
                SELECT a.unit_id, a.ancestor_id AS county_unit_id
                FROM v_unit_ancestor a
                JOIN unit c ON c.unit_id = a.ancestor_id AND c.unit_type = 'county'
                WHERE a.period @> CURRENT_DATE
            ),
            overlap AS (
                SELECT l.unit_id AS local_unit_id, d.unit_id AS district_unit_id, ed.district_set_id,
                       ST_Area(ST_Intersection(lg.geom, dg.geom)) / NULLIF(ST_Area(lg.geom), 0) AS share
                FROM unit l
                JOIN local_county lc ON lc.unit_id = l.unit_id
                JOIN unit_geometry lg ON lg.unit_id = l.unit_id
                JOIN unit_geometry dg ON dg.source_id = %(sid)s AND dg.geom && lg.geom
                JOIN unit d ON d.unit_id = dg.unit_id
                JOIN electoral_district ed ON ed.unit_id = d.unit_id AND ed.county_unit_id = lc.county_unit_id  -- districts never cross counties
                WHERE l.unit_type IN ('settlement', 'bp_district')
            ),
            ranked AS (
                SELECT *, row_number() OVER (PARTITION BY local_unit_id, district_set_id ORDER BY share DESC) AS rank
                FROM overlap
            )
            INSERT INTO district_membership (local_unit_id, district_unit_id, source_id)
            SELECT local_unit_id, district_unit_id, %(sid)s
            FROM ranked
            WHERE rank = 1 OR share >= %(min_share)s
            """,
            {"sid": source_id, "min_share": MIN_SHARE},
        ).rowcount
    return counts
