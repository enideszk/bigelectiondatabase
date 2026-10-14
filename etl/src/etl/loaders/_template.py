"""TEMPLATE for a new loader. Copy this file, rename it after the source, fill in the TODOs.

Step by step: docs/adding-a-source.md. The short version:

    1. Put the untouched download in data/raw/<source_dir>/ (never edit it).
    2. clean():  raw -> tidy CSV files in data/interim/<source_dir>/ whose column names match
                 the database tables. All renaming, recoding and fixing happens here, in pandas.
    3. load():   interim CSVs -> database, inside ONE transaction, all rows tagged with source_id.
    4. Register the module in loaders/__init__.py, then:  .\\etl load <name>   and   .\\etl check

Example below: a fictional settlement-level results file for one election with columns
    "KSH kód", "Választópolgárok", "Megjelentek", "Érvénytelen", "<list name 1>", "<list name 2>", ...
Adapt freely; keep the clean/load split and the source handling.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd
import psycopg

from ._common import SourceInfo, copy_rows, read_csv, replace_source

# TODO: describe the source. `name` must be unique and stable: reloading replaces earlier rows.
SOURCE = SourceInfo(
    name="TODO publisher - dataset - year",
    publisher="TODO e.g. Nemzeti Választási Iroda",
    url="TODO https://...",
    file_name="TODO original file name",
    downloaded_on=date(2026, 1, 1),  # TODO
    license="TODO",
    notes="TODO anything a future reader needs to know (known errors, coverage gaps)",
)

SOURCE_DIR = "todo_source_dir"        # TODO folder name under data/raw/ and data/interim/
ELECTION_ID = "parliament-2022"       # TODO must already exist in the election table


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    """Raw download -> tidy long-format CSVs. No database access here."""
    raw = pd.read_csv(raw_dir / SOURCE_DIR / "TODO.csv", dtype={"KSH kód": str})  # or pd.read_excel(...)
    out_dir = interim_dir / SOURCE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    df = raw.rename(columns={"KSH kód": "code", "Választópolgárok": "registered",
                             "Megjelentek": "voted", "Érvénytelen": "invalid"})
    df["unit_id"] = "settlement-" + df["code"].str.zfill(5)

    turnout = df[["unit_id", "registered", "voted", "invalid"]].copy()
    turnout["valid"] = turnout["voted"] - turnout["invalid"]

    list_columns = [c for c in df.columns if c not in ("code", "unit_id", "registered", "voted", "invalid")]
    votes = df.melt(id_vars="unit_id", value_vars=list_columns, var_name="list_name", value_name="votes")

    paths = [out_dir / "turnout.csv", out_dir / "list_results.csv"]
    turnout.to_csv(paths[0], index=False)
    votes.to_csv(paths[1], index=False)
    return paths


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    """Interim CSVs -> database, in one transaction (a failure leaves the old data untouched)."""
    in_dir = interim_dir / SOURCE_DIR
    turnout = read_csv(in_dir / "turnout.csv")
    votes = read_csv(in_dir / "list_results.csv")

    with conn.transaction():
        source_id = replace_source(conn, SOURCE)

        # Look up ids by natural keys instead of hard-coding them.
        list_ids = dict(conn.execute(
            "SELECT name, list_id FROM party_list WHERE election_id = %s", (ELECTION_ID,)).fetchall())
        unknown = {r["list_name"] for r in votes} - list_ids.keys()
        if unknown:
            raise ValueError(f"Lists missing from party_list for {ELECTION_ID}: {sorted(unknown)}")

        counts = {
            "turnout": copy_rows(
                conn, "turnout",
                ["election_id", "round_no", "unit_id", "ballot", "registered", "voted", "valid", "invalid", "source_id"],
                ([ELECTION_ID, 1, r["unit_id"], "list", r["registered"], r["voted"], r["valid"], r["invalid"], source_id]
                 for r in turnout),
            ),
            "list_result": copy_rows(
                conn, "list_result",
                ["election_id", "round_no", "unit_id", "list_id", "votes", "source_id"],
                ([ELECTION_ID, 1, r["unit_id"], list_ids[r["list_name"]], r["votes"], source_id] for r in votes),
            ),
        }
    return counts
