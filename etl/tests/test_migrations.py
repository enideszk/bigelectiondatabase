"""Migrations apply cleanly, are idempotent, and applied files cannot be edited silently."""

from __future__ import annotations

import shutil

import pytest

from etl import config, db

EXPECTED_TABLES = {
    "source", "unit_type", "unit", "unit_name", "unit_parent", "unit_lineage", "unit_geometry",
    "election_type", "district_set", "election", "election_round", "electoral_district",
    "district_membership", "polling_station", "party", "party_name", "party_list", "party_list_member",
    "candidate", "candidate_party", "turnout", "list_result", "candidate_result", "indicator",
    "indicator_value", "schema_migration",
}
EXPECTED_MATVIEWS = {"mv_rollup", "mv_turnout_agg", "mv_list_result_agg", "mv_candidate_result_agg", "mv_list_winner"}


def test_all_migrations_apply_on_an_empty_database(conn, fresh_schema):
    files = db.migration_files()
    assert [m.version for m in fresh_schema] == [m.version for m in files]
    assert db.pending_migrations(conn) == []
    assert db.migrate(conn) == []  # running again is a no-op


def test_schema_has_expected_objects(conn, fresh_schema):
    tables = {r[0] for r in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")}
    matviews = {r[0] for r in conn.execute("SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'")}
    assert EXPECTED_TABLES <= tables
    assert EXPECTED_MATVIEWS <= matviews
    assert conn.execute("SELECT postgis_lib_version()").fetchone()[0].startswith("3.")


def test_edited_applied_migration_is_refused(conn, fresh_schema, tmp_path):
    for path in config.MIGRATIONS_DIR.glob("*.sql"):
        shutil.copy(path, tmp_path / path.name)
    first = sorted(tmp_path.glob("*.sql"))[0]
    first.write_text(first.read_text(encoding="utf-8") + "\n-- edited\n", encoding="utf-8")
    with pytest.raises(db.MigrationError, match="changed after it was applied"):
        db.pending_migrations(conn, tmp_path)


def test_badly_named_migration_is_refused(tmp_path):
    (tmp_path / "1_too_short.sql").write_text("SELECT 1;", encoding="utf-8")
    with pytest.raises(db.MigrationError, match="Bad migration file name"):
        db.migration_files(tmp_path)
