"""Generate the FAKE fixture dataset in this folder (CSV files + geometries.geojson).

    python data/fixtures/make_fixtures.py        (any Python 3.12+, standard library only)

EVERYTHING here is invented: places, names, codes, boundaries, parties, candidates, votes and
indicator values. Codes start with 9 or XX so they can never collide with real KSH / NUTS codes.

What the fixture exercises:
  * 2 counties, 4 járások (which only exist from 2013), 9 settlements on a rough Hungary outline
  * a settlement merge (Kiskamu -> Nagykamu, 2014) with two geometry versions for Nagykamu
  * a same-code rename (Mintafalu -> Mintafalva, 2005) and a party rename (Zöld Mozgalom -> Zöld Szövetség)
  * two district sets: '1990' (used in 2010) and '2011' (used in 2018)
  * a split city (Próbaváros) in two districts of the 2011 set, with polling-station-level results
  * a 2010 election with a second round in two of three districts
  * joint lists / joint candidates, an independent candidate, mail votes (special unit)
  * 3 indicators for 2011 and 2022, stored at every level
"""

from __future__ import annotations

import csv
import json
import random
from pathlib import Path

HERE = Path(__file__).parent
rng = random.Random(2026)

# ----------------------------------------------------------------------------------------------
# Geometry: a rough outline given by a top and a bottom curve (lon -> lat); every shape is a set
# of vertical "spans" between two of the curves bottom / mid / top. Shared borders are identical.

TOP = [(16.1, 47.15), (16.6, 47.75), (17.2, 48.0), (18.0, 47.85), (18.8, 48.1), (19.5, 48.2),
       (20.3, 48.5), (21.2, 48.6), (22.1, 48.4), (22.9, 48.1)]
BOTTOM = [(16.1, 46.75), (16.8, 46.35), (17.6, 45.95), (18.5, 45.75), (19.4, 46.1), (20.3, 46.15),
          (21.2, 46.3), (22.0, 47.3), (22.9, 47.95)]


def _interp(curve: list[tuple[float, float]], x: float) -> float:
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    raise ValueError(x)


def _y(kind: str, x: float) -> float:
    if kind == "top":
        return _interp(TOP, x)
    if kind == "bottom":
        return _interp(BOTTOM, x)
    return (_interp(TOP, x) + _interp(BOTTOM, x)) / 2


def _breaks(kind: str) -> list[float]:
    xs = {"top": [p[0] for p in TOP], "bottom": [p[0] for p in BOTTOM]}
    return sorted(set(xs["top"]) | set(xs["bottom"])) if kind == "mid" else xs[kind]


def _curve(kind: str, x0: float, x1: float) -> list[tuple[float, float]]:
    xs = [x0] + [x for x in _breaks(kind) if x0 < x < x1] + [x1]
    return [(round(x, 5), round(_y(kind, x), 5)) for x in xs]


def region(*spans: tuple[float, float, str, str]) -> dict:
    """GeoJSON polygon for contiguous spans (x0, x1, lower_curve, upper_curve), left to right."""
    ring: list[tuple[float, float]] = []
    for x0, x1, lo, _ in spans:
        ring += _curve(lo, x0, x1)
    for x0, x1, _, hi in reversed(spans):
        ring += list(reversed(_curve(hi, x0, x1)))
    ring = [p for i, p in enumerate(ring) if i == 0 or p != ring[i - 1]]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}


# ----------------------------------------------------------------------------------------------
# Units

MERGE_DATE = "2014-10-12"     # Kiskamu merged into Nagykamu
JARAS_FROM = "2013-01-01"     # járások exist from this date
SET_2011_FROM = "2011-12-23"  # fake law date of the 2011 district set

units: list[dict] = []
parents: list[dict] = []
geometries: list[dict] = []


def unit(unit_type, code, name, name_en=None, valid_from=None, valid_to=None):
    unit_id = f"{unit_type}-{code}"
    units.append(dict(unit_id=unit_id, unit_type=unit_type, code=code, name=name, name_en=name_en,
                      valid_from=valid_from, valid_to=valid_to))
    return unit_id


