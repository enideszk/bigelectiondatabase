"""data/meta.json"""

from __future__ import annotations

from datetime import datetime, timezone

from .context import ExportContext, iso


def build_meta(ctx: ExportContext) -> dict:
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "is_fixture": ctx.is_fixture,
        # Licenses that require attribution carry it after a "©" (e.g. "ODbL 1.0 — © OpenStreetMap contributors").
        "attribution": sorted({lic[lic.index("©"):].strip() for lic in ctx.licenses if "©" in lic}),
        "elections": [
            {
                "id": e["election_id"],
                "type": e["election_type"],
                "type_name": e["type_name"],
                "year": e["election_date"].year,
                "date": iso(e["election_date"]),
                "name": e["name_en"],
                "name_hu": e["name_hu"],
                "rounds": [{"round": r["round_no"], "date": iso(r["round_date"])} for r in e["rounds"]],
                "district_set": e["district_set_id"],
            }
            for e in ctx.elections.values()
        ],
        "indicators": [
            {
                "id": i["indicator_id"],
                "name": i["name_en"],
                "name_hu": i["name_hu"],
                "unit_of_measure": i["unit_of_measure"],
                "decimals": i["decimals"],
                "description": i["description"],
                "source": i["source_name"],
            }
            for i in ctx.indicators
        ],
        "unit_types": [
            {"type": t["unit_type"], "name": t["name_en"], "name_hu": t["name_hu"]}
            for t in ctx.unit_types
            if t["is_clickable"]
        ],
    }
