"""Everything the exporter needs, read from the database in bulk."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import psycopg
from psycopg.rows import dict_row

FIXTURE_SOURCE_NAME = "FAKE fixture data"
INDEPENDENT_COLOR = "#9e9e9e"


def iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def valid_on(row: dict, day: date) -> bool:
    """Half-open [valid_from, valid_to) with NULL = open-ended."""
    return (row["valid_from"] is None or row["valid_from"] <= day) and (row["valid_to"] is None or day < row["valid_to"])


@dataclass
class ExportContext:
    is_fixture: bool
    unit_types: list[dict]
    units: dict[str, dict]                       # unit_id -> unit row (+ rank, is_clickable)
    elections: dict[str, dict]                   # election_id -> row (+ rounds), oldest first
    indicators: list[dict]
    ancestors: dict[str, list[dict]]             # unit_id -> v_unit_ancestor rows
    former_names: dict[str, list[dict]]
    lineage: dict[str, list[dict]]
    party_names: dict[str, list[dict]]           # party_id -> name history
    parties: dict[str, dict]
    lists: dict[int, dict]                       # list_id -> row (+ party_ids)
    candidates: dict[int, dict]                  # candidate_id -> row (+ party_ids)
    electoral_districts: dict[str, dict]         # smd unit_id -> row
    memberships: dict[str, list[str]]            # local unit_id -> [smd unit_id]
    turnout: dict[tuple[str, str], list[dict]] = field(default_factory=dict)            # (election, unit)
    list_votes: dict[tuple[str, str], list[dict]] = field(default_factory=dict)
    candidate_votes: dict[tuple[str, str], list[dict]] = field(default_factory=dict)
    winners: dict[str, dict[str, int]] = field(default_factory=dict)                    # election -> unit -> list
    indicator_values: dict[str, list[dict]] = field(default_factory=dict)
    _descendants: dict[str, dict[str, set[str]]] = field(default_factory=dict, repr=False)

    @property
    def clickable_unit_ids(self) -> list[str]:
        return [u for u, row in self.units.items() if row["is_clickable"]]

    # -- helpers ---------------------------------------------------------------------------

    def party_short_name(self, party_id: str, day: date) -> str:
        for row in self.party_names.get(party_id, []):
            if valid_on(row, day):
                return row["short_name"]
        return self.parties[party_id]["short_name"]

    def party_color(self, party_ids: list[str]) -> str:
        for pid in party_ids:
            if self.parties[pid]["color"]:
                return self.parties[pid]["color"]
        return INDEPENDENT_COLOR

    def list_display(self, list_id: int) -> dict[str, Any]:
        row = self.lists[list_id]
        day = self.elections[row["election_id"]]["election_date"]
        return {
            "list_id": list_id,
            "name": row["name"],
            "short_name": row["short_name"],
            "color": row["color"] or self.party_color(row["party_ids"]),
            "parties": [self.party_short_name(p, day) for p in row["party_ids"]],
        }

    def ancestors_on(self, unit_id: str, day: date) -> list[dict]:
        """Ancestor rows valid on `day`, nearest first."""
        return sorted((a for a in self.ancestors.get(unit_id, []) if valid_on(a, day)), key=lambda a: a["depth"])

    def descendants_on(self, election_id: str) -> dict[str, set[str]]:
        """ancestor unit_id -> unit_ids lying in it on the election's date (computed once per election)."""
        if election_id not in self._descendants:
            day = self.elections[election_id]["election_date"]
            out: dict[str, set[str]] = defaultdict(set)
            for unit_id, links in self.ancestors.items():
                for a in links:
                    if valid_on(a, day):
                        out[a["ancestor_id"]].add(unit_id)
            self._descendants[election_id] = dict(out)
        return self._descendants[election_id]

    # -- loading ---------------------------------------------------------------------------

    @classmethod
    def load(cls, conn: psycopg.Connection) -> ExportContext:
        cur = conn.cursor(row_factory=dict_row)

        def rows(query: str, params: tuple = ()) -> list[dict]:
            return cur.execute(query, params).fetchall()

        def grouped(query: str, key) -> dict:
            out: dict = defaultdict(list)
            for r in rows(query):
                out[key(r)].append(r)
            return dict(out)

        is_fixture = bool(rows("SELECT 1 FROM source WHERE name = %s", (FIXTURE_SOURCE_NAME,)))
        unit_types = rows("SELECT unit_type, name_en, name_hu, rank, is_clickable FROM unit_type ORDER BY rank, unit_type")
        units = {
            r["unit_id"]: r
            for r in rows(
                """
                SELECT u.unit_id, u.unit_type, u.code, u.name, u.name_en, u.valid_from, u.valid_to,
                       t.rank, t.is_clickable
                FROM unit u JOIN unit_type t USING (unit_type)
                ORDER BY t.rank, u.unit_id
                """
            )
        }
        elections = {
            r["election_id"]: r
            for r in rows(
                """
                SELECT e.election_id, e.election_type, t.name_en AS type_name, e.election_date,
                       e.name_en, e.name_hu, e.district_set_id
                FROM election e JOIN election_type t USING (election_type)
                ORDER BY e.election_date, e.election_id
                """
            )
        }
        for e in elections.values():
            e["rounds"] = []
        for r in rows("SELECT election_id, round_no, round_date FROM election_round ORDER BY election_id, round_no"):
            elections[r["election_id"]]["rounds"].append(r)

        parties = {r["party_id"]: r for r in rows("SELECT party_id, name, short_name, color FROM party")}
        lists = {r["list_id"]: r for r in rows("SELECT list_id, election_id, name, short_name, color FROM party_list")}
        for r in lists.values():
            r["party_ids"] = []
        for r in rows("SELECT list_id, party_id FROM party_list_member ORDER BY list_id, position"):
            lists[r["list_id"]]["party_ids"].append(r["party_id"])
        candidates = {
            r["candidate_id"]: r
            for r in rows("SELECT candidate_id, election_id, district_unit_id, name FROM candidate")
        }
        for r in candidates.values():
            r["party_ids"] = []
        for r in rows("SELECT candidate_id, party_id FROM candidate_party ORDER BY candidate_id, position"):
            candidates[r["candidate_id"]]["party_ids"].append(r["party_id"])

        memberships: dict[str, list[str]] = defaultdict(list)
        for r in rows("SELECT local_unit_id, district_unit_id FROM district_membership ORDER BY district_unit_id"):
            memberships[r["local_unit_id"]].append(r["district_unit_id"])

        ctx = cls(
            is_fixture=is_fixture,
            unit_types=unit_types,
            units=units,
            elections=elections,
            indicators=rows(
                """
                SELECT i.indicator_id, i.name_en, i.name_hu, i.unit_of_measure, i.decimals, i.description,
                       s.name AS source_name
                FROM indicator i JOIN source s USING (source_id)
                ORDER BY i.indicator_id
                """
            ),
            ancestors=grouped(
                "SELECT unit_id, ancestor_id, depth, valid_from, valid_to FROM v_unit_ancestor",
                lambda r: r["unit_id"],
            ),
            former_names=grouped(
                "SELECT unit_id, name, valid_from, valid_to FROM unit_name ORDER BY unit_id, valid_from NULLS FIRST",
                lambda r: r["unit_id"],
            ),
            lineage=_lineage(rows),
            party_names=grouped(
                "SELECT party_id, name, short_name, valid_from, valid_to FROM party_name", lambda r: r["party_id"]
            ),
            parties=parties,
            lists=lists,
            candidates=candidates,
            electoral_districts={
                r["unit_id"]: r
                for r in rows("SELECT unit_id, district_set_id, county_unit_id, number FROM electoral_district")
            },
            memberships=dict(memberships),
        )
        ctx.turnout = grouped(
            """
            SELECT election_id, unit_id, round_no, ballot, registered, voted, valid, invalid
            FROM mv_turnout_agg ORDER BY round_no, ballot
            """,
            lambda r: (r["election_id"], r["unit_id"]),
        )
        ctx.list_votes = grouped(
            "SELECT election_id, unit_id, round_no, list_id, votes FROM mv_list_result_agg ORDER BY round_no, votes DESC, list_id",
            lambda r: (r["election_id"], r["unit_id"]),
        )
        ctx.candidate_votes = grouped(
            """
            SELECT election_id, unit_id, round_no, candidate_id, votes
            FROM mv_candidate_result_agg ORDER BY round_no, votes DESC, candidate_id
            """,
            lambda r: (r["election_id"], r["unit_id"]),
        )
        winners: dict[str, dict[str, int]] = defaultdict(dict)
        for r in rows("SELECT election_id, unit_id, list_id FROM mv_list_winner ORDER BY election_id, unit_id"):
            if units[r["unit_id"]]["is_clickable"]:
                winners[r["election_id"]][r["unit_id"]] = r["list_id"]
        ctx.winners = dict(winners)
        ctx.indicator_values = grouped(
            "SELECT unit_id, indicator_id, year, value FROM indicator_value ORDER BY indicator_id, year",
            lambda r: r["unit_id"],
        )
        return ctx


def _lineage(rows) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows(
        """
        SELECT l.from_unit_id, f.name AS from_name, l.to_unit_id, t.name AS to_name,
               l.change_date, l.change_type, l.weight
        FROM unit_lineage l
        JOIN unit f ON f.unit_id = l.from_unit_id
        JOIN unit t ON t.unit_id = l.to_unit_id
        ORDER BY l.change_date
        """
    ):
        common = {"date": iso(r["change_date"]), "type": r["change_type"], "weight": r["weight"]}
        out[r["from_unit_id"]].append({**common, "direction": "to", "other_id": r["to_unit_id"], "other_name": r["to_name"]})
        out[r["to_unit_id"]].append({**common, "direction": "from", "other_id": r["from_unit_id"], "other_name": r["from_name"]})
    return dict(out)
