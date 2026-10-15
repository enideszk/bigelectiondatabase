"""NVI parliamentary election, 25 March and 8 April 1990 (176 single-member districts, set 1990).
Polling-station level, two rounds.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/1990_parlamenti/1990_parlamenti/
     szkf.txt (station headers: both ballots and rounds), egy_szkt.txt, lis_szkt.txt  (cp1250, '|')
     No ballot positions. Counties are numbered in KSH order. Candidates' organisations in one
     field (joint candidates as 'FIDESZ-SZDSZ'); several joint villages of 1990 split later
     (data/reference/settlement_names.csv).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, load_election, nvi_source
from ._nvi_parliament_txt import clean_txt

ELECTION_ID = "parliament-1990"
ELECTION_DAY = date.fromisoformat("1990-03-25")
SOURCE_DIR = "nvi_parliament_1990"
RAW = ARCHIVE / "1990_parlamenti" / "1990_parlamenti"
SOURCE = nvi_source(1990, "szkf.txt, egy_szkt.txt, lis_szkt.txt")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    return clean_txt(1990, raw_dir / RAW, interim_dir, interim_dir / SOURCE_DIR, ELECTION_DAY)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
