"""NVI parliamentary election, 6 April 2014 (OEVK set 2011). Polling-station level, one round.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/2014_parlamenti/2014_parlamenti/
     Listás-szavazás-jkv.csv, Egyéni-szavazás-jkv.csv, Levélben-szavazás-jkv.csv  (cp1250, ',')
     Candidates' organisations are abbreviations ("FIDESZ-KDNP", "SMS", "Független").
     No nationality lists in this export.
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, clean_ft, load_election, nvi_source

ELECTION_ID = "parliament-2014"
SOURCE_DIR = "nvi_parliament_2014"
RAW = ARCHIVE / "2014_parlamenti" / "2014_parlamenti"
SOURCE = nvi_source(2014, "Listás-szavazás-jkv.csv, Egyéni-szavazás-jkv.csv, Levélben-szavazás-jkv.csv")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    base = raw_dir / RAW
    return clean_ft(base / "Listás-szavazás-jkv.csv", base / "Egyéni-szavazás-jkv.csv", base / "Levélben-szavazás-jkv.csv",
                    interim_dir, interim_dir / SOURCE_DIR)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
