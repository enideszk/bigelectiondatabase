"""data/elections/{election_id}.json and data/shares/{election_id}/{view}/{option_id}.json

Two result views per election, as the side panel's L / E toggle:
    L   party lists, round 1; shares of all valid list ballots (nationality lists included), as the
        official results count them
    E   single-member races by the candidates' nominating parties (joint candidates of a list's
        parties take the list's name and color); each district's final round; shares of all
        candidate votes in those rounds
An "option" is a list (L) or a nominating-party combination (E). The election file holds what the
map needs at once: the options, the winning option per unit (colors) and a summary per unit (hover
card). The share of one option in every unit (the vote-share map) is a file of its own, fetched
only when that option is picked.
"""

from __future__ import annotations

from collections import defaultdict

from .context import ExportContext

CARD_OPTIONS = 4  # options shown on the map's hover card


def build_election_files(ctx: ExportContext, election_id: str) -> dict[str, object]:
    """-> {path below data/: JSON-able content} for one election."""
    files: dict[str, object] = {}
    views = {}
    for view, tally in (("L", _list_tally(ctx, election_id)), ("E", _candidate_tally(ctx, election_id))):
        if not tally.units:
            views[view] = None
            continue
        views[view] = tally.view()
        for option_id, shares in tally.shares().items():
            files[f"shares/{election_id}/{view}/{option_id}.json"] = shares
    files[f"elections/{election_id}.json"] = {"id": election_id, "views": views}
    return files


class _Tally:
    """Votes per option in every clickable unit with results."""

    def __init__(self) -> None:
        self.options: dict[str, dict] = {}                      # option id -> display (+ "votes")
        self.units: dict[str, dict[str, int]] = {}               # unit -> option -> votes
        self.denominators: dict[str, int] = {}
        self.turnout: dict[str, float | None] = {}

    def add_unit(self, unit_id: str, votes: dict[str, int], denominator: int | None, registered, voted) -> None:
        total = denominator or sum(votes.values())
        if not votes or not total:
            return
        self.units[unit_id] = votes
        self.denominators[unit_id] = total
        self.turnout[unit_id] = round(voted / registered, 4) if registered and voted is not None else None

    def ranked(self, unit_id: str) -> list[tuple[str, int]]:
        # most votes first; ties in the options' national order
        order = {o: i for i, o in enumerate(self.options)}
        return sorted(self.units[unit_id].items(), key=lambda kv: (-kv[1], order[kv[0]]))

    def view(self) -> dict:
        # options by national votes (the sum over the country unit's own tally where there is one)
        national: dict[str, int] = defaultdict(int)
        countries = [u for u in self.units if u.startswith("country-")]
        for unit_id in countries or list(self.units):
            for option_id, votes in self.units[unit_id].items():
                national[option_id] += votes
        self.options = dict(sorted(self.options.items(), key=lambda kv: (-national.get(kv[0], 0), kv[0])))
        for option_id, option in self.options.items():
            option["votes"] = national.get(option_id, 0)
        winners, summaries = {}, {}
        for unit_id in self.units:
            ranked = self.ranked(unit_id)
            winners[unit_id] = ranked[0][0]
            total = self.denominators[unit_id]
            summaries[unit_id] = {
                "turnout": self.turnout[unit_id],
                "top": [[option_id, round(votes / total, 4)] for option_id, votes in ranked[:CARD_OPTIONS]],
            }
        return {"options": list(self.options.values()), "winners": winners, "summaries": summaries}

    def shares(self) -> dict[str, dict[str, float]]:
        out: dict[str, dict[str, float]] = defaultdict(dict)
        for unit_id, votes in self.units.items():
            total = self.denominators[unit_id]
            for option_id, n in votes.items():
                out[option_id][unit_id] = round(n / total, 4)
        return dict(out)


def _turnout_row(ctx: ExportContext, election_id: str, unit_id: str, ballot: str, round_no: int) -> dict:
    rows = ctx.turnout.get((election_id, unit_id), [])
    return next((t for t in rows if t["round_no"] == round_no and t["ballot"] == ballot), {})


def _list_tally(ctx: ExportContext, election_id: str) -> _Tally:
    tally = _Tally()
    for (eid, unit_id), rows in ctx.list_votes.items():
        if eid != election_id or not ctx.units[unit_id]["is_clickable"]:
            continue
        votes: dict[str, int] = {}
        for r in rows:
            if r["round_no"] == 1:
                display = ctx.list_display(r["list_id"])
                option_id = display["option"]
                votes[option_id] = votes.get(option_id, 0) + r["votes"]
                if option_id not in tally.options:
                    tally.options[option_id] = {"id": option_id} | {
                        k: display[k] for k in ("name", "short_name", "color", "parties")
                    }
        t = _turnout_row(ctx, election_id, unit_id, "list", 1)
        tally.add_unit(unit_id, votes, t.get("valid"), t.get("registered"), t.get("voted"))
    return tally


def _candidate_tally(ctx: ExportContext, election_id: str) -> _Tally:
    tally = _Tally()
    for (eid, unit_id), rows in ctx.candidate_votes.items():
        if eid != election_id or not ctx.units[unit_id]["is_clickable"]:
            continue
        # each race (district) counts with its final round
        final: dict[str, int] = {}
        for r in rows:
            district = ctx.candidates[r["candidate_id"]]["district_unit_id"]
            final[district] = max(final.get(district, 0), r["round_no"])
        votes: dict[str, int] = {}
        for r in rows:
            candidate = ctx.candidates[r["candidate_id"]]
            if r["round_no"] != final[candidate["district_unit_id"]]:
                continue
            group = ctx.group_display(candidate["party_ids"], election_id)
            votes[group["id"]] = votes.get(group["id"], 0) + r["votes"]
            tally.options.setdefault(group["id"], dict(group))
        t = _turnout_row(ctx, election_id, unit_id, "candidate", max(final.values(), default=1))
        tally.add_unit(unit_id, votes, None, t.get("registered"), t.get("voted"))
    return tally
