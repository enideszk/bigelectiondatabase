"""NVI parliamentary election, 10 and 24 May 1998 (176 single-member districts, set 1990).
Polling-station level, two rounds.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/1998_parlamenti/1998_parlamenti/
     szkf.txt (station headers: both ballots and rounds), egy_szkt.txt, lis_szkt.txt  (cp1250, '|')
     A second round of the county lists in some counties (round 2, list ballot).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, load_election, nvi_source
from ._nvi_parliament_txt import clean_txt

ELECTION_ID = "parliament-1998"
ELECTION_DAY = date.fromisoformat("1998-05-10")
SOURCE_DIR = "nvi_parliament_1998"
RAW = ARCHIVE / "1998_parlamenti" / "1998_parlamenti"
SOURCE = nvi_source(1998, "szkf.txt, egy_szkt.txt, lis_szkt.txt")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    return clean_txt(1998, raw_dir / RAW, interim_dir, interim_dir / SOURCE_DIR, ELECTION_DAY)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
