"""Loaders: one module per data source.

Every loader module (see _template.py) defines:
    SOURCE                      a SourceInfo describing the source
    clean(raw_dir, interim_dir) raw download -> cleaned files in data/interim/  (returns paths)
    load(conn, interim_dir)     cleaned files -> database, in one transaction  (returns counts)

Register a new loader here so `etl load <name>` finds it. The fixture loader is not registered:
it has its own command, `etl seed fixtures`.
"""

from __future__ import annotations

from types import ModuleType

LOADERS: dict[str, ModuleType] = {
    # "ksh_helysegnevtar": ksh_helysegnevtar,
}