def parent(child, par, valid_from=None, valid_to=None):
    parents.append(dict(child_unit_id=child, parent_unit_id=par, valid_from=valid_from, valid_to=valid_to))


def geometry(unit_id, geom, valid_from=None, valid_to=None):
    geometries.append({"type": "Feature",
                       "properties": {"unit_id": unit_id, "valid_from": valid_from, "valid_to": valid_to},
                       "geometry": geom})


COUNTRY = unit("country", "XX", "Kamuország", "Fakeland")
geometry(COUNTRY, region((16.1, 22.9, "bottom", "top")))
WEST = unit("nuts1", "XX1", "Nyugat-Kamuország", "West Fakeland")
EAST = unit("nuts1", "XX2", "Kelet-Kamuország", "East Fakeland")
WEST2 = unit("nuts2", "XX11", "Közép-Nyugat-Kamuország", "Central West Fakeland")
EAST2 = unit("nuts2", "XX21", "Közép-Kelet-Kamuország", "Central East Fakeland")
ALFA = unit("county", "91", "Alfa")
BETA = unit("county", "92", "Béta")
for uid, x0, x1 in [(WEST, 16.1, 19.5), (WEST2, 16.1, 19.5), (ALFA, 16.1, 19.5),
                    (EAST, 19.5, 22.9), (EAST2, 19.5, 22.9), (BETA, 19.5, 22.9)]:
    geometry(uid, region((x0, x1, "bottom", "top")))
for child, par in [(WEST, COUNTRY), (EAST, COUNTRY), (WEST2, WEST), (EAST2, EAST), (ALFA, WEST2), (BETA, EAST2)]:
    parent(child, par)

JARAS = {
    "911": ("Próbavárosi járás", ALFA, [(18.2, 19.5, "bottom", "top")]),
    "912": ("Kamuházi járás", ALFA, [(16.1, 18.2, "bottom", "top")]),
    "921": ("Teszteleki járás", BETA, [(19.5, 20.6, "bottom", "top"), (20.6, 21.6, "mid", "top")]),
    "922": ("Üresdi járás", BETA, [(20.6, 21.6, "bottom", "mid"), (21.6, 22.9, "bottom", "top")]),
}
jaras_id = {}
for code, (name, county, spans) in JARAS.items():
    jaras_id[code] = unit("jaras", code, name, valid_from=JARAS_FROM)
    parent(jaras_id[code], county, valid_from=JARAS_FROM)
    geometry(jaras_id[code], region(*spans), valid_from=JARAS_FROM)

# code: (name, county, járás, span, registered 2010, registered 2018, political lean [-1..1])
SETTLEMENTS = {
    "99001": ("Próbaváros", ALFA, "911", (18.2, 19.5, "mid", "top"), 60400, 59400, -0.2),
    "99002": ("Mintafalva", ALFA, "911", (18.2, 19.5, "bottom", "mid"), 3200, 3050, 0.3),
    "99003": ("Kamuháza", ALFA, "912", (16.1, 17.2, "bottom", "top"), 5400, 5250, 0.5),
    "99004": ("Nagykamu", ALFA, "912", (17.2, 18.2, "mid", "top"), 2600, 3400, 0.4),
    "99005": ("Kiskamu", ALFA, "912", (17.2, 18.2, "bottom", "mid"), 900, None, 0.6),
    "99006": ("Tesztelek", BETA, "921", (19.5, 20.6, "bottom", "top"), 24000, 23200, -0.4),
    "99007": ("Álomfalva", BETA, "921", (20.6, 21.6, "mid", "top"), 1800, 1720, 0.1),
    "99008": ("Üresd", BETA, "922", (20.6, 21.6, "bottom", "mid"), 700, 640, 0.2),
    "99009": ("Őrfalu", BETA, "922", (21.6, 22.9, "bottom", "top"), 4100, 3950, -0.1),
}
sid = {}
for code, (name, county, jaras, span, *_rest) in SETTLEMENTS.items():
    valid_to = MERGE_DATE if code == "99005" else None
    sid[code] = unit("settlement", code, name, valid_to=valid_to)
    parent(sid[code], county, valid_to=JARAS_FROM)
    parent(sid[code], jaras_id[jaras], valid_from=JARAS_FROM, valid_to=valid_to)
    if code == "99004":   # Nagykamu: before and after absorbing Kiskamu
        geometry(sid[code], region(span), valid_to=MERGE_DATE)
        geometry(sid[code], region((17.2, 18.2, "bottom", "top")), valid_from=MERGE_DATE)
    else:
        geometry(sid[code], region(span), valid_to=valid_to)

