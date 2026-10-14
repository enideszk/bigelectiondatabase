"""Curated reference: the country, NUTS 1 / NUTS 2 regions and the 20 counties (data/reference/).

Counties use the KSH county codes 01–20 (01 = Budapest), the same numbering the 1990s election files
use as MAZ. NUTS 2: Budapest and Pest formed one region (HU10) until 2018, HU11 and HU12 since.
Must be loaded before every other source (they all hang their units below these).
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from .. import config
from ._common import SourceInfo, copy_rows, read_csv, replace_source

SOURCE = SourceInfo(
    name="Curated reference: country, NUTS regions, counties",
    publisher="hu-data-platform (hand-maintained)",
    file_name="data/reference/regions.csv, data/reference/counties.csv",
    notes="NUTS 2021 codes; HU10 until 2018-01-01. Csongrád renamed Csongrád-Csanád on 2020-06-04.",
)

REFERENCE_DIR = config.REPO_ROOT / "data" / "reference"
NUTS_SPLIT = "2018-01-01"


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    """Nothing to clean: the reference files are maintained in their final shape."""
    return []


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    regions = read_csv(REFERENCE_DIR / "regions.csv")
    counties = read_csv(REFERENCE_DIR / "counties.csv")
    units, parents, names = [], [], []
    for r in regions:
        unit_id = f"{r['unit_type']}-{r['code']}"
        units.append([unit_id, r["unit_type"], r["code"], r["name"], r["name_en"], r["valid_from"], r["valid_to"]])
        if r["parent_code"]:
            parent_type = {"nuts1": "country", "nuts2": "nuts1"}[r["unit_type"]]
            parents.append([unit_id, f"{parent_type}-{r['parent_code']}", r["valid_from"], r["valid_to"]])
    for c in counties:
        unit_id = f"county-{c['code']}"
        units.append([unit_id, "county", c["code"], c["name"], None, None, None])
        if c["nuts2_before_2018"]:
            parents.append([unit_id, f"nuts2-{c['nuts2_before_2018']}", None, NUTS_SPLIT])
            parents.append([unit_id, f"nuts2-{c['nuts2']}", NUTS_SPLIT, None])
        else:
            parents.append([unit_id, f"nuts2-{c['nuts2']}", None, None])
        if c["former_name"]:
            names.append([unit_id, c["former_name"], None, c["renamed_on"]])

    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        counts = {
            "unit": copy_rows(conn, "unit", ["unit_id", "unit_type", "code", "name", "name_en", "valid_from", "valid_to", "source_id"],
                              [u + [source_id] for u in units]),
            "unit_parent": copy_rows(conn, "unit_parent", ["child_unit_id", "parent_unit_id", "valid_from", "valid_to", "source_id"],
                                     [p + [source_id] for p in parents]),
            "unit_name": copy_rows(conn, "unit_name", ["unit_id", "name", "valid_from", "valid_to", "source_id"],
                                   [n + [source_id] for n in names]),
        }
    return counts
