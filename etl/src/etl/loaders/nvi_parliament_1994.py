"""NVI parliamentary election, 8 and 29 May 1994 (176 single-member districts, set 1990).
Polling-station level, two rounds.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/1994_parlamenti/1994_parlamenti/
     szkf.txt (station headers: both ballots and rounds), egy_szkt.txt, lis_szkt.txt  (cp1250, '|')
     Counties numbered alphabetically. Kerepestarcsa still one settlement.
     In two second-round races the station file puts the candidates' names in Hungarian
     alphabetical order (Pécsi before Pető, Csontos before Czuczi) while the votes follow the
     ballot (the first round's order, as NVI's district results oevk_jkv_tetel.txt have it), so
     the two candidates get each other's votes: SWAPPED gives them back.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, load_election, nvi_source
from ._nvi_parliament_txt import clean_txt

ELECTION_ID = "parliament-1994"
ELECTION_DAY = date.fromisoformat("1994-05-08")
SOURCE_DIR = "nvi_parliament_1994"
RAW = ARCHIVE / "1994_parlamenti" / "1994_parlamenti"
SOURCE = nvi_source(1994, "szkf.txt, egy_szkt.txt, lis_szkt.txt")
# (round, county code, district, candidate, candidate)
SWAPPED = (
    (2, "01", 22, "Dr. Pető Iván", "Pécsi Ildikó"),           # official: Pécsi 14,599, Pető 13,417
    (2, "16", 5, "Dr. Csontos Miklós", "Farkas Imre"),        # official: Farkas 10,846, Csontos 3,989
)


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    return clean_txt(1994, raw_dir / RAW, interim_dir, interim_dir / SOURCE_DIR, ELECTION_DAY, SWAPPED)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
