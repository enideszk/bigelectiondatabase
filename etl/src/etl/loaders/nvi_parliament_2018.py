"""NVI parliamentary election, 8 April 2018 (OEVK set 2011). Polling-station level, one round.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/2018_parlamenti/2018_parlamenti/
     Listás_szavazás_szkjkv_teljes_nemz.csv (party + nationality lists), Egyéni_szavazás_szkjkv.csv,
     Levélben_szavazás_jkv.csv  (utf-8, ';'). Organisations are written out in full.
"""

from __future__ import annotations

from pathlib import Path

import psycopg

from ._nvi_parliament import ARCHIVE, clean_ft, load_election, nvi_source

ELECTION_ID = "parliament-2018"
SOURCE_DIR = "nvi_parliament_2018"
RAW = ARCHIVE / "2018_parlamenti" / "2018_parlamenti"
SOURCE = nvi_source(2018, "Listás_szavazás_szkjkv_teljes_nemz.csv, Egyéni_szavazás_szkjkv.csv, Levélben_szavazás_jkv.csv")


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    base = raw_dir / RAW
    return clean_ft(base / "Listás_szavazás_szkjkv_teljes_nemz.csv", base / "Egyéni_szavazás_szkjkv.csv", base / "Levélben_szavazás_jkv.csv",
                    interim_dir, interim_dir / SOURCE_DIR)


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
