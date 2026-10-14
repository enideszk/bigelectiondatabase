"""Loaders: one module per data source.

Every loader module (see _template.py) defines:
    SOURCE                      a SourceInfo describing the source
    clean(raw_dir, interim_dir) raw download -> cleaned files in data/interim/  (returns paths)
    load(conn, interim_dir)     cleaned files -> database, in one transaction  (returns counts)

Register a new loader here so `etl load <name>` finds it. LOADERS is in load order: a loader may
depend on the ones above it. The fixture loader is not registered: it has its own command,
`etl seed fixtures`.
"""

from __future__ import annotations

from types import ModuleType

from . import (
    district_membership,
    ksh_helysegnevtar,
    nvi_parliament_2014,
    nvi_parliament_2018,
    nvi_parliament_2022,
    nvi_parliament_2026,
    oevk_maps,
    osm_boundaries_2026,
    reference_elections,
    reference_parties,
    reference_regions,
)

LOADERS: dict[str, ModuleType] = {
    "reference_regions": reference_regions,
    "ksh_helysegnevtar": ksh_helysegnevtar,
    "osm_boundaries_2026": osm_boundaries_2026,
    "oevk_maps": oevk_maps,
    "reference_elections": reference_elections,
    "reference_parties": reference_parties,
    "nvi_parliament_2014": nvi_parliament_2014,
    "nvi_parliament_2018": nvi_parliament_2018,
    "nvi_parliament_2022": nvi_parliament_2022,
    "nvi_parliament_2026": nvi_parliament_2026,
    "district_membership": district_membership,
}