MAIL = unit("special", "mail", "Levélszavazatok", "Mail votes")
parent(MAIL, COUNTRY)

unit_names = [dict(unit_id=sid["99002"], name="Mintafalu", valid_from=None, valid_to="2005-01-01")]
lineage = [dict(from_unit_id=sid["99005"], to_unit_id=sid["99004"], change_date=MERGE_DATE,
                change_type="merge", weight=None, notes="FAKE: Kiskamu merged into Nagykamu")]

# ----------------------------------------------------------------------------------------------
# District sets, districts, membership

district_sets = [
    dict(district_set_id="1990", name="1990 single-member districts (FAKE)", valid_from=None, valid_to=SET_2011_FROM),
    dict(district_set_id="2011", name="2011 single-member districts (FAKE)", valid_from=SET_2011_FROM, valid_to=None),
]
districts: list[dict] = []
memberships: list[dict] = []

# (set, county code, number, name, seat, members, spans)
DISTRICTS = [
    ("1990", "91", 1, "Alfa 01", "99003", ["99003", "99004", "99005"], [(16.1, 18.2, "bottom", "top")]),
    ("1990", "91", 2, "Alfa 02", "99001", ["99001", "99002"], [(18.2, 19.5, "bottom", "top")]),
    ("1990", "92", 1, "Béta 01", "99006", ["99006", "99007", "99008", "99009"], [(19.5, 22.9, "bottom", "top")]),
    ("2011", "91", 1, "Alfa 01", "99003", ["99003", "99004", "99005", "99001"],
     [(16.1, 18.2, "bottom", "top"), (18.2, 18.85, "mid", "top")]),
    ("2011", "91", 2, "Alfa 02", "99001", ["99002", "99001"],
     [(18.2, 18.85, "bottom", "mid"), (18.85, 19.5, "bottom", "top")]),
    ("2011", "92", 1, "Béta 01", "99006", ["99006", "99007", "99008", "99009"], [(19.5, 22.9, "bottom", "top")]),
]
did = {}
for set_id, county, number, name, seat, members, spans in DISTRICTS:
    vf, vt = (None, SET_2011_FROM) if set_id == "1990" else (SET_2011_FROM, None)
    uid = unit("smd", f"{set_id}-{county}-{number:02d}", name, valid_from=vf, valid_to=vt)
    did[(set_id, county, number)] = uid
    districts.append(dict(unit_id=uid, district_set_id=set_id, county_unit_id=f"county-{county}",
                          number=number, seat_unit_id=sid[seat]))
    memberships += [dict(local_unit_id=sid[m], district_unit_id=uid) for m in members]
    geometry(uid, region(*spans), valid_from=vf, valid_to=vt)

# ----------------------------------------------------------------------------------------------
# Elections, parties, lists, candidates

