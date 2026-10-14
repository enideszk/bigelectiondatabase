"""data/units/index.json and data/units/{unit_id}.json"""

from __future__ import annotations

from datetime import date, timedelta

from .context import ExportContext, iso

LOCAL_TYPES = {"settlement", "bp_district"}
# Units whose sidebar lists single-member races and their districts.
RACE_TYPES = {"settlement", "bp_district", "jaras", "county", "smd"}
# Units above county level: too many districts to list, so show districts won per party instead.
WINS_TYPES = {"country", "nuts1", "nuts2"}


def _reference_day(unit: dict) -> date:
    """Today for units that still exist, else their last day."""
    return unit["valid_to"] - timedelta(days=1) if unit["valid_to"] else date.today()


def build_unit_index(ctx: ExportContext) -> dict:
    entries = []
    for unit_id in ctx.clickable_unit_ids:
        unit = ctx.units[unit_id]
        chain = [a["ancestor_id"] for a in reversed(ctx.ancestors_on(unit_id, _reference_day(unit)))]
        entries.append(
            {
                "id": unit_id,
                "type": unit["unit_type"],
                "name": unit["name"],
                "name_en": unit["name_en"],
                "parents": chain,
                "valid_from": iso(unit["valid_from"]),
                "valid_to": iso(unit["valid_to"]),
            }
        )
    return {"units": entries}


def build_unit_file(ctx: ExportContext, unit_id: str) -> dict:
    unit = ctx.units[unit_id]
    parents = sorted(ctx.ancestors.get(unit_id, []), key=lambda a: (a["depth"], a["valid_from"] or date.min))
    elections = {}
    for election_id, election in ctx.elections.items():
        key = (election_id, unit_id)
        if key in ctx.turnout or key in ctx.list_votes or key in ctx.candidate_votes:
            elections[election_id] = _unit_election(ctx, unit, election)
    return {
        "id": unit_id,
        "type": unit["unit_type"],
        "code": unit["code"],
        "name": unit["name"],
        "name_en": unit["name_en"],
        "valid_from": iso(unit["valid_from"]),
        "valid_to": iso(unit["valid_to"]),
        "former_names": [
            {"name": r["name"], "valid_from": iso(r["valid_from"]), "valid_to": iso(r["valid_to"])}
            for r in ctx.former_names.get(unit_id, [])
        ],
        "parents": [
            {
                "id": a["ancestor_id"],
                "type": ctx.units[a["ancestor_id"]]["unit_type"],
                "name": ctx.units[a["ancestor_id"]]["name"],
                "name_en": ctx.units[a["ancestor_id"]]["name_en"],
                "depth": a["depth"],
                "valid_from": iso(a["valid_from"]),
                "valid_to": iso(a["valid_to"]),
            }
            for a in parents
        ],
        "lineage": ctx.lineage.get(unit_id, []),
        "elections": elections,
        "indicators": [
            {"indicator": r["indicator_id"], "year": r["year"], "value": r["value"]}
            for r in ctx.indicator_values.get(unit_id, [])
        ],
    }


def _unit_election(ctx: ExportContext, unit: dict, election: dict) -> dict:
    key = (election["election_id"], unit["unit_id"])
    return {
        "districts": _districts(ctx, unit, election),
        "turnout": [
            {k: t[k] for k in ("registered", "voted", "valid", "invalid")} | {"round": t["round_no"], "ballot": t["ballot"]}
            for t in ctx.turnout.get(key, [])
        ],
        "lists": [
            {"round": r["round_no"], **ctx.list_display(r["list_id"]), "votes": r["votes"]}
            for r in ctx.list_votes.get(key, [])
        ],
        "races": _races(ctx, unit, election) if unit["unit_type"] in RACE_TYPES else [],
        "district_wins": _district_wins(ctx, unit, election) if unit["unit_type"] in WINS_TYPES else [],
    }


def _in_set(ctx: ExportContext, district_id: str, set_id: str) -> bool:
    return ctx.electoral_districts[district_id]["district_set_id"] == set_id


def _districts(ctx: ExportContext, unit: dict, election: dict) -> list[dict]:
    set_id = election["district_set_id"]
    unit_id, unit_type = unit["unit_id"], unit["unit_type"]
    if set_id is None:
        return []
    if unit_type == "smd":
        ids = {unit_id} if _in_set(ctx, unit_id, set_id) else set()
    elif unit_type in LOCAL_TYPES:
        ids = {d for d in ctx.memberships.get(unit_id, []) if _in_set(ctx, d, set_id)}
    elif unit_type in ("county", "jaras"):
        members = ctx.descendants_on(election["election_id"]).get(unit_id, set())
        ids = {d for m in members for d in ctx.memberships.get(m, []) if _in_set(ctx, d, set_id)}
    else:
        ids = set()
    return [{"id": d, "name": ctx.units[d]["name"]} for d in sorted(ids, key=lambda d: ctx.units[d]["name"])]


def _candidate_display(ctx: ExportContext, candidate_id: int, votes: int) -> dict:
    cand = ctx.candidates[candidate_id]
    day = ctx.elections[cand["election_id"]]["election_date"]
    return {
        "candidate_id": candidate_id,
        "name": cand["name"],
        "parties": [ctx.party_short_name(p, day) for p in cand["party_ids"]],
        "color": ctx.party_color(cand["party_ids"]),
        "votes": votes,
    }


def _races(ctx: ExportContext, unit: dict, election: dict) -> list[dict]:
    by_race: dict[tuple[str, int], list[dict]] = {}
    for r in ctx.candidate_votes.get((election["election_id"], unit["unit_id"]), []):
        district = ctx.candidates[r["candidate_id"]]["district_unit_id"]
        by_race.setdefault((district, r["round_no"]), []).append(_candidate_display(ctx, r["candidate_id"], r["votes"]))
    return [
        {
            "district": {"id": district, "name": ctx.units[district]["name"]},
            "round": round_no,
            "candidates": sorted(cands, key=lambda c: -c["votes"]),
        }
        for (district, round_no), cands in sorted(by_race.items(), key=lambda kv: (ctx.units[kv[0][0]]["name"], kv[0][1]))
    ]


def _district_wins(ctx: ExportContext, unit: dict, election: dict) -> list[dict]:
    set_id, election_id = election["district_set_id"], election["election_id"]
    if set_id is None:
        return []
    inside = ctx.descendants_on(election_id).get(unit["unit_id"], set())
    counties = {u for u in inside if ctx.units[u]["unit_type"] == "county"}
    wins: dict[tuple[str, ...], int] = {}
    for district_id, district in ctx.electoral_districts.items():
        if district["district_set_id"] != set_id or district["county_unit_id"] not in counties:
            continue
        rows = ctx.candidate_votes.get((election_id, district_id), [])
        if not rows:
            continue
        final_round = max(r["round_no"] for r in rows)
        winner = max((r for r in rows if r["round_no"] == final_round), key=lambda r: r["votes"])
        key = tuple(ctx.candidates[winner["candidate_id"]]["party_ids"])
        wins[key] = wins.get(key, 0) + 1
    day = election["election_date"]
    return [
        {"parties": [ctx.party_short_name(p, day) for p in key], "color": ctx.party_color(list(key)), "districts": n}
        for key, n in sorted(wins.items(), key=lambda kv: -kv[1])
    ]
