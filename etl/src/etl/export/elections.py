"""data/elections/{election_id}.json"""

from __future__ import annotations

from .context import ExportContext


def build_election_file(ctx: ExportContext, election_id: str) -> dict:
    list_ids = sorted(lid for lid, row in ctx.lists.items() if row["election_id"] == election_id)
    return {
        "id": election_id,
        "lists": [ctx.list_display(lid) for lid in list_ids],
        "winners": ctx.winners.get(election_id, {}),
    }