elections = [
    dict(election_id="parliament-2010", election_type="parliament", election_date="2010-04-11",
         name_en="2010 parliamentary election (FAKE)", name_hu="2010. évi országgyűlési választás (KAMU)",
         district_set_id="1990"),
    dict(election_id="parliament-2018", election_type="parliament", election_date="2018-04-08",
         name_en="2018 parliamentary election (FAKE)", name_hu="2018. évi országgyűlési választás (KAMU)",
         district_set_id="2011"),
]
rounds = [
    dict(election_id="parliament-2010", round_no=1, round_date="2010-04-11"),
    dict(election_id="parliament-2010", round_no=2, round_date="2010-04-25"),
    dict(election_id="parliament-2018", round_no=1, round_date="2018-04-08"),
]
parties = [
    dict(party_id="orange", name="Narancs Párt", short_name="NP", color="#e8731c", notes="FAKE party"),
    dict(party_id="white", name="Fehér Néppárt", short_name="FNP", color="#8c8c8c", notes="FAKE party"),
    dict(party_id="red", name="Piros Párt", short_name="PP", color="#d1263b", notes="FAKE party"),
    dict(party_id="blue", name="Kék Párt", short_name="KP", color="#2a6fdb", notes="FAKE party"),
    dict(party_id="green", name="Zöld Szövetség", short_name="ZSZ", color="#2e9e4f", notes="FAKE party, renamed in 2015"),
    dict(party_id="purple", name="Lila Liga", short_name="LL", color="#8a4fbf", notes="FAKE party"),
]
party_names = [
    dict(party_id="green", name="Zöld Mozgalom", short_name="ZM", valid_from=None, valid_to="2015-06-01"),
    dict(party_id="green", name="Zöld Szövetség", short_name="ZSZ", valid_from="2015-06-01", valid_to=None),
]

# list_id: (election, name, short name, color, member parties, list base share)
LISTS = {
    1: ("parliament-2010", "Narancs–Fehér", "NP–FNP", None, ["orange", "white"], 0.40),
    2: ("parliament-2010", "Piros Párt", "PP", None, ["red"], 0.28),
    3: ("parliament-2010", "Kék Párt", "KP", None, ["blue"], 0.15),
    4: ("parliament-2010", "Zöld Mozgalom", "ZM", None, ["green"], 0.10),
    5: ("parliament-2010", "Lila Liga", "LL", None, ["purple"], 0.07),
    6: ("parliament-2018", "Narancs–Fehér", "NP–FNP", None, ["orange", "white"], 0.46),
    7: ("parliament-2018", "Piros–Kék Összefogás", "PP–KP", "#b03a6e", ["red", "blue"], 0.38),
    8: ("parliament-2018", "Zöld Szövetség", "ZSZ", None, ["green"], 0.16),
}
party_lists, list_members = [], []
for list_id, (election, name, short, color, members, _) in LISTS.items():
    position = sum(1 for lid, v in LISTS.items() if v[0] == election and lid <= list_id)
    party_lists.append(dict(list_id=list_id, election_id=election, name=name, short_name=short, list_kind="party",
                            scope_unit_id=None, color=color, ballot_position=position))
    list_members += [dict(list_id=list_id, party_id=p, position=i + 1) for i, p in enumerate(members)]

