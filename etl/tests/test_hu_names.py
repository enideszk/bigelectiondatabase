"""Name matching across sources (no database needed)."""

from __future__ import annotations

import pytest

from etl.hu_names import bp_district_number, county_key, name_key, roman_to_int


@pytest.mark.parametrize(
    "name, number",
    [
        ("BUDAPEST I.ker", 1),          # 1990 NVI
        ("Budapest I.ker.", 1),         # 2010 NVI
        ("Budapest I. kerület", 1),     # 2018 NVI
        ("Budapest 01. ker.", 1),       # KSH Helységnévtár
        ("XXIII. kerület", 23),         # OpenStreetMap
        ("Budapest XIV. kerület", 14),
        ("budapest 23. ker.", 23),
        ("Budapest", None),
        ("Pécs", None),
        ("Budapest XXIV. kerület", None),  # there is no district 24
    ],
)
def test_bp_district_number(name, number):
    assert bp_district_number(name) == number


def test_roman_numerals():
    assert [roman_to_int(r) for r in ["I", "IV", "IX", "XIV", "XIX", "XXIII"]] == [1, 4, 9, 14, 19, 23]


def test_name_key_ignores_case_spacing_and_dash_kinds():
    assert name_key("Hódmezővásárhely") == name_key("HÓDMEZŐVÁSÁRHELY")
    assert name_key("Bács - Kiskun") == name_key("Bács–Kiskun") == "bács-kiskun"
    assert name_key("Pécs") != name_key("Pecs")  # accents are significant


@pytest.mark.parametrize("name", ["Csongrád", "CSONGRÁD", "Csongrád-Csanád megye", "Csongrád-Csanád vármegye"])
def test_county_key_handles_suffixes_and_the_2020_rename(name):
    assert county_key(name) == "csongrád"


def test_county_key_strips_megye():
    assert county_key("Pest megye") == county_key("PEST") == "pest"
