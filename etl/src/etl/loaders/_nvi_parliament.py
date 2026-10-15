"""Shared code for the NVI parliamentary election loaders 1990–2026 (one loader module per election;
the 1990–2010 text exports are cleaned by _nvi_parliament_txt).

Every election is first cleaned into the same interim layout, data/interim/nvi_parliament_<year>/:

    stations.csv          station, county_code, local_unit_id, number, oevk, is_transfer
    turnout.csv           station, [round,] ballot (list | candidate), registered, voted, valid, invalid
                          (station "MAIL" = votes cast by mail: list ballot only, no district)
    lists.csv             position, name, kind (party | nationality)
    list_votes.csv        station, [round,] list_name, votes
    candidates.csv        county_code, oevk, position, name, organisation ("?" = not in the source)
    candidate_votes.csv   station, [round,] county_code, oevk, name, organisation, votes

(`round` is 1 where the column is missing: 2014–2026 have one round) and then loaded by
load_election(), the same way for every year. `station` is NVI's polling station code "MM-TTT-SSS"
(NVI county code, NVI settlement code, station number); it joins the interim files and is stored as
polling_station.nvi_code (shown on the site). Counties are mapped by name (NVI's county numbering
changed over time), settlements by name (Budapest districts by number) against the KSH
Helységnévtár, through data/reference/settlement_names.csv for names that changed since.

Parties: list names and nominating organisations are looked up in data/reference/party_aliases.csv
(party ids, display name, short name, colour; `years` limits a row to some elections, for names
that meant different parties at different times); a name missing from it stops the load. Lists
with the same parties become one list of the election: the 1990–2010 county lists of a party, and
the spellings of its name. Turnout uses the party-list and candidate ballots. Nationality voters
vote on a separate ballot; their lists are loaded (kind 'nationality') but their ballot counts are
not part of turnout.
"""

from __future__ import annotations

import io
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import psycopg

from .. import config
from ..hu_names import acronym, bp_district_number, county_key, hu_title, name_key
from ._common import SourceInfo, copy_rows, read_csv, replace_source
from .ksh_helysegnevtar import county_history

REFERENCE_DIR = config.REPO_ROOT / "data" / "reference"
ARCHIVE = Path("valasztasi_eredmenyek_1990-2024")
MAIL = "MAIL"
UNKNOWN_ORGANISATION = "?"
INTERIM_FILES = ("stations", "turnout", "lists", "list_votes", "candidates", "candidate_votes")


class UnmatchedNames(ValueError):
    pass


# ---- name lookups --------------------------------------------------------------------------


class Places:
    """County and settlement lookups (KSH codes) for one cleaning run; collects what does not match.

    Older files spell some settlements differently or name ones renamed or split since
    (data/reference/settlement_names.csv: county, name in the file -> settlement of today), and a
    few settlements belonged to another county then (settlement_counties.csv): the file's county
    is checked against the county on `day`, the election day."""

    def __init__(self, interim_dir: Path, day: date | None = None):
        self.counties = {county_key(c["name"]): c["code"] for c in read_csv(REFERENCE_DIR / "counties.csv")}
        hnt = read_csv(interim_dir / "ksh_helysegnevtar_2026" / "settlements.csv")
        self.by_name = {name_key(s["name"]): s for s in hnt if s["unit_type"] == "settlement"}
        self.by_district = {bp_district_number(s["name"]): s for s in hnt if s["unit_type"] == "bp_district"}
        self.renamed = {(r["county_code"], name_key(r["name"])): name_key(r["settlement"])
                        for r in read_csv(REFERENCE_DIR / "settlement_names.csv")}
        self.history = county_history()
        self.day = day
        self.unmatched: set[str] = set()

    def county(self, name: str) -> str:
        code = self.counties.get(county_key(name))
        if code is None:
            self.unmatched.add(f"county {name!r}")
        return code or ""

    def county_on_day(self, s: dict) -> str:
        """The county a settlement of today belonged to on the election day."""
        if self.day is not None:
            for code, valid_to in self.history.get(name_key(s["name"]), []):
                if self.day < valid_to:
                    return code
        return s["county_code"]

    def settlement(self, name: str, county_code: str) -> str:
        number = bp_district_number(name)
        if number:
            s = self.by_district.get(number)
        else:
            key = name_key(name)
            s = self.by_name.get(self.renamed.get((county_code, key), key))
        if s is None:
            self.unmatched.add(f"settlement {name!r}")
            return ""
        if self.county_on_day(s) != county_code:
            self.unmatched.add(f"settlement {name!r} is in county {self.county_on_day(s)}, the file says {county_code}")
        return f"{s['unit_type']}-{s['code']}"

    def raise_if_unmatched(self) -> None:
        if self.unmatched:
            raise UnmatchedNames(f"{len(self.unmatched)} names match nothing: {sorted(self.unmatched)[:30]}")


