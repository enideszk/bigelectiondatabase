"""Cleaning the NVI parliamentary election exports 1990–2010 into the interim layout of
_nvi_parliament (with a `round` column: every election had a second round of single-member races).

The exports are pipe-separated text files in cp1250: per ballot a header file ("fej": one row per
polling station and round, with the turnout) and an item file ("tétel": one row per station, round
and list or candidate). Three layouts:

    1990–1998   szkf.txt (both ballots and rounds; TIPUS, FORD), egy_szkt.txt, lis_szkt.txt
    2002        1_ford/ and 2_ford/: egy_szkf.txt, lis_szkf.txt, egy_szkt.txt, lis_szkt.txt
    2006, 2010  txt_1ford/ and txt_2ford/: the same, with more register columns (voters
                registered abroad, whose votes are counted at "Külképviseleti" stations)

Turnout: registered = voters on the register when voting closed (D; 2006–2010 E, including those
registered abroad), voted = voters who turned up (F; 2006–2010 I), valid J (M), invalid I (L).
Lists are the county ("területi") lists. 2006–2010 name the organisations behind each list (TAM),
which identify the list here; the loader makes one list of each set of parties, so the county lists
of a party, and the spellings of its name, become one. Candidates' nominating organisations: one
field in 1990–1998 (joint ones as "FIDESZ-SZDSZ"), a list of fields in 2002, a comma-separated field
in 2006–2010; no organisation = independent. 1990 has no ballot positions: candidates and lists
are numbered as they first appear.

Known errors of the 1990–1998 item files: 3,606 rows that do not belong where they are (1990: 199
list and 141 candidate rows, 1994: 1,165 and 861, 1998: 620 and 620), repeating another row's ballot number or name (e.g. "001 KUNYÓ VILMOS 1" beside the
real 001, two "008 NAGY GYULA" rows) or naming a list that is not on the county's ballot (1994
Borsod: Zöld Alternatíva under number 17 at 60 of 896 stations), and the station's votes then add
up to more than its valid votes. Such rows are dropped: the fewest rows that repeat something or
are off the ballot (the number-name pairs that at least half the stations of the county or
district have) after which nothing repeats and the votes add up to the header's valid votes;
between two choices that both add up (two rows of 1 vote under one number), the one keeping more
of the ballot. Without such a choice a repetition stops the clean step. Checked: the stations then
add up to NVI's own county and district totals.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from itertools import combinations
from pathlib import Path

import pandas as pd

from ..hu_names import hu_title
from ._nvi_parliament import Places, write_interim

INDEPENDENT = "FÜGGETLEN JELÖLT"


@dataclass(frozen=True)
class Layout:
    head: list[str]                       # fields of a station header row
    turnout: tuple[str, str, str, str]    # registered, voted, valid, invalid
    candidate: list[str]                  # fields of a candidate row (2002: organisations follow)
    lst: list[str]                        # fields of a list row
    list_name: str                        # the field that identifies a list


_OLD_HEAD = ["TIPUS", "FORD", "MAZ", "TAZ", "SORSZ", "MNEV", "TELEP", "OEVK", "A", "B", "C", "D", "F", "G", "H", "I", "J"]
_NEW_ITEMS = dict(
    candidate=["MAZ", "TAZ", "SORSZ", "SOR", "NEVDR", "NEV", "UNEV", "SZAV", "TAMSZAM", "TAM"],
    lst=["MAZ", "TAZ", "SORSZ", "SOR", "LNEV", "SZAV", "TAMSZAM", "TAM"],
    list_name="TAM",
)
LAYOUTS = {
    1990: Layout(_OLD_HEAD, ("D", "F", "J", "I"), ["FORD", "MAZ", "TAZ", "SORSZ", "NEVDR", "NEV", "SZAV", "TAMSZ"],
                 ["FORD", "MAZ", "TAZ", "SORSZ", "LISTA", "SZAV"], "LISTA"),
    1994: Layout(_OLD_HEAD, ("D", "F", "J", "I"), ["FORD", "MAZ", "TAZ", "SORSZ", "SOR", "NEVDR", "NEV", "SZAV", "TAMSZ"],
                 ["FORD", "MAZ", "TAZ", "SORSZ", "SOR", "LISTA", "SZAV"], "LISTA"),
    2002: Layout(["MAZ", "TAZ", "SORSZ", "MNEV", "TELEP", "OEVK", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "MEGS"],
                 ("D", "F", "J", "I"), ["MAZ", "TAZ", "SORSZ", "SOR", "NEVDR", "NEV", "SZAV", "TAMSZAM"],
                 ["MAZ", "TAZ", "SORSZ", "SOR", "LISTA", "SZAV"], "LISTA"),
    2006: Layout(["MAZ", "TAZ", "SORSZ", "MNEV", "TELEP", "OEVK", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
                  "KULKEPV", "MEGS", "KESZULT"], ("E", "I", "M", "L"), **_NEW_ITEMS),
    2010: Layout(["MAZ", "TAZ", "SORSZ", "MNEV", "TELEP", "OEVK", "A", "B", "C", "D", "E", "G", "H", "I", "J", "K", "L", "M",
                  "KULKEPV", "MEGS", "KESZULT"], ("E", "I", "M", "L"), **_NEW_ITEMS),
}
LAYOUTS[1998] = LAYOUTS[1994]

# the files of each layout: (ballot, round or None = in the rows, path relative to the election folder)
_ROUND_DIRS = {2002: ("1_ford", "2_ford"), 2006: ("txt_1ford", "txt_2ford"), 2010: ("txt_1ford", "txt_2ford")}


def _rows(path: Path, fields: list[str]) -> Iterator[dict[str, str]]:
    """The rows of a pipe-separated cp1250 file as dicts; fields beyond `fields` go to "_rest"."""
    for line in path.read_bytes().decode("cp1250").splitlines():
        if not line.strip():
            continue
        values = [v.strip() for v in line.split("|")]
        row = dict(zip(fields, values))
        row["_rest"] = values[len(fields):]  # type: ignore[assignment]
        yield row


def _int(text: str) -> int:
    text = (text or "").strip().lstrip("+")
    return int(text) if text else 0


def _station(row: dict) -> str:
    return f"{row['MAZ']}-{row['TAZ']}-{int(row['SORSZ']):03d}"


def _settlement_name(telep: str) -> str:
    # 2002 writes Budapest districts as "BUDAPEST                 01"
    match = re.fullmatch(r"BUDAPEST\s+(\d{1,2})", telep.upper())
    return f"Budapest {int(match.group(1))}. ker" if match else telep


def _organisations(row: dict, year: int) -> str:
    if year <= 1998:
        names = [row["TAMSZ"]]
    elif year == 2002:
        names = row["_rest"][: _int(row["TAMSZAM"])]
    else:
        names = [row["TAM"]] if _int(row["TAMSZAM"]) else []
    text = ",".join(n.strip() for n in names if n.strip())
    return text or INDEPENDENT


def clean_txt(year: int, base: Path, interim_dir: Path, out_dir: Path, election_day: date,
              swapped: tuple[tuple, ...] = ()) -> list[Path]:
    """`swapped`: (round, county code, district number, name, name) — races whose station file gives
    two candidates each other's votes (checked against NVI's district results); swapped back."""
    layout = LAYOUTS[year]
    places = Places(interim_dir, election_day)
    if year <= 1998:
        heads = [(None, None, base / "szkf.txt")]
        candidate_files = [(None, base / "egy_szkt.txt")]
        list_files = [(None, base / "lis_szkt.txt")]
    else:
        first, second = (base / d for d in _ROUND_DIRS[year])
        heads = [("list", 1, first / "lis_szkf.txt"), ("candidate", 1, first / "egy_szkf.txt"), ("candidate", 2, second / "egy_szkf.txt")]
        candidate_files = [(1, first / "egy_szkt.txt"), (2, second / "egy_szkt.txt")]
        list_files = [(1, first / "lis_szkt.txt")]

    stations: dict[str, list] = {}
    turnout, valid_votes = [], {}
    registered, voted, valid, invalid = layout.turnout
    for ballot, round_no, path in heads:
        for r in _rows(path, layout.head):
            b = ballot or ("candidate" if r["TIPUS"].upper().startswith("EGY") else "list")
            rnd = round_no or int(r["FORD"])
            station = _station(r)
            if station not in stations:
                county = places.county(r["MNEV"])
                stations[station] = [station, county, places.settlement(_settlement_name(r["TELEP"]), county),
                                     f"{int(r['SORSZ']):03d}", int(r["OEVK"]), False]
            turnout.append([station, rnd, b, _int(r[registered]), _int(r[voted]), _int(r[valid]), _int(r[invalid])])
            valid_votes[(station, rnd, b)] = _int(r[valid])
    places.raise_if_unmatched()

    # (station, round, key, ballot number or None, votes, order of appearance)
    list_rows = []
    for round_no, path in list_files:
        for r in _rows(path, layout.lst):
            name = r[layout.list_name] or r.get("LNEV", "")
            number = _int(r["SOR"]) if "SOR" in r else None
            list_rows.append((_checked(stations, r), round_no or int(r["FORD"]), name, number, _int(r["SZAV"]), len(list_rows)))
    list_rows = _dedupe(list_rows, valid_votes, "list", "list", lambda s: stations[s][1])
    list_first: dict[str, tuple] = {}
    for station, rnd, name, number, votes, seen in list_rows:
        list_first[name] = min(list_first.get(name, (number or 999, seen)), (number or 999, seen))
    names = sorted(list_first, key=lambda n: list_first[n])
    lists = pd.DataFrame({"position": range(1, len(names) + 1), "name": names, "kind": "party"})
    list_votes = [[station, rnd, name, votes] for station, rnd, name, _, votes, _ in list_rows]

    # Ballot positions, unique within a race: candidates in the order of their first-round
    # position (1990 has none), then of their first appearance.
    candidate_rows = []
    for round_no, path in candidate_files:
        for r in _rows(path, layout.candidate):
            station = _checked(stations, r)
            name = hu_title(" ".join(p for p in (r["NEVDR"], r["NEV"], r.get("UNEV", "")) if p))
            number = _int(r["SOR"]) if "SOR" in r else None
            candidate_rows.append((station, round_no or int(r["FORD"]), (name, _organisations(r, year)), number, _int(r["SZAV"]), len(candidate_rows)))
    candidate_rows = _dedupe(candidate_rows, valid_votes, "candidate", "candidate", lambda s: (stations[s][1], stations[s][4]))
    swap = {}
    for rnd, county, oevk, a, b in swapped:
        swap[(rnd, county, oevk, a)], swap[(rnd, county, oevk, b)] = b, a
    at_station = {(r[0], r[1], r[2][0]): r[4] for r in candidate_rows}
    candidate_votes, order = [], {}
    for station, rnd, (name, organisation), number, votes, seen in candidate_rows:
        _, county, _, _, oevk, _ = stations[station]
        other = swap.get((rnd, county, oevk, name))
        if other is not None:
            votes = at_station[(station, rnd, other)]
        key = (county, oevk, name, organisation)
        rank = (rnd != 1, number if number is not None and rnd == 1 else 999, seen)
        order[key] = min(order.get(key, rank), rank)
        candidate_votes.append([station, rnd, county, oevk, name, organisation, votes])
    by_race: dict[tuple, list[tuple]] = {}
    for key, rank in sorted(order.items(), key=lambda item: item[1]):
        by_race.setdefault(key[:2], []).append(key)
    candidates = pd.DataFrame(
        [[county, oevk, position, name, organisation]
         for keys in by_race.values()
         for position, (county, oevk, name, organisation) in enumerate(keys, start=1)],
        columns=["county_code", "oevk", "position", "name", "organisation"],
    ).sort_values(["county_code", "oevk", "position"])

    return write_interim(
        out_dir,
        {
            "stations": pd.DataFrame(stations.values(), columns=["station", "county_code", "local_unit_id", "number", "oevk", "is_transfer"]),
            "turnout": pd.DataFrame(turnout, columns=["station", "round", "ballot", "registered", "voted", "valid", "invalid"]),
            "lists": lists,
            "list_votes": pd.DataFrame(list_votes, columns=["station", "round", "list_name", "votes"]),
            "candidates": candidates,
            "candidate_votes": pd.DataFrame(candidate_votes, columns=["station", "round", "county_code", "oevk", "name", "organisation", "votes"]),
        },
    )


def _checked(stations: dict, row: dict) -> str:
    station = _station(row)
    if station not in stations:
        raise ValueError(f"votes for polling station {station}, which no header file lists")
    return station


def _clashes(items: list[tuple]) -> bool:
    """items: (key, ballot number or None, votes, ...). True if a key or a ballot number repeats."""
    keys = Counter(i[0] for i in items)
    numbers = Counter(i[1] for i in items if i[1] is not None)
    return any(n > 1 for n in keys.values()) or any(n > 1 for n in numbers.values())


def without_repeated_rows(items: list[tuple], valid: int | None, ballot: set | None = None) -> list[tuple] | None:
    """The rows of one station and round without the spurious ones (see the module docstring).
    items: (key, ballot number or None, votes, ...); `ballot`: the (number, key) pairs that at
    least half the stations of the county (lists) or district (candidates) have. Rows that repeat
    a key or a number, or are not on the ballot, may be dropped: the fewest after which nothing
    repeats and the votes add up to `valid`; between choices that both add up, the one keeping
    more of the ballot. Returns the rows unchanged when nothing needs fixing or nothing fixes a
    mere difference in the sum, None when a repetition cannot be resolved."""
    clash = _clashes(items)
    total = sum(i[2] for i in items)
    if not clash and (valid is None or total == valid):
        return items
    if valid is None:
        return None
    keys = Counter(i[0] for i in items)
    numbers = Counter(i[1] for i in items if i[1] is not None)
    on_ballot = (lambda i: (i[1], i[0]) in ballot) if ballot else (lambda i: True)
    suspects = [n for n, i in enumerate(items)
                if keys[i[0]] > 1 or (i[1] is not None and numbers[i[1]] > 1) or not on_ballot(i)]
    for size in range(1, min(len(suspects), 4) + 1):
        solutions = {}
        for drop in combinations(suspects, size):
            kept = [i for n, i in enumerate(items) if n not in drop]
            if not _clashes(kept) and sum(i[2] for i in kept) == valid:
                solutions.setdefault(tuple(sorted((i[0], i[1], i[2]) for i in kept)), kept)
        if len(solutions) == 1:
            return next(iter(solutions.values()))
        if solutions:
            score = {k: sum(1 for i in kept if on_ballot(i)) for k, kept in solutions.items()}
            best = max(score.values())
            winners = [k for k, s in score.items() if s == best]
            return solutions[winners[0]] if len(winners) == 1 else None
    return None if clash else items


def _dedupe(rows: list[tuple], valid: dict[tuple, int], ballot: str, what: str, area_of) -> list[tuple]:
    """rows: (station, round, key, ballot number or None, votes, *rest); repeated rows dropped per
    station and round. `area_of(station)`: the county (lists) or district (candidates) whose ballot
    the station used. Stops on a repetition that cannot be resolved."""
    groups: dict[tuple, list[tuple]] = {}
    for r in rows:
        groups.setdefault((r[0], r[1]), []).append(r)
    # the ballot of an area and round: the (number, key) pairs at least half its stations have
    stations_in: Counter = Counter()
    seen: Counter = Counter()
    for (station, rnd), members in groups.items():
        area = area_of(station)
        stations_in[(area, rnd)] += 1
        for pair in {(r[3], r[2]) for r in members}:
            seen[(area, rnd, pair)] += 1
    ballots: dict[tuple, set] = {}
    for (area, rnd, pair), n in seen.items():
        if 2 * n >= stations_in[(area, rnd)]:
            ballots.setdefault((area, rnd), set()).add(pair)
    out, unresolved = [], []
    for (station, rnd), members in groups.items():
        kept = without_repeated_rows([(r[2], r[3], r[4], r) for r in members], valid.get((station, rnd, ballot)),
                                     ballots.get((area_of(station), rnd)))
        if kept is None:
            unresolved.append(f"{station} round {rnd}")
            continue
        out.extend(i[3] for i in kept)
    if unresolved:
        raise ValueError(f"{len(unresolved)} station rounds repeat a {what} row ambiguously: {unresolved[:20]}")
    return out
