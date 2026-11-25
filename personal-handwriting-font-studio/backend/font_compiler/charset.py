"""
Canonical Thai & English Unicode Character Set Specification
Used for coverage reporting, missing-glyph detection, and OpenType glyph classification.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Set

THAI_CONSONANTS: List[int] = list(range(0x0E01, 0x0E2F))  # ก–ฮ (44)

THAI_SPACING_VOWELS: List[int] = [
    0x0E30,  # ะ SARA A
    0x0E32,  # า SARA AA
    0x0E33,  # ำ SARA AM
    0x0E40,  # เ SARA E
    0x0E41,  # แ SARA AE
    0x0E42,  # โ SARA O
    0x0E43,  # ใ SARA AI MAIMUAN
    0x0E44,  # ไ SARA AI MAIMALAI
    0x0E45,  # ๅ LAKKHANGYAO
    0x0E24,  # ฤ RU
    0x0E26,  # ฦ LU
]

THAI_ABOVE_VOWELS: Set[int] = {
    0x0E31,  # ั MAI HAN-AKAT
    0x0E34,  # ิ SARA I
    0x0E35,  # ี SARA II
    0x0E36,  # ึ SARA UE
    0x0E37,  # ื SARA UEE
    0x0E47,  # ็ MAITAIKHU
    0x0E4D,  # ํ NIKHAHIT
}

THAI_TONE_MARKS: Set[int] = {
    0x0E48,  # ่ MAI EK
    0x0E49,  # ้ MAI THO
    0x0E4A,  # ๊ MAI TRI
    0x0E4B,  # ๋ MAI CHATTAWA
    0x0E4C,  # ์ THANTHAKHAT
    0x0E4E,  # ๎ YAMAKKAN
}

THAI_BELOW_MARKS: Set[int] = {
    0x0E38,  # ุ SARA U
    0x0E39,  # ู SARA UU
    0x0E3A,  # ฺ PHINTHU
}

THAI_COMBINING_MARKS: Set[int] = THAI_ABOVE_VOWELS | THAI_TONE_MARKS | THAI_BELOW_MARKS

THAI_DIGITS: List[int] = list(range(0x0E50, 0x0E5A))  # ๐–๙
THAI_PUNCT_CURRENCY: List[int] = [
    0x0E2F,  # ฯ PAIYANNOI
    0x0E46,  # ๆ MAIYAMOK
    0x0E3F,  # ฿ BAHT
    0x0E4F,  # ๏ FONGMAN
    0x0E5A,  # ๚ ANGKHANKHU
    0x0E5B,  # ๛ KHOMUT
]

LATIN_UPPER: List[int] = list(range(0x0041, 0x005B))  # A–Z
LATIN_LOWER: List[int] = list(range(0x0061, 0x007B))  # a–z
ASCII_DIGITS: List[int] = list(range(0x0030, 0x003A))  # 0–9
COMMON_PUNCT: List[int] = [
    ord(c) for c in ".,!?;:-()[]{}\"'/@#$%&*+=_~"
] + [0x2013, 0x2014]  # en-dash, em-dash

REQUIRED_CATEGORIES: Dict[str, List[int]] = {
    "thai_consonants": THAI_CONSONANTS,
    "thai_vowels": sorted(set(THAI_SPACING_VOWELS) | THAI_ABOVE_VOWELS | THAI_BELOW_MARKS),
    "thai_tones_diacritics": sorted(THAI_TONE_MARKS),
    "thai_digits": THAI_DIGITS,
    "thai_punctuation_currency": THAI_PUNCT_CURRENCY,
    "latin_upper": LATIN_UPPER,
    "latin_lower": LATIN_LOWER,
    "ascii_digits": ASCII_DIGITS,
    "common_punctuation": COMMON_PUNCT,
}


@dataclass(frozen=True)
class CoverageSummary:
    total_required: int
    total_present: int
    coverage_percent: float
    by_category: Dict[str, Dict[str, object]]
    missing_codepoints: List[int]
    missing_characters: List[str]


def compute_coverage_report(present_codepoints: Set[int]) -> CoverageSummary:
    all_required: Set[int] = set()
    by_cat: Dict[str, Dict[str, object]] = {}
    for cat, cps in REQUIRED_CATEGORIES.items():
        all_required.update(cps)
        present = [cp for cp in cps if cp in present_codepoints]
        missing = [cp for cp in cps if cp not in present_codepoints]
        by_cat[cat] = {
            "required": len(cps),
            "present": len(present),
            "missing_count": len(missing),
            "missing_chars": [chr(cp) for cp in missing],
        }
    total_req = len(all_required)
    total_pres = len(all_required & present_codepoints)
    missing_all = sorted(all_required - present_codepoints)
    pct = round((total_pres / total_req) * 100.0, 1) if total_req else 0.0
    return CoverageSummary(
        total_required=total_req,
        total_present=total_pres,
        coverage_percent=pct,
        by_category=by_cat,
        missing_codepoints=missing_all,
        missing_characters=[chr(cp) for cp in missing_all],
    )
