"""`etl export` output matches the TypeScript contract (web/src/lib/types.ts -> types.schema.json)."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from etl import config, db
from etl.export import export_all
from etl.export.geo import LEVELS
from etl.export.stations import station_id


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
    geo_validator, lines_validator = _validator("GeoFile"), _validator("GeoLinesFile")
    for path in (exported / "geo").glob("*.json"):
        validator = lines_validator if path.name.endswith(".lines.json") else geo_validator
        assert _errors(validator, _load(path)) == [], path.name
        checked += 1
    share_validator = _validator("ShareFile")
    for path in (exported / "shares").rglob("*.json"):
        assert _errors(share_validator, _load(path)) == [], path.name
        checked += 1
    station_validator = _validator("StationFile")
    for path in (exported / "stations").glob("*.json"):
        assert _errors(station_validator, _load(path)) == [], path.name
        checked += 1
    indicator_validator = _validator("IndicatorFile")
    indicator_files = list((exported / "indicators").glob("*.json"))
    assert indicator_files
    for path in indicator_files:
        assert _errors(indicator_validator, _load(path)) == [], path.name
        checked += 1
    assert checked > 20


def test_boundary_files_cover_every_level_on_every_election_day(exported):
    """Per map level and election day: one geometry for each unit that existed then, nothing else."""
    meta = _load(exported / "meta.json")
    units = _load(exported / "units" / "index.json")["units"]

    def valid_on(item, day):
        return (item["valid_from"] is None or item["valid_from"] <= day) and (item["valid_to"] is None or day < item["valid_to"])

    for election in meta["elections"]:
        day = election["date"]
        for level, types in LEVELS.items():
            files = [g for g in meta["geo"] if g["level"] == level and valid_on(g, day)]
            features = [f for g in files for f in _load(exported / g["file"])["features"] if valid_on(f["properties"], day)]
            ids = [f["properties"]["id"] for f in features]
            assert len(ids) == len(set(ids)), f"{level}: a unit has two geometries on {day}"
            existing = {u["id"] for u in units if u["type"] in types and valid_on(u, day)}
            assert set(ids) == existing, f"{level} boundaries on {day}"


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


def test_hover_summaries_lead_with_the_winner(exported):
    election = _load(exported / "elections" / "parliament-2018.json")
    for view in ("L", "E"):
        result = election["views"][view]
        assert set(result["summaries"]) == set(result["winners"])
        for unit_id, summary in result["summaries"].items():
            shares = [share for _, share in summary["top"]]
            assert summary["top"][0][0] == result["winners"][unit_id], unit_id
            assert shares == sorted(shares, reverse=True) and sum(shares) <= 1.0001, unit_id
            assert summary["turnout"] is None or 0 < summary["turnout"] <= 1, unit_id


def test_share_files_match_the_summaries(exported):
    """Every option has a share file, and a unit's leading shares there are the hover card's."""
    election = _load(exported / "elections" / "parliament-2018.json")
    for view in ("L", "E"):
        result = election["views"][view]
        shares = {o["id"]: _load(exported / "shares" / "parliament-2018" / view / f"{o['id']}.json") for o in result["options"]}
        for unit_id, summary in result["summaries"].items():
            for option_id, share in summary["top"]:
                assert shares[option_id][unit_id] == share, (view, unit_id, option_id)


def test_option_ids_are_stable_across_views(exported):
    """A party combination has the same id as a list (L) and as joint candidates (E)."""
    election = _load(exported / "elections" / "parliament-2018.json")
    lists = {o["id"] for o in election["views"]["L"]["options"]}
    candidates = {o["id"] for o in election["views"]["E"]["options"]}
    assert lists & candidates
    unit = _load(exported / "units" / "country-XX.json")["elections"]["parliament-2018"]
    assert {l["option"] for l in unit["lists"]} <= lists


def test_every_settlement_has_a_winner(exported):
    winners = _load(exported / "elections" / "parliament-2018.json")["views"]["L"]["winners"]
    index = _load(exported / "units" / "index.json")["units"]
    settlements_2018 = [u["id"] for u in index if u["type"] == "settlement" and u["valid_to"] is None]
    assert settlements_2018 and all(s in winners for s in settlements_2018)


def test_station_ids_follow_nvi():
    """MAZ-OEVK-TAZ-SZK: the district number goes between NVI's county and settlement codes."""
    assert station_id("01-001-002", "smd-2011-01-03") == "01-03-001-002"
    assert station_id("13-120-011", "smd-2024-13-14") == "13-14-120-011"


def test_stations_add_up_to_the_settlements(exported):
    """Every station's votes, summed per settlement, are that settlement's results."""
    for path in (exported / "stations").glob("*.json"):
        stations = _load(path)
        election_id = path.stem
        options = stations["options"].get("L", [])
        sums: dict[str, list[int]] = {}
        for row in stations["stations"]:
            totals = sums.setdefault(row["unit"], [0] * len(options))
            for i, votes in enumerate(row["L"]):
                totals[i] += votes
        for unit_id, totals in sums.items():
            lists = _load(exported / "units" / f"{unit_id}.json")["elections"][election_id]["lists"]
            by_option = {l["option"]: l["votes"] for l in lists if l["round"] == 1}
            assert {o: v for o, v in zip(options, totals) if v} == {o: v for o, v in by_option.items() if v}, unit_id
