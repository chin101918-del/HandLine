"""
Thai OpenType Feature Generator (GDEF + GSUB ccmp/calt/salt + GPOS mark/mkmk)
Supports:
- Primary AND multi-instance alternate glyphs (uniXXXX.alt1, uniXXXX.alt2, ...)
- GDEF GlyphClassDef covering both primary and alternate base/mark glyphs
- GSUB `ccmp` (SARA AM decomposition for น้ำ)
- GSUB `salt` (stylistic alternates) & `calt` (contextual alternates cycling repeated characters)
- GPOS `mark` & `mkmk` with geometry-derived & slant-sheared anchors on every base & alternate glyph
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .charset import (
    THAI_ABOVE_VOWELS,
    THAI_BELOW_MARKS,
    THAI_COMBINING_MARKS,
    THAI_CONSONANTS,
    THAI_TONE_MARKS,
)

THAI_CONSONANT_SET = set(THAI_CONSONANTS)


@dataclass(frozen=True)
class GlyphOpenTypeInfo:
    glyph_name: str
    codepoint: int
    x_min: int
    y_min: int
    x_max: int
    y_max: int
    advance_width: int
    anchors: Dict[str, Tuple[int, int]]
    is_alternate: bool = False


def is_thai_combining_mark(codepoint: int) -> bool:
    return codepoint in THAI_COMBINING_MARKS


def unicode_to_glyph_name(codepoint: int, alt_index: int = 0) -> str:
    if codepoint == 0x0020 and alt_index == 0:
        return "space"
    base = f"uni{codepoint:04X}"
    return base if alt_index == 0 else f"{base}.alt{alt_index}"


def generate_thai_fea(
    glyph_infos: Dict[int, GlyphOpenTypeInfo],
    alternate_infos: Optional[Dict[int, List[GlyphOpenTypeInfo]]] = None,
) -> str:
    alt_map = alternate_infos or {}

    all_infos: List[GlyphOpenTypeInfo] = []
    for cp in sorted(glyph_infos.keys()):
        all_infos.append(glyph_infos[cp])
        all_infos.extend(alt_map.get(cp, []))

    present_bases = [info for info in all_infos if info.codepoint in THAI_CONSONANT_SET]
    present_above = [info for info in all_infos if info.codepoint in THAI_ABOVE_VOWELS]
    present_tones = [info for info in all_infos if info.codepoint in THAI_TONE_MARKS]
    present_below = [info for info in all_infos if info.codepoint in THAI_BELOW_MARKS]

    all_non_marks = [info.glyph_name for info in all_infos if info.codepoint not in THAI_COMBINING_MARKS]
    all_marks = [info.glyph_name for info in all_infos if info.codepoint in THAI_COMBINING_MARKS]

    lines: List[str] = [
        "languagesystem DFLT dflt;",
        "languagesystem thai dflt;",
        "languagesystem latn dflt;",
        "",
    ]

    # 1. GDEF table (covers primary + alternate base/mark glyphs)
    if all_non_marks or all_marks:
        base_cls = f"[{' '.join(all_non_marks)}]" if all_non_marks else ""
        mark_cls = f"[{' '.join(all_marks)}]" if all_marks else ""
        lines.extend(
            [
                "table GDEF {",
                f"    GlyphClassDef {base_cls}, , {mark_cls}, ;",
                "} GDEF;",
                "",
            ]
        )

    # 2. GSUB `ccmp`: Canonical SARA AM decomposition
    if 0x0E33 in glyph_infos and 0x0E4D in glyph_infos and 0x0E32 in glyph_infos:
        lines.extend(
            [
                "feature ccmp {",
                "    script thai;",
                f"    sub {glyph_infos[0x0E33].glyph_name} by {glyph_infos[0x0E4D].glyph_name} {glyph_infos[0x0E32].glyph_name};",
                "    script DFLT;",
                f"    sub {glyph_infos[0x0E33].glyph_name} by {glyph_infos[0x0E4D].glyph_name} {glyph_infos[0x0E32].glyph_name};",
                "} ccmp;",
                "",
            ]
        )

    # 3. GSUB `salt` & `calt` for multi-instance handwriting alternates
    alt_pairs = [(cp, glyph_infos[cp], alt_map[cp]) for cp in sorted(alt_map.keys()) if cp in glyph_infos and alt_map[cp]]
    if alt_pairs:
        lines.append("feature salt {")
        for _, primary, alts in alt_pairs:
            alt_names = " ".join(a.glyph_name for a in alts)
            lines.append(f"    sub {primary.glyph_name} from [{alt_names}];")
        lines.append("} salt;")
        lines.append("")

        # Contextual alternates: cycle consecutive repeated characters (e.g. นน -> น + น.alt1)
        lines.append("feature calt {")
        for _, primary, alts in alt_pairs:
            first_alt = alts[0].glyph_name
            lines.append(f"    sub {primary.glyph_name} {primary.glyph_name}' by {first_alt};")
            if len(alts) >= 2:
                lines.append(f"    sub {first_alt} {primary.glyph_name}' by {alts[1].glyph_name};")
        lines.append("} calt;")
        lines.append("")

    # 4. Mark classes
    mark_top_defs: List[str] = []
    mark_tone_defs: List[str] = []
    mark_bottom_defs: List[str] = []

    for info in present_above:
        ax, ay = info.anchors.get("_top", (round((info.x_min + info.x_max) / 2), info.y_min - 24))
        mark_top_defs.append(f"markClass {info.glyph_name} <anchor {ax} {ay}> @MC_top;")

    for info in present_tones:
        ax, ay = info.anchors.get("_tone", (round((info.x_min + info.x_max) / 2), info.y_min - 22))
        mark_tone_defs.append(f"markClass {info.glyph_name} <anchor {ax} {ay}> @MC_tone;")

    for info in present_below:
        ax, ay = info.anchors.get("_bottom", (round((info.x_min + info.x_max) / 2), info.y_max + 26))
        mark_bottom_defs.append(f"markClass {info.glyph_name} <anchor {ax} {ay}> @MC_bottom;")

    for block in (mark_top_defs, mark_tone_defs, mark_bottom_defs):
        if block:
            lines.extend(block)
            lines.append("")

    # 5. GPOS `mark`: Mark-to-Base positioning on primary AND alternate Thai consonants
    if present_bases and (mark_top_defs or mark_tone_defs or mark_bottom_defs):
        lines.append("feature mark {")
        lines.append("    lookup thai_mark_to_base {")
        for base in present_bases:
            clauses: List[str] = []
            if mark_top_defs and "top" in base.anchors:
                tx, ty = base.anchors["top"]
                clauses.append(f"<anchor {tx} {ty}> mark @MC_top")
            if mark_tone_defs and "tone" in base.anchors:
                tnx, tny = base.anchors["tone"]
                clauses.append(f"<anchor {tnx} {tny}> mark @MC_tone")
            if mark_bottom_defs and "bottom" in base.anchors:
                bx, by = base.anchors["bottom"]
                clauses.append(f"<anchor {bx} {by}> mark @MC_bottom")
            if clauses:
                lines.append(f"        pos base {base.glyph_name} {' '.join(clauses)};")
        lines.append("    } thai_mark_to_base;")
        lines.append("} mark;")
        lines.append("")

    # 6. GPOS `mkmk`: Mark-to-Mark stacking
    if present_above and mark_tone_defs:
        lines.append("feature mkmk {")
        lines.append("    lookup thai_tone_above_vowel {")
        for vowel in present_above:
            vx, vy = vowel.anchors.get(
                "top_tone",
                (round((vowel.x_min + vowel.x_max) / 2), vowel.y_max + 36),
            )
            lines.append(
                f"        pos mark {vowel.glyph_name} <anchor {vx} {vy}> mark @MC_tone;"
            )
        lines.append("    } thai_tone_above_vowel;")
        lines.append("} mkmk;")
        lines.append("")

    return "\n".join(lines)
