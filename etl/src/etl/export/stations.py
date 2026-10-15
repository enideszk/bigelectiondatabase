"""data/stations/{election_id}.json: every polling station's results, for the polling station list.

One row per station:
    id        "MAZ-OEVK-TAZ-SZK": NVI county code, electoral district number, NVI settlement code,
              station number (2-2-3-3 digits), as NVI numbers them
    unit      the settlement or Budapest district it is in; district: its electoral district
    tl, te    turnout of the list / candidate ballot: [registered, voted, valid, invalid]
    L         party-list votes (round 1), in the order of the election file's L options
    E         candidate votes (the district's last round at the station), as [index in candidates,
              votes]; `candidates` holds each one's name and nominating parties (index of the E
              option), so the list can name the candidates as the side panel does
Votes cast by mail belong to no station (unit special-mail) and are not here.
"""

from __future__ import annotations

from collections import defaultdict

import psycopg

from .context import ExportContext

STATIONS_SQL = """
SELECT unit_id, nvi_code, local_unit_id, district_unit_id, is_transfer
FROM polling_station WHERE election_id = %(e)s
ORDER BY nvi_code, unit_id
"""
TURNOUT_SQL = """
SELECT t.unit_id, t.round_no, t.ballot, t.registered, t.voted, t.valid, t.invalid
FROM turnout t JOIN polling_station ps USING (unit_id)
WHERE ps.election_id = %(e)s AND t.election_id = %(e)s
"""
LISTS_SQL = """
SELECT r.unit_id, r.list_id, r.votes
FROM list_result r JOIN polling_station ps USING (unit_id) JOIN party_list l USING (list_id)
WHERE ps.election_id = %(e)s AND r.election_id = %(e)s AND r.round_no = 1 AND l.list_kind = 'party'
"""
CANDIDATES_SQL = """
SELECT r.unit_id, r.round_no, r.candidate_id, r.votes
FROM candidate_result r JOIN polling_station ps USING (unit_id)
WHERE ps.election_id = %(e)s AND r.election_id = %(e)s
"""


def station_id(nvi_code: str | None, district_unit_id: str | None) -> str:
    """"01-001-002" + "smd-2011-01-03" -> "01-03-001-002"."""
    county, settlement, number = (nvi_code or "??-???-???").split("-")
    oevk = district_unit_id.rsplit("-", 1)[1] if district_unit_id else "00"
    return f"{county}-{oevk}-{settlement}-{number}"


def build_station_file(conn: psycopg.Connection, ctx: ExportContext, election_id: str, options: dict[str, list[str]]) -> dict | None:
    """None for an election without polling-station data."""
    params = {"e": election_id}
    stations = conn.execute(STATIONS_SQL, params).fetchall()
    if not stations:
        return None
    l_index = {o: i for i, o in enumerate(options.get("L", []))}
    e_index = {o: i for i, o in enumerate(options.get("E", []))}

    turnout: dict[tuple[str, str], tuple[int, list]] = {}
    for unit_id, round_no, ballot, *values in conn.execute(TURNOUT_SQL, params):
        # list ballot: round 1; candidate ballot: the last round held at the station
        keep = turnout.get((unit_id, ballot))
        if keep is None or (ballot == "candidate" and round_no > keep[0]) or (ballot == "list" and round_no == 1):
            turnout[(unit_id, ballot)] = (round_no, list(values))

    lists: dict[str, list[int]] = defaultdict(lambda: [0] * len(l_index))
    for unit_id, list_id, votes in conn.execute(LISTS_SQL, params):
        i = l_index.get(ctx.list_option_id(list_id))
        if i is not None:
            lists[unit_id][i] += votes

    last_round: dict[str, int] = {}
    candidate_rows = conn.execute(CANDIDATES_SQL, params).fetchall()
    for unit_id, round_no, _, _ in candidate_rows:
        last_round[unit_id] = max(last_round.get(unit_id, 0), round_no)
    kept = [
        (unit_id, candidate_id, votes)
        for unit_id, round_no, candidate_id, votes in candidate_rows
        if round_no == last_round[unit_id]
        and ctx.group_display(ctx.candidates[candidate_id]["party_ids"], election_id)["id"] in e_index
    ]
    # the candidates by district, then as loaded (ballot order)
    candidate_ids = sorted({c for _, c, _ in kept}, key=lambda c: (ctx.candidates[c]["district_unit_id"] or "", c))
    c_index = {c: i for i, c in enumerate(candidate_ids)}
    candidates: dict[str, dict[int, int]] = defaultdict(dict)
    for unit_id, candidate_id, votes in kept:
        i = c_index[candidate_id]
        candidates[unit_id][i] = candidates[unit_id].get(i, 0) + votes

    empty = [None, None, None, None]
    rows = []
    for unit_id, nvi_code, local_unit_id, district_unit_id, is_transfer in stations:
        row = {
            "id": station_id(nvi_code, district_unit_id),
            "unit": local_unit_id,
            "district": district_unit_id,
            "tl": turnout.get((unit_id, "list"), (0, empty))[1],
            "te": turnout.get((unit_id, "candidate"), (0, empty))[1],
            "L": lists[unit_id] if unit_id in lists else [0] * len(l_index),
            "E": sorted([i, v] for i, v in candidates.get(unit_id, {}).items()),
        }
        if is_transfer:
            row["transfer"] = True
        rows.append(row)
    rows.sort(key=lambda r: r["id"])
    return {
        "options": {"L": list(l_index), "E": list(e_index)},
        "candidates": [
            {
                "name": ctx.candidates[c]["name"],
                "option": e_index[ctx.group_display(ctx.candidates[c]["party_ids"], election_id)["id"]],
            }
            for c in candidate_ids
        ],
        "stations": rows,
    }
