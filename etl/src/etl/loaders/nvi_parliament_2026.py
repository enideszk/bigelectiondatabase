"""NVI parliamentary election, 12 April 2026 (OEVK set 2024). Polling-station level, one round.

Raw: data/raw/valasztasi_eredmenyek_1990-2024/2026_parlamenti/
     listas/<county> listás 2026.xls    sheets: Paraméterek (record fields, list numbering),
                                        <COUNTY> (one row per station, one column per list),
                                        <COUNTY> nemz (nationality ballots per nationality)
     egyeni/<county> OEVK egyéni 2026.xls  sheets: Paraméterek (candidates by district and
                                        number), "01. evk" ... (one row per station, one column
                                        per candidate); the list files have no district column,
                                        so each station's district comes from here
     levelben_szavazas_eredmenyei_2026.xls  mail votes
Withdrawn candidates appear as "KIESETT" and are skipped. These files do not name the candidates'
nominating organisations: candidates are loaded with organisation "?" (unknown) until a source
that names them is added to data/raw.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import psycopg

from ..hu_names import hu_title
from ._nvi_parliament import ARCHIVE, MAIL, UNKNOWN_ORGANISATION, Places, _int, load_election, nvi_source, write_interim

ELECTION_ID = "parliament-2026"
SOURCE_DIR = "nvi_parliament_2026"
RAW = ARCHIVE / "2026_parlamenti"
SOURCE = nvi_source(
    2026,
    "listas/*.xls, egyeni/*.xls, levelben_szavazas_eredmenyei_2026.xls",
    "Candidates' nominating organisations are not in these files (loaded as unknown).",
)


def _param(params: pd.DataFrame, label: str) -> str:
    row = params.index[params[1].astype(str).str.strip().eq(label)][0]
    return str(params.loc[row, 2]).strip()


def _list_numbers(params: pd.DataFrame, header_col0: str) -> dict[str, str]:
    """{'01': 'Magyar Kétfarkú Kutya Párt', ...} from the 'Pártlisták sorszáma és neve' table."""
    start = params.index[params[0].astype(str).str.strip().str.upper().eq(header_col0)][0] + 1
    rows = params.iloc[start:].dropna(subset=[0])
    return {f"{int(r[0]):02d}": str(r[2]).strip() for _, r in rows.iterrows()}


def _station(code: str) -> str:
    return "-".join(str(code).split("-")[:3])


def _columns(df: pd.DataFrame) -> pd.DataFrame:
    """Strip header names and write numbered list / candidate columns as '01', '02' (Excel may
    store them as 1 or 1.0)."""
    def norm(c) -> str:
        s = str(c).strip()
        return f"{int(float(s)):02d}" if s.replace(".0", "").isdigit() else s

    df.columns = [norm(c) for c in df.columns]
    return df


def clean(raw_dir: Path, interim_dir: Path) -> list[Path]:
    base = raw_dir / RAW
    places = Places(interim_dir)
    station_oevk: dict[str, int] = {}
    turnout, candidates, candidate_votes = [], [], []

    for path in sorted((base / "egyeni").glob("*.xls")):
        params = pd.read_excel(path, sheet_name="Paraméterek", header=None, dtype=str)
        county = places.county(_param(params, "Vármegye neve:"))
        start = params.index[params[0].astype(str).str.strip().eq("VÁRMEGYE")][0] + 1
        names = {}
        for _, r in params.iloc[start:].dropna(subset=[0]).iterrows():
            oevk, position, name = int(r[1]), int(r[2]), str(r[3]).strip()
            if name.upper() == "KIESETT":
                continue
            names[(oevk, position)] = hu_title(name)
            candidates.append([county, oevk, position, hu_title(name), UNKNOWN_ORGANISATION])
        for sheet in pd.ExcelFile(path).sheet_names[1:]:
            oevk = int(sheet.split(".")[0])
            df = _columns(pd.read_excel(path, sheet_name=sheet, header=1, dtype=str))
            for _, r in df.dropna(subset=["Szavazókör az."]).iterrows():
                station = _station(r["Szavazókör az."])
                station_oevk[station] = oevk
                turnout.append([station, "candidate", _int(r["EE"]), _int(r["JE"]), _int(r["NE"]), _int(r["ME"])])
                for col in df.columns:
                    if col.isdigit() and (oevk, int(col)) in names:
                        candidate_votes.append([station, county, oevk, names[(oevk, int(col))], UNKNOWN_ORGANISATION, _int(r[col])])

    stations, list_votes, list_names = [], [], {}
    for path in sorted((base / "listas").glob("*.xls")):
        params = pd.read_excel(path, sheet_name="Paraméterek", header=None, dtype=str)
        county_name = _param(params, "Vármegye neve:")
        county = places.county(county_name)
        numbers = _list_numbers(params, "SORSZÁM")
        for number, name in numbers.items():
            list_names.setdefault(name, ("party", int(number)))
        sheets = pd.ExcelFile(path).sheet_names
        main = next(s for s in sheets[1:] if not s.endswith("nemz"))
        df = _columns(pd.read_excel(path, sheet_name=main, header=1, dtype=str))
        for _, r in df.dropna(subset=["Szavazókör azonosító"]).iterrows():
            station = _station(r["Szavazókör azonosító"])
            if station not in station_oevk:
                places.unmatched.add(f"station {station} has no district in the candidate files")
                continue
            number = station.split("-")[2]
            stations.append([station, county, places.settlement(r["Település"], county), number, station_oevk[station],
                             _int(r["B"]) + _int(r["C"]) > 0])
            turnout.append([station, "list", _int(r["EL"]), _int(r["JL"]), _int(r["NL"]), _int(r["M"])])
            for col, name in numbers.items():
                list_votes.append([station, name, _int(r[col])])
        # Nationality ballots: group header row (nationality) above a row of record letters.
        nemz = next((s for s in sheets if s.endswith("nemz")), None)
        if nemz:
            raw = pd.read_excel(path, sheet_name=nemz, header=None, dtype=str)
            groups = raw.iloc[0].ffill()
            letters = raw.iloc[1]
            for _, r in raw.iloc[2:].dropna(subset=[1]).iterrows():
                station = _station(r[1])
                for col in raw.columns:
                    group = str(groups[col]).strip()
                    if letters[col] == "N" and group not in ("Pártlistás", "Nemzetiségi összesen", "nan") and pd.notna(r[col]):
                        name = f"{group} nemzetiségi lista"
                        list_names.setdefault(name, ("nationality", 100 + len(list_names)))
                        list_votes.append([station, name, _int(r[col])])
    places.raise_if_unmatched()

    mail_path = base / "levelben_szavazas_eredmenyei_2026.xls"
    numbers = _list_numbers(pd.read_excel(mail_path, sheet_name="Paraméterek", header=None, dtype=str), "SORSZÁM")
    mail = _columns(pd.read_excel(mail_path, sheet_name=1, header=1, dtype=str))
    m = mail.dropna(subset=["DL"]).iloc[0]
    turnout.append([MAIL, "list", _int(m["DL"]), _int(m["KL"]), _int(m["NL"]), _int(m["ML"])])
    list_votes += [[MAIL, name, _int(m[col])] for col, name in numbers.items()]

    lists = pd.DataFrame([[pos, name, kind] for name, (kind, pos) in list_names.items()], columns=["position", "name", "kind"])
    lists["position"] = range(1, len(lists) + 1)
    return write_interim(
        interim_dir / SOURCE_DIR,
        {
            "stations": pd.DataFrame(stations, columns=["station", "county_code", "local_unit_id", "number", "oevk", "is_transfer"]),
            "turnout": pd.DataFrame(turnout, columns=["station", "ballot", "registered", "voted", "valid", "invalid"]),
            "lists": lists,
            "list_votes": pd.DataFrame(list_votes, columns=["station", "list_name", "votes"]),
            "candidates": pd.DataFrame(candidates, columns=["county_code", "oevk", "position", "name", "organisation"]),
            "candidate_votes": pd.DataFrame(candidate_votes, columns=["station", "county_code", "oevk", "name", "organisation", "votes"]),
        },
    )


def load(conn: psycopg.Connection, interim_dir: Path) -> dict[str, int]:
    return load_election(conn, interim_dir / SOURCE_DIR, SOURCE, ELECTION_ID)
