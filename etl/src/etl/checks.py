"""Data-quality checks (`etl check`). Run after every load.

Each check is one SQL query returning a short text per offending row. ERRORs make the website
wrong (e.g. double counting); WARNINGs are worth a look but can be genuine (e.g. transfer
polling stations with more voters than registered).
"""

from __future__ import annotations

from dataclasses import dataclass

import psycopg

from .export.context import FIXTURE_SOURCE_NAME

RESULT_UNITS = """(
    SELECT election_id, unit_id FROM turnout
    UNION SELECT election_id, unit_id FROM list_result
    UNION SELECT election_id, unit_id FROM candidate_result
)"""

# (level, name, description, query)
CHECKS: list[tuple[str, str, str, str]] = [
    (
        "ERROR", "fake-and-real-mixed", "FAKE fixture data shares the database with other sources",
        f"""SELECT name FROM source
            WHERE name <> '{FIXTURE_SOURCE_NAME}' AND EXISTS (SELECT 1 FROM source WHERE name = '{FIXTURE_SOURCE_NAME}')""",
    ),
    (
        "ERROR", "two-levels", "results stored per polling station AND for the whole settlement (double counting)",
        f"""SELECT DISTINCT r.election_id || ': ' || ps.local_unit_id
            FROM {RESULT_UNITS} r
            JOIN polling_station ps ON ps.unit_id = r.unit_id
            JOIN {RESULT_UNITS} s ON s.election_id = r.election_id AND s.unit_id = ps.local_unit_id""",
    ),
    (
        "ERROR", "unit-not-valid", "results for a unit that did not exist on election day",
        f"""SELECT DISTINCT r.election_id || ': ' || r.unit_id
            FROM {RESULT_UNITS} r
            JOIN election e USING (election_id)
            JOIN unit u ON u.unit_id = r.unit_id
            WHERE NOT daterange(u.valid_from, u.valid_to) @> e.election_date""",
    ),
    (
        "ERROR", "no-parent", "settlement with results but no parent unit on election day",
        f"""SELECT DISTINCT r.election_id || ': ' || l.local_unit_id
            FROM {RESULT_UNITS} r
            JOIN election e USING (election_id)
            JOIN (SELECT unit_id, unit_id AS local_unit_id FROM unit WHERE unit_type IN ('settlement', 'bp_district')
                  UNION ALL SELECT unit_id, local_unit_id FROM polling_station) l ON l.unit_id = r.unit_id
            WHERE NOT EXISTS (SELECT 1 FROM unit_parent p WHERE p.child_unit_id = l.local_unit_id
                              AND daterange(p.valid_from, p.valid_to) @> e.election_date)""",
    ),
    (
        "ERROR", "candidate-wrong-district-set", "candidate's district is not in the election's district set",
        """SELECT c.election_id || ': ' || c.name || ' (' || c.district_unit_id || ')'
           FROM candidate c
           JOIN election e USING (election_id)
           JOIN electoral_district ed ON ed.unit_id = c.district_unit_id
           WHERE ed.district_set_id IS DISTINCT FROM e.district_set_id""",
    ),
    (
        "WARNING", "list-votes-exceed-valid", "party-list votes add up to more than the valid list ballots",
        """SELECT t.election_id || ': ' || t.unit_id || ' (' || l.votes || ' > ' || t.valid || ')'
           FROM turnout t
           JOIN (SELECT election_id, round_no, unit_id, sum(votes) AS votes FROM list_result GROUP BY 1, 2, 3) l
             USING (election_id, round_no, unit_id)
           WHERE t.ballot = 'list' AND l.votes > t.valid""",
    ),
    (
        "WARNING", "candidate-votes-exceed-valid", "candidate votes add up to more than the valid candidate ballots",
        """SELECT t.election_id || ': ' || t.unit_id || ' (' || c.votes || ' > ' || t.valid || ')'
           FROM turnout t
           JOIN (SELECT election_id, round_no, unit_id, sum(votes) AS votes FROM candidate_result GROUP BY 1, 2, 3) c
             USING (election_id, round_no, unit_id)
           WHERE t.ballot = 'candidate' AND c.votes > t.valid""",
    ),
    (
        "WARNING", "voted-exceeds-registered", "more voters than registered voters",
        """SELECT election_id || ' round ' || round_no || ': ' || unit_id
           FROM turnout WHERE voted > registered""",
    ),
    (
        "WARNING", "missing-geometry", "unit with results has no boundary on election day (not on the map)",
        """SELECT DISTINCT r.election_id || ': ' || r.target_unit_id
           FROM mv_rollup r
           JOIN election e USING (election_id)
           WHERE NOT EXISTS (SELECT 1 FROM unit_geometry g WHERE g.unit_id = r.target_unit_id
                             AND daterange(g.valid_from, g.valid_to) @> e.election_date)""",
    ),
]


@dataclass(frozen=True)
class Problem:
    level: str
    check: str
    message: str


def run_checks(conn: psycopg.Connection, max_examples: int = 10) -> list[Problem]:
    problems = []
    for level, name, description, query in CHECKS:
        rows = [r[0] for r in conn.execute(query).fetchall()]
        if rows:
            examples = ", ".join(rows[:max_examples]) + (f", ... ({len(rows)} in total)" if len(rows) > max_examples else "")
            problems.append(Problem(level, name, f"{description}: {examples}"))
    return problems