# candidate_id: (election, district key, name, parties, base share round 1, base share round 2 or None)
CANDIDATES = {
    1: ("parliament-2010", ("1990", "91", 1), "Teszt Elek", ["orange", "white"], 0.55, None),
    2: ("parliament-2010", ("1990", "91", 1), "Minta Márta", ["red"], 0.24, None),
    3: ("parliament-2010", ("1990", "91", 1), "Próba Pál", ["blue"], 0.13, None),
    4: ("parliament-2010", ("1990", "91", 1), "Kamu Kata", ["green"], 0.08, None),
    5: ("parliament-2010", ("1990", "91", 2), "Ál Ödön", ["orange", "white"], 0.42, 0.52),
    6: ("parliament-2010", ("1990", "91", 2), "Hamis Hanna", ["red"], 0.40, 0.48),
    7: ("parliament-2010", ("1990", "91", 2), "Vak Vilmos", ["green"], 0.11, None),
    8: ("parliament-2010", ("1990", "91", 2), "Példa Péter", [], 0.07, None),
    9: ("parliament-2010", ("1990", "92", 1), "Fiktív Ferenc", ["red"], 0.40, 0.47),
    10: ("parliament-2010", ("1990", "92", 1), "Kitalált Kornélia", ["orange", "white"], 0.37, 0.44),
    11: ("parliament-2010", ("1990", "92", 1), "Mű Miklós", ["blue"], 0.15, 0.09),
    12: ("parliament-2010", ("1990", "92", 1), "Lila Lili", ["purple"], 0.08, None),
    13: ("parliament-2018", ("2011", "91", 1), "Teszt Elek", ["orange", "white"], 0.48, None),
    14: ("parliament-2018", ("2011", "91", 1), "Összefogó Olga", ["red", "blue"], 0.41, None),
    15: ("parliament-2018", ("2011", "91", 1), "Zöldi Zoltán", ["green"], 0.11, None),
    16: ("parliament-2018", ("2011", "91", 2), "Ál Ödön", ["orange", "white"], 0.40, None),
    17: ("parliament-2018", ("2011", "91", 2), "Hamis Hanna", ["red", "blue"], 0.45, None),
    18: ("parliament-2018", ("2011", "91", 2), "Kamu Kata", ["green"], 0.10, None),
    19: ("parliament-2018", ("2011", "91", 2), "Független Fanni", [], 0.05, None),
    20: ("parliament-2018", ("2011", "92", 1), "Fiktív Ferenc", ["red", "blue"], 0.44, None),
    21: ("parliament-2018", ("2011", "92", 1), "Kitalált Kornélia", ["orange", "white"], 0.42, None),
    22: ("parliament-2018", ("2011", "92", 1), "Zöld Zita", ["green"], 0.14, None),
}
candidates, candidate_parties = [], []
for cid, (election, dkey, name, cparties, *_shares) in CANDIDATES.items():
    position = sum(1 for k, v in CANDIDATES.items() if v[1] == dkey and k <= cid)
    candidates.append(dict(candidate_id=cid, election_id=election, race_type="smd", district_unit_id=did[dkey],
                           name=name, ballot_position=position))
    candidate_parties += [dict(candidate_id=cid, party_id=p, position=i + 1) for i, p in enumerate(cparties)]

# ----------------------------------------------------------------------------------------------
# Results


def allocate(total: int, weights: list[float]) -> list[int]:
    """Split `total` votes proportionally to weights (largest remainder), summing exactly."""
    s = sum(weights)
    raw = [total * w / s for w in weights]
    out = [int(r) for r in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - out[i], reverse=True)[: total - sum(out)]:
        out[i] += 1
    return out


def lean_factor(parties_: list[str], lean: float, strength: float) -> float:
    if "orange" in parties_:
        return 1 + strength * lean
    if "red" in parties_:
        return 1 - strength * lean
    return 1.0


def noise() -> float:
    return 1 + rng.uniform(-0.03, 0.03)


turnout, list_results, candidate_results = [], [], []
polling_stations = []


def add_unit_results(election: str, unit_id: str, registered: int, lean: float, district: tuple | None,
                     rate: float, rate_r2: float | None, with_candidates: bool = True) -> None:
    voted = round(registered * rate * noise())
    inv_l, inv_c = round(voted * 0.012), round(voted * 0.018)
    turnout.append(dict(election_id=election, round_no=1, unit_id=unit_id, ballot="list",
                        registered=registered, voted=voted, valid=voted - inv_l, invalid=inv_l))
    lists = [(lid, v) for lid, v in LISTS.items() if v[0] == election]
    weights = [v[5] * lean_factor(v[4], lean, 0.6) * noise() for _, v in lists]
    for (lid, _), votes in zip(lists, allocate(voted - inv_l, weights)):
        list_results.append(dict(election_id=election, round_no=1, unit_id=unit_id, list_id=lid, votes=votes))
    if not with_candidates:
        return
    turnout.append(dict(election_id=election, round_no=1, unit_id=unit_id, ballot="candidate",
                        registered=registered, voted=voted, valid=voted - inv_c, invalid=inv_c))
    cands = [(cid, v) for cid, v in CANDIDATES.items() if v[0] == election and v[1] == district]
    weights = [v[4] * lean_factor(v[3], lean, 0.4) * noise() for _, v in cands]
    for (cid, _), votes in zip(cands, allocate(voted - inv_c, weights)):
        candidate_results.append(dict(election_id=election, round_no=1, unit_id=unit_id, candidate_id=cid, votes=votes))
    r2 = [(cid, v) for cid, v in cands if v[5] is not None]
    if r2 and rate_r2:
        voted2 = round(registered * rate_r2 * noise())
        inv2 = round(voted2 * 0.015)
        turnout.append(dict(election_id=election, round_no=2, unit_id=unit_id, ballot="candidate",
                            registered=registered, voted=voted2, valid=voted2 - inv2, invalid=inv2))
        weights = [v[5] * lean_factor(v[3], lean, 0.4) * noise() for _, v in r2]
        for (cid, _), votes in zip(r2, allocate(voted2 - inv2, weights)):
            candidate_results.append(dict(election_id=election, round_no=2, unit_id=unit_id, candidate_id=cid, votes=votes))


