"""Database -> static JSON files for the website.

The file shapes are defined in web/src/lib/types.ts (the contract); the tests validate the output
against the JSON Schema generated from it. Everything is read with a handful of bulk queries
(see context.py) and assembled in Python, so export time does not grow with round trips.

Output (default web/public/data/):
    meta.json                 elections, indicators, unit types
    units/index.json          every clickable unit, for search and breadcrumbs
    units/{unit_id}.json      everything about one unit
    elections/{id}.json       winning list per unit (map colors) and the list palette

Writing thousands of small files is dominated by per-file latency when the repo is on a network
share (~11 ms per file over SMB vs < 1 ms locally), so files are built in memory first and then
written in parallel; files are overwritten in place and only stale ones are deleted.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import psycopg

from .context import ExportContext
from .elections import build_election_file
from .meta import build_meta
from .units import build_unit_file, build_unit_index

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")
WRITE_THREADS = 32


def to_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def write_files(files: dict[Path, str], stale: list[Path] = (), threads: int = WRITE_THREADS) -> None:
    """Write many small files (and delete stale ones) concurrently."""
    with ThreadPoolExecutor(threads) as pool:
        list(pool.map(lambda item: item[0].write_text(item[1], encoding="utf-8"), files.items()))
        list(pool.map(lambda path: path.unlink(missing_ok=True), stale))


def export_all(conn: psycopg.Connection, out: Path) -> dict[str, int]:
    ctx = ExportContext.load(conn)
    for unit_id in ctx.clickable_unit_ids:
        if not SAFE_ID.match(unit_id):
            raise ValueError(f"unit_id {unit_id!r} cannot be used as a file name")

    files: dict[Path, str] = {
        out / "meta.json": to_json(build_meta(ctx)),
        out / "units" / "index.json": to_json(build_unit_index(ctx)),
    }
    files.update({out / "units" / f"{u}.json": to_json(build_unit_file(ctx, u)) for u in ctx.clickable_unit_ids})
    files.update({out / "elections" / f"{e}.json": to_json(build_election_file(ctx, e)) for e in ctx.elections})

    for sub in ("units", "elections"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    stale = [p for sub in ("units", "elections") for p in (out / sub).glob("*.json") if p not in files]
    write_files(files, stale)
    return {"units": len(ctx.clickable_unit_ids), "elections": len(ctx.elections), "stale_removed": len(stale)}
