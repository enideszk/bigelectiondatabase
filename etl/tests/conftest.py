"""Shared test fixtures. Tests run against TEST_DATABASE_URL, which is WIPED at the start of a run."""

from __future__ import annotations

import os

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict

from etl import config, db
from etl.loaders import fixtures


@pytest.fixture(scope="session")
def test_db_url() -> str:
    url = config.test_database_url()
    if url == os.environ.get("DATABASE_URL"):
        pytest.exit("TEST_DATABASE_URL must differ from DATABASE_URL: the test database is wiped.", returncode=2)
    if not conninfo_to_dict(url).get("dbname", "").endswith("_test"):
        pytest.exit("The test database name must end with _test (it is wiped by the tests).", returncode=2)
    return url


@pytest.fixture(scope="session")
def fresh_schema(test_db_url: str) -> list[db.Migration]:
    """Empty test database with all migrations applied. Returns the migrations that were applied."""
    with db.connect(test_db_url) as conn:
        db.reset(conn)
        return db.migrate(conn)


@pytest.fixture(scope="session")
def seeded(test_db_url: str, fresh_schema: list[db.Migration]) -> dict[str, int]:
    """Test database with the fixture loaded. Returns row counts per table."""
    with db.connect(test_db_url) as conn:
        return fixtures.run(conn)


@pytest.fixture
def conn(test_db_url: str):
    with db.connect(test_db_url) as connection:
        yield connection


def scalar(conn: psycopg.Connection, query: str, params: tuple | None = None):
    row = conn.execute(query, params).fetchone()
    assert row is not None
    return row[0]
