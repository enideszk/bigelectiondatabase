"""Helpers shared by all loaders: registering a source, reading CSVs, bulk inserts."""

from __future__ import annotations

import csv
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import psycopg
from psycopg import sql


@dataclass(frozen=True)
class SourceInfo:
    """One row of the `source` table. `name` is the loader's stable identity: reloading a source
    with the same name first deletes everything loaded from it before."""

    name: str
    publisher: str | None = None
    url: str | None = None
    file_name: str | None = None
    downloaded_on: date | None = None
    license: str | None = None
    notes: str | None = None


def replace_source(conn: psycopg.Connection, info: SourceInfo) -> int:
    """Delete everything previously loaded from this source (via ON DELETE CASCADE) and register
    it again. Returns the new source_id. Call inside a transaction, together with the inserts, so
    a failed load leaves the old data in place.

    Postgres refuses the delete if rows from *other* sources still reference rows of this one
    (e.g. results pointing at units). Reload or delete those sources first."""
    conn.execute("DELETE FROM source WHERE name = %s", (info.name,))
    row = conn.execute(
        """
        INSERT INTO source (name, publisher, url, file_name, downloaded_on, license, notes)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING source_id
        """,
        (info.name, info.publisher, info.url, info.file_name, info.downloaded_on, info.license, info.notes),
    ).fetchone()
    assert row is not None
    return row[0]


def read_csv(path: Path) -> list[dict[str, str | None]]:
    """Read a UTF-8 CSV with a header row. Empty cells become None."""
    with path.open(encoding="utf-8-sig", newline="") as f:
        return [{k: (v if v != "" else None) for k, v in row.items()} for row in csv.DictReader(f)]


def copy_rows(conn: psycopg.Connection, table: str, columns: Sequence[str], rows: Iterable[Sequence]) -> int:
    """Bulk insert with COPY. Values may be Python objects or strings (Postgres parses them)."""
    statement = sql.SQL("COPY {} ({}) FROM STDIN").format(
        sql.Identifier(table), sql.SQL(", ").join(sql.Identifier(c) for c in columns)
    )
    count = 0
    with conn.cursor().copy(statement) as copy:
        for row in rows:
            copy.write_row(row)
            count += 1
    return count


def copy_csv(conn: psycopg.Connection, table: str, path: Path, source_id: int | None) -> int:
    """Load a CSV whose header row matches column names of `table`.
    If source_id is given, it is added to every row."""
    rows = read_csv(path)
    if not rows:
        return 0
    columns = list(rows[0].keys())
    values = [[row[c] for c in columns] for row in rows]
    if source_id is not None:
        columns.append("source_id")
        for v in values:
            v.append(source_id)
    return copy_rows(conn, table, columns, values)


def load_geojson_geometries(conn: psycopg.Connection, path: Path, source_id: int) -> int:
    """Load a GeoJSON FeatureCollection (EPSG:4326) into unit_geometry. Each feature needs the
    properties unit_id, valid_from, valid_to (dates may be null)."""
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO unit_geometry (unit_id, valid_from, valid_to, geom, source_id)
            VALUES (%s, %s, %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), %s)
            """,
            [
                (
                    f["properties"]["unit_id"],
                    f["properties"].get("valid_from"),
                    f["properties"].get("valid_to"),
                    json.dumps(f["geometry"]),
                    source_id,
                )
                for f in features
            ],
        )
    return len(features)


def reset_serial(conn: psycopg.Connection, table: str, column: str) -> None:
    """After inserting explicit ids into a serial column, move its sequence past the max."""
    conn.execute(
        sql.SQL("SELECT setval(pg_get_serial_sequence({t}, {c}), COALESCE(max({col}), 0) + 1, false) FROM {tbl}").format(
            t=sql.Literal(table), c=sql.Literal(column), col=sql.Identifier(column), tbl=sql.Identifier(table)
        )
    )
