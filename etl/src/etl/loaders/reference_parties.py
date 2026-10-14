"""Curated reference: parties (data/reference/parties.csv).

Party ids are stable across renames and elections. The election loaders map NVI's list names and
nominating organisations to these ids through data/reference/party_aliases.csv; a name missing
there stops the load and is reported, so new elections add rows there (and here) first.
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from .. import config
from ._common import SourceInfo, copy_csv, replace_source

SOURCE = SourceInfo(
    name="Curated reference: parties",
    publisher="hu-data-platform (hand-maintained)",
    file_name="data/reference/parties.csv",
    notes="Colours are the project's choice; review them in data/reference/parties.csv.",
)

REFERENCE_DIR = config.REPO_ROOT / "data" / "reference"


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    """Nothing to clean: the reference files are maintained in their final shape."""
    return []


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    with conn.transaction():
        source_id = replace_source(conn, SOURCE)
        return {"party": copy_csv(conn, "party", REFERENCE_DIR / "parties.csv", source_id)}
