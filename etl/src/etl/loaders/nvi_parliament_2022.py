"""NVI parliamentary election, 3 April 2022 (OEVK set 2011). Polling-station level, one round.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/2022_parlamenti/
     Listás_szavazás_szkjkv.xlsx (party + nationality lists), Egyéni_szavazás_szkjkv.xlsx,
     Levélben_leadott_szavazatok_számlálási_jkv.xlsx  (same row layout as the 2014/2018 csv files)
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, clean_ft, load_election, nvi_source

ELECTION_ID = "parliament-2022"
SOURCE_DIR = "nvi_parliament_2022"
RAW = ARCHIVE / "2022_parlamenti"
SOURCE = nvi_source(2022, "Listás_szavazás_szkjkv.xlsx, Egyéni_szavazás_szkjkv.xlsx, Levélben_leadott_szavazatok_számlálási_jkv.xlsx")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    base = raw_dir / RAW
    return clean_ft(base / "Listás_szavazás_szkjkv.xlsx", base / "Egyéni_szavazás_szkjkv.xlsx", base / "Levélben_leadott_szavazatok_számlálási_jkv.xlsx",
                    interim_dir, interim_dir / SOURCE_DIR)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
