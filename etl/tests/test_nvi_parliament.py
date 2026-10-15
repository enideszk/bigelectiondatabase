"""Parliamentary election cleaning rules (no database needed): the repeated rows of the 1990–1998
station files and the party alias lookup."""

from __future__ import annotations

from etl.loaders._nvi_parliament import load_aliases, resolve
from etl.loaders._nvi_parliament_txt import without_repeated_rows


def kept(items, valid, ballot=None):
    out = without_repeated_rows(items, valid, ballot)
    return None if out is None else sorted(out)


def test_rows_without_repeats_stay():
    items = [("A", 1, 10), ("B", 2, 5)]
    assert without_repeated_rows(items, 15) is items
    # a difference in the sum alone is the source's; nothing to drop
    assert without_repeated_rows(items, 14) is items


def test_repeated_rows_dropped_to_the_valid_votes():
    # 1994, Apc: "001 KUNYÓ VILMOS 1" beside the real 001, and two rows for 008 Nagy Gyula
    items = [("Kunyó", 1, 1), ("Bényei", 1, 2), ("Érsek", 4, 243), ("Kunyó", 7, 20), ("Nagy", 8, 13), ("Nagy", 8, 26)]
    assert kept(items, 2 + 243 + 20 + 26) == sorted([("Bényei", 1, 2), ("Érsek", 4, 243), ("Kunyó", 7, 20), ("Nagy", 8, 26)])


def test_repeated_rows_without_numbers():
    # 1990 has no ballot numbers: the copy that does not add up goes
    items = [("Bereczky", None, 129), ("Bereczky", None, 42), ("Balogh", None, 290)]
    assert kept(items, 332) == sorted([("Bereczky", None, 42), ("Balogh", None, 290)])


def test_identical_copies():
    items = [("Andok", 1, 3), ("Andok", 1, 3), ("Gráf", 2, 70)]
    assert kept(items, 73) == sorted([("Andok", 1, 3), ("Gráf", 2, 70)])


def test_rows_off_the_ballot():
    # 1994 Borsod: KDNP repeated under 7 and Zöld Alternatíva under 17, neither on the county's list
    ballot = {(7, "KP"), (9, "KDNP"), (2, "MSZP")}
    items = [("MSZP", 2, 136), ("KP", 7, 5), ("KDNP", 7, 10), ("KDNP", 9, 46), ("ZA", 17, 29)]
    assert kept(items, 136 + 5 + 46, ballot) == sorted([("MSZP", 2, 136), ("KP", 7, 5), ("KDNP", 9, 46)])


def test_the_ballot_decides_between_equal_choices():
    # two rows of 1 vote under number 10: the one on the county's ballot stays
    ballot = {(10, "EKGP"), (1, "MSZP")}
    items = [("MSZP", 1, 52), ("EKGP", 10, 1), ("Piacpárt", 10, 1)]
    assert kept(items, 53, ballot) == sorted([("MSZP", 1, 52), ("EKGP", 10, 1)])
    assert without_repeated_rows(items, 53) is None


def test_unresolvable_repeat_stops():
    assert without_repeated_rows([("A", 1, 5), ("A", 1, 6)], 100) is None
    assert without_repeated_rows([("A", 1, 5), ("A", 1, 6)], None) is None


def test_aliases_by_year():
    aliases = load_aliases()
    assert resolve(aliases, "MAGYAR SZOCIALISTA MUNKÁSPÁRT", 1990)["party_ids"] == "munkaspart"
    assert resolve(aliases, "MAGYAR SZOCIALISTA MUNKÁSPÁRT", 1994)["party_ids"] == "mszmp_1993"
    assert resolve(aliases, "FÜGGETLEN KISGAZDAPÁRT", 1998)["party_ids"] == "fkgp"
    assert resolve(aliases, "FÜGGETLEN KISGAZDAPÁRT", 2018)["party_ids"] == "fuggetlen_kisgazdapart"
    assert resolve(aliases, "Fidesz", 1994)["name"] == "Fiatal Demokraták Szövetsége"


def test_joint_nominations_resolve_part_by_part():
    aliases = load_aliases()
    joint = resolve(aliases, "MDF,FIDESZ,KDNP", 2006)
    assert joint["party_ids"] == "mdf|fidesz|kdnp"
    assert joint["short_name"] == "MDF–Fidesz–KDNP"
    # a comma inside a name that is an alias as a whole stays one organisation
    assert resolve(aliases, "A SZOLIDARITÁS PÁRTJA, MAGYAR MUNKÁSPÁRT", 2026)["party_ids"] == "szolidaritas_partja|munkaspart"
    assert resolve(aliases, "MDF,NO SUCH PARTY", 2006) is None
