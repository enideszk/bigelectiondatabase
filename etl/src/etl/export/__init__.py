"""Database -> static JSON files for the website.

The file shapes are defined in web/src/lib/types.ts (the contract); the tests validate the output
against the JSON Schema generated from it. Everything is read with a handful of bulk queries
(see context.py) and assembled in Python, so export time does not grow with round trips.

Output (default web/public/data/):
    meta.json                 elections, indicators, unit types
    units/index.json          every clickable unit, for search and breadcrumbs
    units/{unit_id}.json      everything about one unit
    elections/{id}.json       winning list per unit (map colors) and the list palette
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

import psycopg

from .context import ExportContext
from .elections import build_election_file
from .meta import build_meta
from .units import build_unit_file, build_unit_index

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def export_all(conn: psycopg.Connection, out: Path) -> dict[str, int]:
    ctx = ExportContext.load(conn)
    out.mkdir(parents=True, exist_ok=True)
    for sub in ("units", "elections"):
        shutil.rmtree(out / sub, ignore_errors=True)
        (out / sub).mkdir()

    write_json(out / "meta.json", build_meta(ctx))
    write_json(out / "units" / "index.json", build_unit_index(ctx))
    for unit_id in ctx.clickable_unit_ids:
        if not SAFE_ID.match(unit_id):
            raise ValueError(f"unit_id {unit_id!r} cannot be used as a file name")
        write_json(out / "units" / f"{unit_id}.json", build_unit_file(ctx, unit_id))
    for election_id in ctx.elections:
        write_json(out / "elections" / f"{election_id}.json", build_election_file(ctx, election_id))
    return {"units": len(ctx.clickable_unit_ids), "elections": len(ctx.elections)}
