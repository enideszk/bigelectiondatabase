"""KSH Helységnévtár (gazetteer), state of 1 January 2026: settlements, Budapest districts, járások,
plus population, area and dwellings as indicators.

Raw:      data/raw/ksh_helysegnevtar_2026/hnt_letoltes_2026.xlsx  (sheet "Helységek 2026.01.01.")
Interim:  data/interim/ksh_helysegnevtar_2026/{settlements,jarasok}.csv

Units are keyed by the 5-digit KSH settlement code, Budapest districts too (bp_district-<KSH code>).
Budapest as a whole is the county unit county-01. Járások exist from 2013-01-01: before that a
settlement's parent is its county. The járás assignment of 2026 is applied from 2013 onwards
(later changes of a settlement's járás are not modelled yet). Settlements that belonged to another
county before (data/reference/settlement_counties.csv, from the 1990–2010 election files) have
that county as their parent until then.

Requires: reference_regions (counties).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from pathlib import Path

import pandas as pd
import psycopg

from .. import config
from ..hu_names import county_key, name_key
from ._common import SourceInfo, copy_rows, read_csv, replace_source

SOURCE = SourceInfo(
    name="KSH Helységnévtár 2026",
    publisher="Központi Statisztikai Hivatal (KSH)",
    url="https://www.ksh.hu/apps/hntr.main",
    file_name="hnt_letoltes_2026.xlsx",
    downloaded_on=date(2026, 10, 14),
    license="KSH data, free to reuse with attribution",
    notes="State of 1 January 2026. Population, area and dwellings as listed in the gazetteer.",
)

SOURCE_DIR = "ksh_helysegnevtar_2026"
JARAS_FROM = "2013-01-01"
INDICATOR_YEAR = 2026

INDICATORS = [
    # id, English name, Hungarian name, unit, decimals, description
    ("population", "Population", "Lakónépesség", "persons", 0, "Resident population as listed in the KSH Helységnévtár 2026."),
    ("area_km2", "Area", "Terület", "km²", 1, "Area as listed in the KSH Helységnévtár 2026 (hectares / 100)."),
    ("dwellings", "Dwellings", "Lakások száma", "dwellings", 0, "Number of dwellings as listed in the KSH Helységnévtár 2026."),
]


def county_history() -> dict[str, list[tuple[str, date]]]:
    """data/reference/settlement_counties.csv: settlement name key -> [(earlier county code, until)],
    oldest first; the settlement belonged to that county before `until`."""
    history: dict[str, list[tuple[str, date]]] = defaultdict(list)
    for row in read_csv(config.REPO_ROOT / "data" / "reference" / "settlement_counties.csv"):
        history[name_key(row["settlement"])].append((row["county_code"], date.fromisoformat(row["valid_to"])))
    for periods in history.values():
        periods.sort(key=lambda p: p[1])
    return dict(history)


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    hnt = pd.read_excel(raw_dir / SOURCE_DIR / "hnt_letoltes_2026.xlsx", sheet_name=0, header=2, dtype=str)
    hnt.columns = [" ".join(str(c).split()) for c in hnt.columns]
    hnt = hnt[hnt["Helység KSH kódja"].notna()].copy()
    for col in hnt.columns:
        hnt[col] = hnt[col].str.strip()

    counties = {county_key(c["name"]): c["code"] for c in read_csv(config.REPO_ROOT / "data" / "reference" / "counties.csv")}
    counties["főváros"] = "01"

    is_bp_district = hnt["Helység jogállása"] == "fővárosi kerület"
    hnt = hnt[hnt["Helység jogállása"] != "főváros"]  # Budapest as a whole = county-01
    out = pd.DataFrame(
        {
            "unit_type": is_bp_district.loc[hnt.index].map({True: "bp_district", False: "settlement"}),
            "code": hnt["Helység KSH kódja"].str.zfill(5),
            "name": hnt["Helység megnevezése"].str.strip(),
            "status": hnt["Helység jogállása"],
            "county_code": hnt["Megye megnevezése"].map(lambda m: counties[county_key(m)]),
            "jaras_code": hnt["Járás kódja"].str[:3].where(~is_bp_district.loc[hnt.index]),
            "population": pd.to_numeric(hnt["Lakó-népesség"], errors="coerce"),
            "area_km2": pd.to_numeric(hnt["Terület (hektár)"], errors="coerce") / 100,
            "dwellings": pd.to_numeric(hnt["Lakások száma"], errors="coerce"),
        }
    )
    # Budapest districts as "Budapest I. kerület" (the KSH file says "Budapest 01. ker.")
    roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI",
             "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII"]
    bp = out["unit_type"] == "bp_district"
    out.loc[bp, "name"] = out.loc[bp, "name"].str.extract(r"(\d+)")[0].astype(int).map(lambda n: f"Budapest {roman[n - 1]}. kerület")

    jarasok = (
        hnt.loc[~is_bp_district.loc[hnt.index]]
        .assign(code=lambda d: d["Járás kódja"].str[:3], county_code=out["county_code"])
        .groupby("code", as_index=False)
        .agg(name=("Járás neve", "first"), seat=("Járás székhelye", "first"), county_code=("county_code", "first"))
    )
    jarasok["name"] = jarasok["name"].str.strip() + " járás"

    out_dir = interim_dir / SOURCE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = [out_dir / "settlements.csv", out_dir / "jarasok.csv"]
    out.to_csv(paths[0], index=False, encoding="utf-8")
    jarasok.to_csv(paths[1], index=False, encoding="utf-8")
    return paths


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    settlements = read_csv(interim_dir / SOURCE_DIR / "settlements.csv")
    jarasok = read_csv(interim_dir / SOURCE_DIR / "jarasok.csv")

    units = [[f"jaras-{j['code']}", "jaras", j["code"], j["name"], None, JARAS_FROM, None] for j in jarasok]
    units += [[f"{s['unit_type']}-{s['code']}", s["unit_type"], s["code"], s["name"], None, None, None] for s in settlements]

    history = county_history()
    unknown = set(history) - {name_key(s["name"]) for s in settlements}
    if unknown:
        raise ValueError(f"settlement_counties.csv names settlements the gazetteer does not have: {sorted(unknown)}")
    parents = [[f"jaras-{j['code']}", f"county-{j['county_code']}", JARAS_FROM, None] for j in jarasok]
    for s in settlements:
        unit_id = f"{s['unit_type']}-{s['code']}"
        if s["unit_type"] == "bp_district":
            parents.append([unit_id, "county-01", None, None])
        else:
            start = None
            for county_code, until in history.get(name_key(s["name"]), []):
                parents.append([unit_id, f"county-{county_code}", start, until])
                start = until
            parents.append([unit_id, f"county-{s['county_code']}", start, JARAS_FROM])
            parents.append([unit_id, f"jaras-{s['jaras_code']}", JARAS_FROM, None])

    values = [
        [f"{s['unit_type']}-{s['code']}", ind_id, INDICATOR_YEAR, s[ind_id]]
        for s in settlements
        for ind_id, *_ in INDICATORS
        if s[ind_id] is not None
    ]

    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        counts = {
            "unit": copy_rows(conn, "unit", ["unit_id", "unit_type", "code", "name", "name_en", "valid_from", "valid_to", "source_id"],
                              [u + [source_id] for u in units]),
            "unit_parent": copy_rows(conn, "unit_parent", ["child_unit_id", "parent_unit_id", "valid_from", "valid_to", "source_id"],
                                     [p + [source_id] for p in parents]),
            "indicator": copy_rows(conn, "indicator", ["indicator_id", "name_en", "name_hu", "unit_of_measure", "decimals", "description", "source_id"],
                                   [list(i) + [source_id] for i in INDICATORS]),
            "indicator_value": copy_rows(conn, "indicator_value", ["unit_id", "indicator_id", "year", "value", "source_id"],
                                         [v + [source_id] for v in values]),
        }
        # Every indicator here is additive, so járás, county, region and country values are sums.
        aggregated = conn.execute(
            """
            INSERT INTO indicator_value (unit_id, indicator_id, year, value, source_id)
            SELECT a.ancestor_id, v.indicator_id, v.year, sum(v.value), %(sid)s
            FROM indicator_value v
            JOIN v_unit_ancestor a ON a.unit_id = v.unit_id AND a.period @> %(day)s::date
            WHERE v.source_id = %(sid)s
            GROUP BY a.ancestor_id, v.indicator_id, v.year
            """,
            {"sid": source_id, "day": f"{INDICATOR_YEAR}-01-01"},
        ).rowcount
        counts["indicator_value (aggregated)"] = aggregated
    return counts
