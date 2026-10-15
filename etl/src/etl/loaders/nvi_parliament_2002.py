"""NVI parliamentary election, 7 and 21 April 2002 (176 single-member districts, set 1990).
Polling-station level, two rounds.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/2002_parlamenti/2002_parlamenti/
     1_ford/ and 2_ford/: egy_szkf.txt, lis_szkf.txt, egy_szkt.txt, lis_szkt.txt  (cp1250, '|')
     Station numbers have four digits; Budapest districts are written 'BUDAPEST  01'.
     Fidesz and MDF ran a joint list.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, load_election, nvi_source
from ._nvi_parliament_txt import clean_txt

ELECTION_ID = "parliament-2002"
ELECTION_DAY = date.fromisoformat("2002-04-07")
SOURCE_DIR = "nvi_parliament_2002"
RAW = ARCHIVE / "2002_parlamenti" / "2002_parlamenti"
SOURCE = nvi_source(2002, "egy_szkf.txt, lis_szkf.txt, egy_szkt.txt, lis_szkt.txt (both rounds)")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    return clean_txt(2002, raw_dir / RAW, interim_dir, interim_dir / SOURCE_DIR, ELECTION_DAY)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
