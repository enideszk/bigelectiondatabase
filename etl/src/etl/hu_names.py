"""Matching Hungarian place names across sources.

The same unit is spelled differently from file to file: "BUDAPEST I.ker" (1990), "Budapest I. kerület"
(2018), "Budapest 01. ker." (KSH Helységnévtár), "XXI. kerület" (OpenStreetMap). These helpers turn
names into comparable keys; loaders match on the keys and report what does not match.
"""

from __future__ import annotations

import re
import unicodedata

_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50}
_BP_DISTRICT = re.compile(
    r"^(?:budapest\s*)?(?P<num>[0-9]{1,2}|[ivxl]+)\s*\.?\s*(?:ker(?:ület)?\.?)?$",
    re.IGNORECASE,
)


def roman_to_int(text: str) -> int:
    total, previous = 0, 0
    for char in reversed(text.upper()):
        value = _ROMAN[char]
        total = total - value if value < previous else total + value
        previous = max(previous, value)
    return total


def bp_district_number(name: str) -> int | None:
    """23 for "Budapest XXIII. kerület", "BUDAPEST XXIII.ker", "Budapest 23. ker.", "XXIII. kerület";
    None for anything that is not a Budapest district."""
    text = " ".join(name.replace(" ", " ").split())
    if "ker" not in text.lower():
        return None
    match = _BP_DISTRICT.match(text)
    if not match:
        return None
    num = match.group("num")
    value = int(num) if num.isdigit() else roman_to_int(num)
    return value if 1 <= value <= 23 else None


def name_key(name: str) -> str:
    """Comparable key for a settlement name: lowercase, single spaces, one kind of dash, no dots
    around spaces. Accents are kept (they distinguish real names, e.g. Sárszentmihály vs ...)."""
    text = unicodedata.normalize("NFC", name).replace(" ", " ")
    text = re.sub(r"[‐-‒–—]", "-", text)
    text = re.sub(r"\s*-\s*", "-", text)
    return " ".join(text.lower().split())


def county_key(name: str) -> str:
    """'Pest megye', 'PEST', 'Pest vármegye' -> 'pest'; 'BUDAPEST főváros' -> 'budapest';
    'CSONGRÁD' and 'Csongrád-Csanád' both -> 'csongrád' (renamed in 2020; older files use the old name)."""
    text = name_key(name)
    text = re.sub(r"\s+((vár)?megye|főváros)$", "", text)
    if text.startswith("csongrád"):
        return "csongrád"
    return text


_SMALL_WORDS = {"a", "az", "és", "s", "vagy", "de", "is"}


def hu_title(text: str) -> str:
    """Title case for names published in capitals: 'MAGYAR KÉTFARKÚ KUTYA PÁRT' -> 'Magyar Kétfarkú
    Kutya Párt', 'DR. HÖRCSIK RICHÁRD' -> 'Dr. Hörcsik Richárd'. Text that is not all capitals is
    returned unchanged (it is already written the way its owner writes it)."""
    text = " ".join(text.split())
    if text != text.upper():
        return text
    words = []
    for i, word in enumerate(text.lower().split(" ")):
        if i > 0 and word in _SMALL_WORDS:
            words.append(word)
        else:
            words.append("-".join(part[:1].upper() + part[1:] for part in word.split("-")))
    return " ".join(words)


def acronym(text: str, max_len: int = 12) -> str:
    """Short label for a long organisation name: 'SPORTOS ÉS EGÉSZSÉGES MAGYARORSZÁGÉRT PÁRT' -> 'SEMP'.
    Short names are returned as they are."""
    text = " ".join(text.split())
    if len(text) <= max_len:
        return text
    letters = [w[0] for w in re.split(r"[\s\-]+", text) if w and w[0].isalpha() and w.lower() not in _SMALL_WORDS]
    return "".join(letters).upper()