def district_of(set_id: str, code: str) -> tuple:
    keys = [(d[0], d[1], d[2]) for d in DISTRICTS if d[0] == set_id and code in d[5]]
    assert len(keys) == 1, (set_id, code, keys)
    return keys[0]


# 2010: every settlement reports as a whole.
for code, (name, _c, _j, _s, reg2010, _reg2018, lean) in SETTLEMENTS.items():
    add_unit_results("parliament-2010", sid[code], reg2010, lean, district_of("1990", code), 0.64, 0.48)

# 2018: Próbaváros reports per polling station (it is split between Alfa 01 and Alfa 02);
# Kiskamu no longer exists; mail votes come on top (list ballot only).
STATIONS = [("001", 15200, -0.10, 1), ("002", 14800, 0.05, 1), ("003", 15500, -0.35, 2), ("004", 13900, -0.30, 2)]
for number, reg, lean, district_no in STATIONS:
    code = f"parliament-2018-99001-{number}"
    ps = unit("polling_station", code, f"Próbaváros {number}. szavazókör", valid_from="2018-04-08", valid_to="2018-04-09")
    polling_stations.append(dict(unit_id=ps, election_id="parliament-2018", local_unit_id=sid["99001"],
                                 district_unit_id=did[("2011", "91", district_no)], number=number,
                                 address=f"Kamu utca {int(number)}. (FAKE)", is_transfer="false"))
    add_unit_results("parliament-2018", ps, reg, lean, ("2011", "91", district_no), 0.70, None)
for code, (name, _c, _j, _s, _reg2010, reg2018, lean) in SETTLEMENTS.items():
    if reg2018 is not None and code != "99001":   # Próbaváros: per polling station, above
        add_unit_results("parliament-2018", sid[code], reg2018, lean, district_of("2011", code), 0.70, None)
add_unit_results("parliament-2018", MAIL, 3000, 1.0, None, 0.80, None, with_candidates=False)


def district_totals(election: str, round_no: int) -> dict[tuple, dict[int, int]]:
    out: dict[tuple, dict[int, int]] = {}
    for r in candidate_results:
        if r["election_id"] == election and r["round_no"] == round_no:
            dkey = CANDIDATES[r["candidate_id"]][1]
            out.setdefault(dkey, {}).setdefault(r["candidate_id"], 0)
            out[dkey][r["candidate_id"]] += r["votes"]
    return out


# Sanity: 2010 Alfa 01 is decided in round 1 (> 50%), the two districts with a round 2 are not.
for dkey, votes in district_totals("parliament-2010", 1).items():
    share = max(votes.values()) / sum(votes.values())
    has_round2 = any(CANDIDATES[c][5] is not None for c in votes)
    assert (share > 0.5) != has_round2, (dkey, share)

# ----------------------------------------------------------------------------------------------
# Indicators: 2011 and 2022, every settlement / járás / county / region / country.

