"""The fixture loads, the data model behaves as designed, and the aggregates add up."""

from __future__ import annotations

import psycopg
import pytest

from etl.checks import run_checks
from etl.loaders import fixtures

from .conftest import scalar


def test_fixture_loads_every_table(seeded):
    empty = [table for table, n in seeded.items() if n == 0]
    assert not empty, f"fixture tables without rows: {empty}"


def test_reloading_the_fixture_gives_the_same_rows(conn, seeded):
    assert fixtures.run(conn) == seeded


def test_no_data_quality_errors(conn, seeded):
    errors = [p for p in run_checks(conn) if p.level == "ERROR"]
    assert errors == []


def test_split_city_belongs_to_two_districts_in_2011_set(conn, seeded):
    districts = conn.execute(
        """
        SELECT dm.district_unit_id FROM district_membership dm
        JOIN electoral_district ed ON ed.unit_id = dm.district_unit_id
        WHERE dm.local_unit_id = 'settlement-99001' AND ed.district_set_id = '2011' ORDER BY 1
        """
    ).fetchall()
    assert [d[0] for d in districts] == ["smd-2011-91-01", "smd-2011-91-02"]


def test_joint_list_has_two_parties(conn, seeded):
    parties = conn.execute(
        """
        SELECT m.party_id FROM party_list l JOIN party_list_member m USING (list_id)
        WHERE l.election_id = 'parliament-2018' AND l.name = 'Piros–Kék Összefogás' ORDER BY m.position
        """
    ).fetchall()
    assert [p[0] for p in parties] == ["red", "blue"]


def test_merge_is_recorded_and_geometry_is_versioned(conn, seeded):
    assert scalar(conn, "SELECT change_type FROM unit_lineage WHERE from_unit_id = 'settlement-99005'") == "merge"
    assert scalar(conn, "SELECT count(*) FROM unit_geometry WHERE unit_id = 'settlement-99004'") == 2


def test_overlapping_validity_periods_are_rejected(conn, seeded):
    with pytest.raises(psycopg.errors.ExclusionViolation):
        with conn.transaction():
            conn.execute(
                """
                INSERT INTO unit_geometry (unit_id, valid_from, valid_to, geom, source_id)
                SELECT unit_id, '2014-01-01', NULL, geom, source_id FROM unit_geometry
                WHERE unit_id = 'settlement-99004' AND valid_to IS NULL
                """
            )


def test_parent_changes_over_time(conn, seeded):
    """Before 2013 a settlement hangs directly under its county; from 2013 under its járás."""
    query = """
        SELECT ancestor_id FROM v_unit_ancestor
        WHERE unit_id = 'settlement-99001' AND period @> %s::date ORDER BY depth
    """
    assert [r[0] for r in conn.execute(query, ("2010-04-11",))][:1] == ["county-91"]
    assert [r[0] for r in conn.execute(query, ("2018-04-08",))][:2] == ["jaras-911", "county-91"]


@pytest.mark.parametrize("election_id", ["parliament-2010", "parliament-2018"])
def test_national_totals_equal_the_sum_of_all_stored_rows(conn, seeded, election_id):
    stored = scalar(conn, "SELECT sum(votes) FROM list_result WHERE election_id = %s", (election_id,))
    national = scalar(
        conn, "SELECT sum(votes) FROM mv_list_result_agg WHERE election_id = %s AND unit_id = 'country-XX'", (election_id,)
    )
    assert national == stored


def test_county_totals_exclude_mail_votes(conn, seeded):
    counties = scalar(
        conn,
        "SELECT sum(votes) FROM mv_list_result_agg WHERE election_id = 'parliament-2018' AND unit_id LIKE 'county-%'",
    )
    mail = scalar(
        conn, "SELECT sum(votes) FROM list_result WHERE election_id = 'parliament-2018' AND unit_id = 'special-mail'"
    )
    national = scalar(
        conn, "SELECT sum(votes) FROM mv_list_result_agg WHERE election_id = 'parliament-2018' AND unit_id = 'country-XX'"
    )
    assert counties + mail == national


def test_split_city_district_totals_come_from_polling_stations(conn, seeded):
    """Alfa 02 (2011 set) = Mintafalva + Próbaváros stations 003/004; its list total must match."""
    district = scalar(
        conn,
        "SELECT sum(votes) FROM mv_list_result_agg WHERE election_id = 'parliament-2018' AND unit_id = 'smd-2011-91-02'",
    )
    parts = scalar(
        conn,
        """
        SELECT sum(votes) FROM list_result WHERE election_id = 'parliament-2018'
        AND unit_id IN ('settlement-99002', 'polling_station-parliament-2018-99001-003', 'polling_station-parliament-2018-99001-004')
        """,
    )
    assert district == parts


def test_candidate_district_totals_are_exact(conn, seeded):
    rows = conn.execute(
        """
        SELECT a.candidate_id, a.votes, (SELECT sum(votes) FROM candidate_result r
                                         WHERE r.candidate_id = a.candidate_id AND r.round_no = a.round_no)
        FROM mv_candidate_result_agg a WHERE a.unit_id LIKE 'smd-%'
        """
    ).fetchall()
    assert rows and all(agg == stored for _, agg, stored in rows)


def test_fixture_refuses_to_mix_with_real_sources(conn, seeded):
    with conn.transaction(force_rollback=True):
        conn.execute("INSERT INTO source (name) VALUES ('some real source')")
        with pytest.raises(fixtures.FixtureRefused):
            fixtures.run(conn)
