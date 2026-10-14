"""`etl export` output matches the TypeScript contract (web/src/lib/types.ts -> types.schema.json)."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from etl import config, db
from etl.export import export_all


def _validator(type_name: str) -> jsonschema.Draft7Validator:
    schema = json.loads(config.TYPES_SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft7Validator({"$ref": f"#/definitions/{type_name}", "definitions": schema["definitions"]})


@pytest.fixture(scope="module")
def exported(test_db_url, seeded, tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("export")
    with db.connect(test_db_url) as conn:
        db.refresh_aggregates(conn)
        export_all(conn, out)
    return out


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _errors(validator: jsonschema.Draft7Validator, data) -> list[str]:
    return [f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in validator.iter_errors(data)]


def test_every_file_matches_the_typescript_types(exported):
    checked = 0
    for path, type_name in [(exported / "meta.json", "Meta"), (exported / "units" / "index.json", "UnitIndex")]:
        assert _errors(_validator(type_name), _load(path)) == [], path.name
        checked += 1
    unit_validator = _validator("UnitFile")
    for path in (exported / "units").glob("*.json"):
        if path.name != "index.json":
            assert _errors(unit_validator, _load(path)) == [], path.name
            checked += 1
    election_validator = _validator("ElectionFile")
    for path in (exported / "elections").glob("*.json"):
        assert _errors(election_validator, _load(path)) == [], path.name
        checked += 1
    assert checked > 20


def test_meta_flags_fixture_and_lists_elections_oldest_first(exported):
    meta = _load(exported / "meta.json")
    assert meta["is_fixture"] is True
    assert [e["id"] for e in meta["elections"]] == ["parliament-2010", "parliament-2018"]
    assert [r["round"] for r in meta["elections"][0]["rounds"]] == [1, 2]


def test_split_city_shows_both_districts(exported):
    city = _load(exported / "units" / "settlement-99001.json")["elections"]["parliament-2018"]
    assert [d["name"] for d in city["districts"]] == ["Alfa 01", "Alfa 02"]
    assert sorted({r["district"]["name"] for r in city["races"]}) == ["Alfa 01", "Alfa 02"]


def test_party_names_follow_renames(exported):
    country = _load(exported / "units" / "country-XX.json")["elections"]
    assert ["ZM"] in [l["parties"] for l in country["parliament-2010"]["lists"]]
    assert ["ZSZ"] in [l["parties"] for l in country["parliament-2018"]["lists"]]


def test_merged_settlement_only_has_elections_before_the_merge(exported):
    kiskamu = _load(exported / "units" / "settlement-99005.json")
    assert list(kiskamu["elections"]) == ["parliament-2010"]
    assert kiskamu["lineage"][0]["direction"] == "to"


def test_every_settlement_has_a_winner(exported):
    winners = _load(exported / "elections" / "parliament-2018.json")["winners"]
    index = _load(exported / "units" / "index.json")["units"]
    settlements_2018 = [u["id"] for u in index if u["type"] == "settlement" and u["valid_to"] is None]
    assert settlements_2018 and all(s in winners for s in settlements_2018)
