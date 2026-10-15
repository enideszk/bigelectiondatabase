"""NVI parliamentary election, 11 and 25 April 2010 (176 single-member districts, set 1990).
Polling-station level, two rounds.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/2010_parlamenti/2010_parlamenti/
     txt_1ford/ and txt_2ford/: egy_szkf.txt, lis_szkf.txt, egy_szkt.txt, lis_szkt.txt  (cp1250, '|')
     Votes cast abroad are counted at 'Külképviseleti' stations. Lists name their organisations.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, load_election, nvi_source
from ._nvi_parliament_txt import clean_txt

ELECTION_ID = "parliament-2010"
ELECTION_DAY = date.fromisoformat("2010-04-11")
SOURCE_DIR = "nvi_parliament_2010"
RAW = ARCHIVE / "2010_parlamenti" / "2010_parlamenti"
SOURCE = nvi_source(2010, "egy_szkf.txt, lis_szkf.txt, egy_szkt.txt, lis_szkt.txt (both rounds)")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    return clean_txt(2010, raw_dir / RAW, interim_dir, interim_dir / SOURCE_DIR, ELECTION_DAY)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
