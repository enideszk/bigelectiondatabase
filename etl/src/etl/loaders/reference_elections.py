"""Curated reference: elections, their rounds and district sets (data/reference/elections.csv,
election_rounds.csv), and the national "mail votes" special unit that results by mail are stored at.

Requires: reference_regions, oevk_maps (district sets).
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from .. import config
from ._common import SourceInfo, copy_csv, copy_rows, replace_source

SOURCE = SourceInfo(
    name="Curated reference: elections",
    publisher="hu-data-platform (hand-maintained)",
    file_name="data/reference/elections.csv, data/reference/election_rounds.csv",
)

REFERENCE_DIR = config.REPO_ROOT / "data" / "reference"


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    """Nothing to clean: the reference files are maintained in their final shape."""
    return []


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        counts = {
            "unit (special-mail)": copy_rows(conn, "unit", ["unit_id", "unit_type", "code", "name", "name_en", "source_id"],
                                             [["special-mail", "special", "mail", "Levélszavazatok", "Mail votes", source_id]]),
            "unit_parent": copy_rows(conn, "unit_parent", ["child_unit_id", "parent_unit_id", "source_id"],
                                     [["special-mail", "country-HU", source_id]]),
            "election": copy_csv(conn, "election", REFERENCE_DIR / "elections.csv", source_id),
            "election_round": copy_csv(conn, "election_round", REFERENCE_DIR / "election_rounds.csv", source_id),
        }
    return counts