def write_interim(out_dir: Path, tables: dict[str, pd.DataFrame]) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for name in INTERIM_FILES:
        path = out_dir / f"{name}.csv"
        tables[name].to_csv(path, index=False, encoding="utf-8")
        paths.append(path)
    return paths


def _int(value) -> int:
    text = str(value).strip()
    return int(float(text)) if text not in ("", "nan", "None") else 0


# ---- 2014–2022: one row per polling station ("F") followed by one row per list / candidate ("T")


def read_ft(path: Path) -> pd.DataFrame:
    """Read an NVI 'szavazóköri jegyzőkönyv' export (csv in cp1250 or utf-8, ',' or ';', or xlsx)."""
    if path.suffix.lower() == ".csv":
        data = path.read_bytes()
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp1250")
        first = text.split("\n", 1)[0]
        df = pd.read_csv(io.StringIO(text), sep=";" if first.count(";") > first.count(",") else ",", dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(path, dtype=str).fillna("")
    df.columns = [str(c).strip().strip("'") for c in df.columns]
    return df.apply(lambda col: col.str.strip())


def _station_key(azon: str) -> str:
    return f"{azon[0:2]}-{azon[2:5]}-{azon[5:8]}"


def clean_ft(list_path: Path, candidate_path: Path, mail_path: Path, interim_dir: Path, out_dir: Path) -> list[Path]:
    places = Places(interim_dir)
    lists_raw, cands_raw, mail_raw = read_ft(list_path), read_ft(candidate_path), read_ft(mail_path)

    stations, turnout = [], []
    for ballot, df in (("list", lists_raw), ("candidate", cands_raw)):
        heads = df[df["SZAVAZÓKÖR_AZON"].str.endswith("F")]
        for _, r in heads.iterrows():
            station = _station_key(r["SZAVAZÓKÖR_AZON"])
            turnout.append([station, ballot, _int(r["VÁLASZTÓPOLGÁR"]), _int(r["MEGJELENTEK"]), _int(r["ÉRVÉNYES"]), _int(r["ÉRVÉNYTELEN"])])
            if ballot == "list":
                county = places.county(r["MEGYE"])
                stations.append([station, county, places.settlement(r["TELEPÜLÉS"], county), r["SZAVAZÓKÖR"].zfill(3), _int(r["OEVK"]), False])
    places.raise_if_unmatched()
    stations_df = pd.DataFrame(stations, columns=["station", "county_code", "local_unit_id", "number", "oevk", "is_transfer"])
    station_info = stations_df.set_index("station")

    items = lists_raw[lists_raw["SZAVAZÓKÖR_AZON"].str.endswith("T")]
    kinds = items.get("LISTA_TÍPUS", pd.Series("", index=items.index))
    list_votes = pd.DataFrame({"station": items["SZAVAZÓKÖR_AZON"].map(_station_key), "list_name": items["LISTA"], "votes": items["SZAVAZAT"].map(_int)})
    lists = (
        pd.DataFrame({"name": items["LISTA"], "kind": kinds.map(lambda k: "nationality" if k.lower().startswith("nemzetis") else "party")})
        .drop_duplicates("name")
        .reset_index(drop=True)
    )

    mail_items = mail_raw[mail_raw["LISTA"] != ""]
    head = mail_raw[mail_raw["VÁLASZTÓPOLGÁR"] != ""].iloc[0]
    turnout.append([MAIL, "list", _int(head["VÁLASZTÓPOLGÁR"]), _int(head["IRATOKBAN_LEVŐ_SZAVAZÓLAP"]), _int(head["ÉRVÉNYES"]), _int(head["ÉRVÉNYTELEN"])])
    list_votes = pd.concat([list_votes, pd.DataFrame({"station": MAIL, "list_name": mail_items["LISTA"], "votes": mail_items["SZAVAZAT"].map(_int)})])
    extra = set(mail_items["LISTA"]) - set(lists["name"])
    lists = pd.concat([lists, pd.DataFrame({"name": sorted(extra), "kind": "party"})], ignore_index=True)
    lists.insert(0, "position", range(1, len(lists) + 1))

    rows = cands_raw[cands_raw["SZAVAZÓKÖR_AZON"].str.endswith("T")]
    stations_of = rows["SZAVAZÓKÖR_AZON"].map(_station_key)
    candidate_votes = pd.DataFrame(
        {
            "station": stations_of,
            "county_code": stations_of.map(station_info["county_code"]),
            "oevk": stations_of.map(station_info["oevk"]),
            "name": rows["JELÖLT"].map(hu_title),
            "organisation": rows["SZERVEZET"],
            "votes": rows["SZAVAZAT"].map(_int),
        }
    )
    candidates = (
        candidate_votes[["county_code", "oevk", "name", "organisation"]]
        .drop_duplicates()  # a namesake under another organisation is another candidate
        .reset_index(drop=True)
    )
    candidates.insert(2, "position", candidates.groupby(["county_code", "oevk"]).cumcount() + 1)

    return write_interim(
        out_dir,
        {
            "stations": stations_df,
            "turnout": pd.DataFrame(turnout, columns=["station", "ballot", "registered", "voted", "valid", "invalid"]),
            "lists": lists,
            "list_votes": list_votes,
            "candidates": candidates,
            "candidate_votes": candidate_votes,
        },
    )


# ---- load (every year) ---------------------------------------------------------------------


def _alias_key(text: str) -> str:
    return " ".join(str(text).split()).upper()


def load_aliases() -> dict[str, list[dict]]:
    """party_aliases.csv keyed by the normalised alias (a name can have rows for different years)."""
    aliases: dict[str, list[dict]] = defaultdict(list)
    for a in read_csv(REFERENCE_DIR / "party_aliases.csv"):
        aliases[_alias_key(a["alias"])].append(a)
    return aliases


def _alias_years(row: dict) -> set[int]:
    return {int(y) for y in (row.get("years") or "").split("|") if y.strip()}


def resolve(aliases: dict[str, list[dict]], name: str, year: int) -> dict | None:
    """The alias row of a list name or nominating organisation at an election of `year`: the row
    for that year, else the row for every year. Joint nominations written "A,B" (2002–2010) that are
    not an alias as a whole resolve part by part; None when something is not an alias."""
    rows = aliases.get(_alias_key(name), [])
    row = next((r for r in rows if year in _alias_years(r)), None) or next((r for r in rows if not _alias_years(r)), None)
    if row is not None or "," not in name:
        return row
    parts = [resolve(aliases, part, year) for part in name.split(",") if part.strip()]
    if not parts or any(p is None for p in parts):
        return None
    party_ids = list(dict.fromkeys(pid for p in parts for pid in (p["party_ids"] or "").split("|") if pid))
    label = "–".join(p["short_name"] for p in parts)
    return {"alias": name, "party_ids": "|".join(party_ids), "name": label, "short_name": label, "color": parts[0]["color"], "years": None}


def election_year(election_id: str) -> int:
    return int(election_id.rsplit("-", 1)[1])


def unknown_names(interim: Path, year: int) -> list[str]:
    """List names and organisations of an election missing from party_aliases.csv."""
    aliases = load_aliases()
    names = {r["name"] for r in read_csv(interim / "lists.csv") if r["kind"] == "party"}
    names |= {r["organisation"] for r in read_csv(interim / "candidates.csv")}
    return sorted(n for n in names if resolve(aliases, n, year) is None)


def _round(row: dict) -> int:
    return int(row.get("round") or 1)


def load_election(conn: psycopg.Connection, interim: Path, source: SourceInfo, election_id: str) -> dict[str, int]:
    year = election_year(election_id)
    missing = unknown_names(interim, year)
    if missing:
        raise UnmatchedNames(f"add these to data/reference/party_aliases.csv: {missing}")
    aliases = load_aliases()
    t = {name: read_csv(interim / f"{name}.csv") for name in INTERIM_FILES}

    with conn.transaction():
        row = conn.execute("SELECT election_date, district_set_id FROM election WHERE election_id = %s", (election_id,)).fetchone()
        if row is None:
            raise ValueError(f"election {election_id} is missing: load reference_elections first")
        day, district_set = row
        source_id = replace_source(conn, source)

        def district(county_code: str, oevk) -> str:
            return f"smd-{district_set}-{county_code}-{int(oevk):02d}"

        names = dict(conn.execute("SELECT unit_id, name FROM unit WHERE unit_type IN ('settlement', 'bp_district')").fetchall())
        station_unit = {}
        units, stations = [], []
        for s in t["stations"]:
            ksh = s["local_unit_id"].split("-", 1)[1]
            unit_id = f"polling_station-{election_id}-{ksh}-{s['number']}"
            station_unit[s["station"]] = unit_id
            units.append([unit_id, "polling_station", unit_id.removeprefix("polling_station-"),
                          f"{names[s['local_unit_id']]}, {int(s['number'])}. szavazókör", day, day + timedelta(days=1), source_id])
            stations.append([unit_id, election_id, s["local_unit_id"], district(s["county_code"], s["oevk"]), s["number"],
                             s["station"], s["is_transfer"] == "True", source_id])
        counts = {
            "unit (polling stations)": copy_rows(conn, "unit", ["unit_id", "unit_type", "code", "name", "valid_from", "valid_to", "source_id"], units),
            "polling_station": copy_rows(
                conn, "polling_station",
                ["unit_id", "election_id", "local_unit_id", "district_unit_id", "number", "nvi_code", "is_transfer", "source_id"],
                stations,
            ),
        }
        station_unit[MAIL] = "special-mail"

        # One list per set of parties: the county lists of 1990–2010 and the spellings of a party's
        # name are one list of the election, named as its most voted spelling.
        name_votes = Counter()
        for r in t["list_votes"]:
            name_votes[r["list_name"]] += int(r["votes"])
        groups: dict[tuple, list[tuple[dict, dict, list[str]]]] = {}
        for lst in t["lists"]:
            alias = resolve(aliases, lst["name"], year) or {}
            party_ids = [p for p in (alias.get("party_ids") or "").split("|") if p]
            key = ("parties", tuple(sorted(party_ids))) if lst["kind"] == "party" and party_ids else ("name", lst["name"])
            groups.setdefault(key, []).append((lst, alias, party_ids))
        list_ids = {}
        for members in groups.values():
            lst, alias, party_ids = max(members, key=lambda m: name_votes[m[0]["name"]])
            list_id = conn.execute(
                """
                INSERT INTO party_list (election_id, name, short_name, list_kind, color, ballot_position, source_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING list_id
                """,
                (election_id, alias.get("name") or hu_title(lst["name"]), alias.get("short_name") or acronym(hu_title(lst["name"])),
                 lst["kind"], alias.get("color"), min(int(m[0]["position"]) for m in members), source_id),
            ).fetchone()[0]
            for position, party in enumerate(party_ids, start=1):
                conn.execute("INSERT INTO party_list_member (list_id, party_id, position) VALUES (%s, %s, %s)", (list_id, party, position))
            for m in members:
                list_ids[m[0]["name"]] = list_id

        candidate_ids = {}
        for c in t["candidates"]:
            alias = resolve(aliases, c["organisation"], year)
            key = (c["county_code"], int(c["oevk"]), c["name"], c["organisation"])
            candidate_ids[key] = conn.execute(
                """
                INSERT INTO candidate (election_id, race_type, district_unit_id, name, ballot_position, source_id)
                VALUES (%s, 'smd', %s, %s, %s, %s) RETURNING candidate_id
                """,
                (election_id, district(c["county_code"], c["oevk"]), c["name"], c["position"], source_id),
            ).fetchone()[0]
            for position, party in enumerate(filter(None, (alias["party_ids"] or "").split("|")), start=1):
                conn.execute("INSERT INTO candidate_party (candidate_id, party_id, position) VALUES (%s, %s, %s)", (candidate_ids[key], party, position))
        counts["party_list"] = len(groups)
        counts["candidate"] = len(candidate_ids)

        counts["turnout"] = copy_rows(
            conn, "turnout", ["election_id", "round_no", "unit_id", "ballot", "registered", "voted", "valid", "invalid", "source_id"],
            ([election_id, _round(r), station_unit[r["station"]], r["ballot"], r["registered"], r["voted"], r["valid"], r["invalid"], source_id]
             for r in t["turnout"]),
        )
        # summed, as two spellings of a list (now one list) could meet at a station
        list_votes: Counter = Counter()
        for r in t["list_votes"]:
            list_votes[(_round(r), station_unit[r["station"]], list_ids[r["list_name"]])] += int(r["votes"])
        counts["list_result"] = copy_rows(
            conn, "list_result", ["election_id", "round_no", "unit_id", "list_id", "votes", "source_id"],
            ([election_id, round_no, unit_id, list_id, votes, source_id] for (round_no, unit_id, list_id), votes in list_votes.items()),
        )
        counts["candidate_result"] = copy_rows(
            conn, "candidate_result", ["election_id", "round_no", "unit_id", "candidate_id", "votes", "source_id"],
            ([election_id, _round(r), station_unit[r["station"]], candidate_ids[(r["county_code"], int(r["oevk"]), r["name"], r["organisation"])], r["votes"], source_id]
             for r in t["candidate_votes"]),
        )
    return counts


def nvi_source(year: int, files: str, notes: str = "") -> SourceInfo:
    return SourceInfo(
        name=f"NVI parliamentary election {year}",
        publisher="Nemzeti Választási Iroda (NVI)",
        url="https://www.valasztas.hu/",
        file_name=files,
        downloaded_on=date(2026, 10, 14),
        license="Public data of the National Election Office",
        notes=notes or None,
    )
