"""Settlement, county and country boundaries, 2026, from OpenStreetMap (prepared as a GeoPackage).

Raw:      data/raw/magyarorszag_telepulesek_2026/magyarorszag_telepulesek.gpkg
          layers telepulesek (3,154 settlements + 23 Budapest districts), megyek (20), orszag (1); EPSG:4326
Interim:  data/interim/osm_boundaries_2026/boundaries.geojson  (with unit_id)

OSM has no KSH codes, so polygons are matched to the KSH Helységnévtár by name (unique nationally)
and Budapest districts by number. Járás and NUTS shapes are the union of their settlements.
These are today's boundaries; they are used for every election until historical boundaries exist.

Requires: reference_regions, ksh_helysegnevtar (its clean step writes the names matched against).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import geopandas as gpd
import pandas as pd
import psycopg

from .. import config
from ..hu_names import bp_district_number, county_key, name_key
from ._common import SourceInfo, load_geojson_geometries, read_csv, replace_source

SOURCE = SourceInfo(
    name="OpenStreetMap boundaries 2026",
    publisher="OpenStreetMap contributors (GeoPackage prepared by the project owner)",
    url="https://www.openstreetmap.org/",
    file_name="magyarorszag_telepulesek.gpkg",
    downloaded_on=date(2026, 10, 12),
    license="ODbL 1.0 — © OpenStreetMap contributors",
    notes="admin_level 8 (settlements) and 9 (Budapest districts); counties and country outline.",
)

SOURCE_DIR = "osm_boundaries_2026"
GPKG = Path("magyarorszag_telepulesek_2026") / "magyarorszag_telepulesek.gpkg"


class UnmatchedNames(ValueError):
    pass


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    hnt = read_csv(interim_dir / "ksh_helysegnevtar_2026" / "settlements.csv")
    by_name = {name_key(s["name"]): f"settlement-{s['code']}" for s in hnt if s["unit_type"] == "settlement"}
    by_district = {bp_district_number(s["name"]): f"bp_district-{s['code']}" for s in hnt if s["unit_type"] == "bp_district"}
    counties = {county_key(c["name"]): f"county-{c['code']}" for c in read_csv(config.REPO_ROOT / "data" / "reference" / "counties.csv")}

    gpkg = raw_dir / GPKG
    settlements = gpd.read_file(gpkg, layer="telepulesek")
    settlements["unit_id"] = [
        by_district.get(bp_district_number(n)) if szint == "9" else by_name.get(name_key(n))
        for n, szint in zip(settlements["name"], settlements["szint"])
    ]
    county_shapes = gpd.read_file(gpkg, layer="megyek")
    county_shapes["unit_id"] = county_shapes["megye"].map(lambda m: counties.get(county_key(m)))
    country = gpd.read_file(gpkg, layer="orszag").assign(unit_id="country-HU")

    unmatched = list(settlements.loc[settlements["unit_id"].isna(), "name"]) + list(county_shapes.loc[county_shapes["unit_id"].isna(), "megye"])
    if unmatched:
        raise UnmatchedNames(f"{len(unmatched)} polygons match no unit: {unmatched[:20]}")
    duplicated = settlements["unit_id"][settlements["unit_id"].duplicated()].tolist()
    if duplicated:
        raise UnmatchedNames(f"several polygons for the same unit: {duplicated[:20]}")

    out = gpd.GeoDataFrame(
        pd.concat([settlements[["unit_id", "geometry"]], county_shapes[["unit_id", "geometry"]], country[["unit_id", "geometry"]]], ignore_index=True),
        crs="EPSG:4326",
    )
    out["valid_from"] = None
    out["valid_to"] = None
    out_dir = interim_dir / SOURCE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "boundaries.geojson"
    out.to_file(path, driver="GeoJSON")
    return [path]


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        counts = {"unit_geometry": load_geojson_geometries(conn, interim_dir / SOURCE_DIR / "boundaries.geojson", source_id)}
        # Járás and NUTS shapes: union of the settlements that belong to them on the unit's own
        # last day (HU10 existed until 2018, so its members are taken as of 2017-12-31).
        counts["unit_geometry (derived)"] = conn.execute(
            """
            INSERT INTO unit_geometry (unit_id, valid_from, valid_to, geom, source_id)
            SELECT u.unit_id, u.valid_from, u.valid_to,
                   ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(g.geom)), 3)), %(sid)s
            FROM unit u
            JOIN v_unit_ancestor a
              ON a.ancestor_id = u.unit_id
             AND a.period @> COALESCE(u.valid_to - 1, CURRENT_DATE)
            JOIN unit l ON l.unit_id = a.unit_id AND l.unit_type IN ('settlement', 'bp_district')
            JOIN unit_geometry g ON g.unit_id = l.unit_id AND g.source_id = %(sid)s
            WHERE u.unit_type IN ('jaras', 'nuts2', 'nuts1')
            GROUP BY u.unit_id, u.valid_from, u.valid_to
            """,
            {"sid": source_id},
        ).rowcount
    return counts
