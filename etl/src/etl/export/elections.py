"""data/elections/{election_id}.json"""

from __future__ import annotations

from .context import ExportContext

CARD_LISTS = 4  # party lists shown on the map's hover card


def build_election_file(ctx: ExportContext, election_id: str) -> dict:
    list_ids = sorted(lid for lid, row in ctx.lists.items() if row["election_id"] == election_id and row["list_kind"] == "party")
    winners = ctx.winners.get(election_id, {})
    return {
        "id": election_id,
        "lists": [ctx.list_display(lid) for lid in list_ids],
        "winners": winners,
        "summaries": {unit_id: _summary(ctx, election_id, unit_id) for unit_id in winners},
    }


def _summary(ctx: ExportContext, election_id: str, unit_id: str) -> dict:
    """Turnout and the leading lists of round 1, as shares. The denominator is all valid list
    ballots (nationality lists included), as in the side panel; without a turnout row, the sum of
    the party-list votes."""
    votes = [r for r in ctx.list_votes.get((election_id, unit_id), []) if r["round_no"] == 1]  # most votes first
    turnout = next(
        (t for t in ctx.turnout.get((election_id, unit_id), []) if t["round_no"] == 1 and t["ballot"] == "list"), None
    )
    valid = (turnout or {}).get("valid") or sum(r["votes"] for r in votes)
    registered, voted = (turnout or {}).get("registered"), (turnout or {}).get("voted")
    return {
        "turnout": round(voted / registered, 4) if registered and voted is not None else None,
        "top": [[r["list_id"], round(r["votes"] / valid, 4)] for r in votes[:CARD_LISTS]] if valid else [],
    }