indicators = [
    dict(indicator_id="avg_wage", name_en="Average gross monthly wage", name_hu="Átlagos bruttó havi kereset",
         unit_of_measure="HUF", decimals=0, description="FAKE. Average gross monthly earnings of employees."),
    dict(indicator_id="unemployment_rate", name_en="Unemployment rate", name_hu="Munkanélküliségi ráta",
         unit_of_measure="%", decimals=1, description="FAKE. Unemployed as a share of the labor force."),
    dict(indicator_id="employed", name_en="Employed persons", name_hu="Foglalkoztatottak száma",
         unit_of_measure="persons", decimals=0, description="FAKE. Number of employed residents."),
]
indicator_values = []
local = {}   # (unit_id, year) -> (employed, wage, unemployment)
for code, (name, _c, _j, _s, reg2010, reg2018, lean) in SETTLEMENTS.items():
    size = reg2010 / 60400
    for year, reg, wage_base, unemp_base in [(2011, reg2010, 160000, 11.0), (2022, reg2018, 420000, 5.0)]:
        if reg is None:   # Kiskamu no longer exists in 2022 (Nagykamu's 2022 figure includes it)
            continue
        employed = round(reg * (0.52 if year == 2011 else 0.58) * noise())
        wage = round(wage_base * (1 + 0.35 * size) * (1 - 0.1 * lean) * noise(), -2)
        unemp = round(unemp_base * (1 - 0.3 * size) * (1 + 0.2 * lean) * noise(), 1)
        local[(sid[code], year)] = (employed, wage, unemp)


def ancestors_at(unit_id: str, day: str) -> list[str]:
    out, current = [], unit_id
    while True:
        links = [p for p in parents if p["child_unit_id"] == current
                 and (p["valid_from"] is None or p["valid_from"] <= day)
                 and (p["valid_to"] is None or day < p["valid_to"])]
        if not links:
            return out
        current = links[0]["parent_unit_id"]
        out.append(current)


groups: dict[tuple[str, int], list[tuple[int, float, float]]] = {}
for (uid, year), values in local.items():
    day = "2011-06-01" if year == 2011 else "2022-06-01"
    targets = ancestors_at(uid, day)
    if year == 2011:   # statistics offices back-cast járás figures; do the same
        jaras = next(p["parent_unit_id"] for p in parents if p["child_unit_id"] == uid and p["parent_unit_id"].startswith("jaras-"))
        targets.append(jaras)
    for target in [uid, *targets]:
        groups.setdefault((target, year), []).append(values)
for (uid, year), rows in sorted(groups.items()):
    employed = sum(r[0] for r in rows)
    wage = round(sum(r[0] * r[1] for r in rows) / employed, -2)
    unemp = round(sum(r[0] * r[2] for r in rows) / employed, 1)
    for ind, value in [("employed", employed), ("avg_wage", wage), ("unemployment_rate", unemp)]:
        indicator_values.append(dict(unit_id=uid, indicator_id=ind, year=year, value=value))

# ----------------------------------------------------------------------------------------------
# Write files

TABLES = {
    "units.csv": units, "unit_names.csv": unit_names, "unit_parents.csv": parents, "unit_lineage.csv": lineage,
    "district_sets.csv": district_sets, "elections.csv": elections, "election_rounds.csv": rounds,
    "electoral_districts.csv": districts, "district_memberships.csv": memberships,
    "polling_stations.csv": polling_stations, "parties.csv": parties, "party_names.csv": party_names,
    "party_lists.csv": party_lists, "party_list_members.csv": list_members, "candidates.csv": candidates,
    "candidate_parties.csv": candidate_parties, "turnout.csv": turnout, "list_results.csv": list_results,
    "candidate_results.csv": candidate_results, "indicators.csv": indicators, "indicator_values.csv": indicator_values,
}

if __name__ == "__main__":
    for file_name, rows in TABLES.items():
        with (HERE / file_name).open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
            writer.writeheader()
            writer.writerows({k: ("" if v is None else v) for k, v in row.items()} for row in rows)
        print(f"{file_name:<28} {len(rows):>5} rows")
    (HERE / "geometries.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "name": "FAKE fixture geometries", "features": geometries},
                   ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"{'geometries.geojson':<28} {len(geometries):>5} features")
