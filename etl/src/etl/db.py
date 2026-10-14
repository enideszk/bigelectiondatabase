"""Database connection, migration runner, reset and refresh.

Migrations are plain SQL files in db/migrations/ named NNNN_description.sql. They are applied in
order, each in its own transaction, and recorded in the schema_migration table together with a
checksum. An applied migration must never be edited: add a new one instead (the runner refuses
to continue if an applied file changed).
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import psycopg

from . import config

MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    path: Path

    @property
    def sql(self) -> str:
        return self.path.read_text(encoding="utf-8")

    @property
    def checksum(self) -> str:
        # Normalize line endings so a checkout with CRLF has the same checksum.
        return hashlib.sha256(self.sql.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(url or config.database_url())


def migration_files(directory: Path = config.MIGRATIONS_DIR) -> list[Migration]:
    migrations = []
    for path in sorted(directory.glob("*.sql")):
        match = MIGRATION_NAME.match(path.name)
        if not match:
            raise MigrationError(f"Bad migration file name: {path.name} (expected NNNN_description.sql)")
        migrations.append(Migration(match.group(1), path))
    versions = [m.version for m in migrations]
    duplicates = {v for v in versions if versions.count(v) > 1}
    if duplicates:
        raise MigrationError(f"Duplicate migration versions: {sorted(duplicates)}")
    return migrations


def _ensure_migration_table(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migration (
            version     text PRIMARY KEY,
            file_name   text NOT NULL,
            checksum    text NOT NULL,
            applied_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    conn.commit()


def applied_migrations(conn: psycopg.Connection) -> dict[str, tuple[str, str]]:
    """version -> (file_name, checksum)"""
    _ensure_migration_table(conn)
    rows = conn.execute("SELECT version, file_name, checksum FROM schema_migration").fetchall()
    return {version: (file_name, checksum) for version, file_name, checksum in rows}


def pending_migrations(conn: psycopg.Connection, directory: Path = config.MIGRATIONS_DIR) -> list[Migration]:
    files = migration_files(directory)
    applied = applied_migrations(conn)
    by_version = {m.version: m for m in files}
    for version, (file_name, checksum) in sorted(applied.items()):
        migration = by_version.get(version)
        if migration is None:
            raise MigrationError(f"Migration {version} ({file_name}) was applied but its file is missing.")
        if migration.checksum != checksum:
            raise MigrationError(
                f"Migration {migration.path.name} changed after it was applied. "
                "Never edit applied migrations; add a new one (or `etl db reset` on a dev database)."
            )
    return [m for m in files if m.version not in applied]


def migrate(conn: psycopg.Connection, directory: Path = config.MIGRATIONS_DIR) -> list[Migration]:
    """Apply all pending migrations. Returns the ones applied."""
    done = []
    for migration in pending_migrations(conn, directory):
        with conn.transaction():
            conn.execute(migration.sql)
            conn.execute(
                "INSERT INTO schema_migration (version, file_name, checksum) VALUES (%s, %s, %s)",
                (migration.version, migration.path.name, migration.checksum),
            )
        done.append(migration)
    return done


def reset(conn: psycopg.Connection) -> None:
    """Drop every table, view and row (the whole public schema). PostGIS lives in the
    `extensions` schema and survives."""
    with conn.transaction():
        conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
        conn.execute("CREATE SCHEMA public")


def refresh_aggregates(conn: psycopg.Connection) -> None:
    with conn.transaction():
        conn.execute("CALL refresh_aggregates()")
