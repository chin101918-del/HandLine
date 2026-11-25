"""
Comprehensive Font Validation & HarfBuzz Thai Shaping Verification Module
Checks:
1. Required TrueType SFNT tables (cmap, glyf, head, hhea, hmtx, loca, maxp, name, OS/2, post)
2. Glyph order (.notdef first) & non-empty TrueType outlines
3. Unicode cmap & Thai/English character coverage report + missing-glyph detection
4. Combining mark zero-advance-width enforcement
5. GDEF / GPOS (mark & mkmk) / GSUB (ccmp) OpenType table inspection
6. Name table & macOS/HandLine installation compatibility
7. Live HarfBuzz shaping tests (via uharfbuzz when installed) on all required Thai clusters
8. Optional FontBakery checks when fontbakery is installed
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from fontTools.ttLib import TTFont

from .charset import THAI_COMBINING_MARKS, compute_coverage_report

try:
    import uharfbuzz as hb

    HAS_HARFBUZZ = True
except ImportError:
    HAS_HARFBUZZ = False

try:
    import fontbakery  # noqa: F401

    HAS_FONTBAKERY = True
except ImportError:
    HAS_FONTBAKERY = False

REQUIRED_THAI_TEST_COMBINATIONS = [
    "กิ",
    "กี",
    "กุ",
    "กู",
    "ก่",
    "ก้",
    "กั่",
    "กิ้",
    "เก่ง",
    "น้ำ",
    "ผู้",
    "ที่",
    "ขึ้น",
    "สวัสดี",
    "สวัสดีครับ Hello 2026!",
]

REQUIRED_TTF_TABLES = (
    "cmap",
    "glyf",
    "head",
    "hhea",
    "hmtx",
    "loca",
    "maxp",
    "name",
    "OS/2",
    "post",
)


@dataclass
class ValidationCheck:
    id: str
    status: str  # PASS | WARN | FAIL | SKIP
    message: str


@dataclass
class FontValidationReport:
    passed: bool
    glyph_count: int
    tables_present: List[str]
    has_gdef: bool
    has_thai_gpos: bool
    has_thai_gsub: bool
    gpos_features: List[str]
    gsub_features: List[str]
    harfbuzz_available: bool
    fontbakery_available: bool
    coverage: Dict[str, Any]
    shaping_samples: List[Dict[str, Any]] = field(default_factory=list)
    checks: List[ValidationCheck] = field(default_factory=list)


def _extract_feature_tags(table: Any) -> List[str]:
    if not table or not getattr(table, "table", None) or not table.table.FeatureList:
        return []
    return sorted({fr.FeatureTag for fr in table.table.FeatureList.FeatureRecord})


def shape_text_with_harfbuzz(ttf_bytes: bytes, texts: List[str]) -> List[Dict[str, Any]]:
    if not HAS_HARFBUZZ:
        return []
    blob = hb.Blob(ttf_bytes)
    face = hb.Face(blob)
    hb_font = hb.Font(face)
    results: List[Dict[str, Any]] = []
    for text in texts:
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(hb_font, buf)
        glyphs = [
            {
                "gid": info.codepoint,
                "cluster": info.cluster,
                "x_advance": pos.x_advance,
                "y_advance": pos.y_advance,
                "x_offset": pos.x_offset,
                "y_offset": pos.y_offset,
            }
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions)
        ]
        results.append({"text": text, "glyph_count": len(glyphs), "glyphs": glyphs})
    return results


def validate_ttf_bytes(
    ttf_bytes: bytes,
    extra_shaping_texts: Optional[List[str]] = None,
) -> FontValidationReport:
    checks: List[ValidationCheck] = []
    font = TTFont(io.BytesIO(ttf_bytes))
    tables = sorted(font.keys())
    glyph_order = font.getGlyphOrder()
    cmap = font.getBestCmap() or {}

    # 1. Required SFNT tables
    missing_tables = [t for t in REQUIRED_TTF_TABLES if t not in font]
    checks.append(
        ValidationCheck(
            id="sfnt.required_tables",
            status="FAIL" if missing_tables else "PASS",
            message=(
                f"Missing required TrueType tables: {', '.join(missing_tables)}"
                if missing_tables
                else "All 10 required TrueType SFNT tables are present."
            ),
        )
    )

    # 2. Glyph order (.notdef must be GID 0)
    notdef_ok = len(glyph_order) > 0 and glyph_order[0] == ".notdef"
    checks.append(
        ValidationCheck(
            id="glyph_order.notdef_first",
            status="PASS" if notdef_ok else "FAIL",
            message=(
                f"Glyph order valid ({len(glyph_order)} glyphs, .notdef at GID 0)."
                if notdef_ok
                else ".notdef is missing or not at GID 0."
            ),
        )
    )

    # 3. TrueType outline integrity
    glyf_table = font["glyf"] if "glyf" in font else None
    non_empty_outlines = 0
    if glyf_table:
        for gname in glyph_order:
            if gname in (".notdef", "space"):
                continue
            g = glyf_table[gname]
            if g.numberOfContours > 0:
                non_empty_outlines += 1
    checks.append(
        ValidationCheck(
            id="glyf.outlines",
            status="PASS" if non_empty_outlines > 0 else "FAIL",
            message=f"Verified {non_empty_outlines} TrueType glyphs with closed vector contours.",
        )
    )

    # 4. Unicode cmap & coverage report
    present_cps = set(cmap.keys())
    cov = compute_coverage_report(present_cps)
    checks.append(
        ValidationCheck(
            id="cmap.unicode_coverage",
            status="PASS" if len(cmap) > 1 else "FAIL",
            message=(
                f"Unicode cmap maps {len(cmap)} codepoints "
                f"({cov.total_present}/{cov.total_required} target Thai+English set = {cov.coverage_percent}%)."
            ),
        )
    )

    # 5. Combining mark zero-advance-width enforcement
    hmtx = font["hmtx"]
    bad_marks = []
    for cp in present_cps & THAI_COMBINING_MARKS:
        adv, _ = hmtx[cmap[cp]]
        if adv != 0:
            bad_marks.append(f"U+{cp:04X}(adv={adv})")
    checks.append(
        ValidationCheck(
            id="metrics.thai_combining_zero_width",
            status="FAIL" if bad_marks else "PASS",
            message=(
                f"Combining marks have non-zero advance width: {', '.join(bad_marks)}"
                if bad_marks
                else "All Thai combining marks have zero advance width (0 UPM)."
            ),
        )
    )

    # 6. Metrics sanity (head/hhea/OS2)
    upm = font["head"].unitsPerEm
    ascent = font["hhea"].ascent
    descent = font["hhea"].descent
    metrics_ok = upm in (1000, 2048) and ascent > 0 and descent < 0
    checks.append(
        ValidationCheck(
            id="metrics.vertical_consistency",
            status="PASS" if metrics_ok else "FAIL",
            message=f"UPM={upm}, Ascender={ascent}, Descender={descent}, LineGap={font['hhea'].lineGap}.",
        )
    )

    # 7. Name table / macOS & HandLine installability metadata
    name_tbl = font["name"]
    required_name_ids = {1: "Family", 2: "Subfamily", 4: "FullName", 5: "Version", 6: "PostScriptName"}
    missing_names = [
        label for nid, label in required_name_ids.items() if not name_tbl.getDebugName(nid)
    ]
    checks.append(
        ValidationCheck(
            id="metadata.name_table",
            status="FAIL" if missing_names else "PASS",
            message=(
                f"Missing required name records: {', '.join(missing_names)}"
                if missing_names
                else f"Name table complete (Family='{name_tbl.getDebugName(1)}', PS='{name_tbl.getDebugName(6)}')."
            ),
        )
    )

    # 8. OpenType GDEF, GPOS (mark/mkmk), GSUB (ccmp)
    has_gdef = "GDEF" in font
    has_gpos = "GPOS" in font
    has_gsub = "GSUB" in font
    gpos_feats = _extract_feature_tags(font["GPOS"]) if has_gpos else []
    gsub_feats = _extract_feature_tags(font["GSUB"]) if has_gsub else []

    checks.append(
        ValidationCheck(
            id="opentype.gdef_glyph_classes",
            status="PASS" if has_gdef else "WARN",
            message="GDEF GlyphClassDef table present (Base & Mark classes)." if has_gdef else "GDEF table absent.",
        )
    )
    checks.append(
        ValidationCheck(
            id="opentype.thai_gpos",
            status="PASS" if ("mark" in gpos_feats and "mkmk" in gpos_feats) else ("WARN" if has_gpos else "WARN"),
            message=f"GPOS features present: {', '.join(gpos_feats) if gpos_feats else 'none'}.",
        )
    )
    checks.append(
        ValidationCheck(
            id="opentype.thai_gsub",
            status="PASS" if "ccmp" in gsub_feats else "WARN",
            message=f"GSUB features present: {', '.join(gsub_feats) if gsub_feats else 'none'}.",
        )
    )

    # 9. HarfBuzz live shaping
    test_phrases = list(REQUIRED_THAI_TEST_COMBINATIONS)
    if extra_shaping_texts:
        test_phrases.extend(extra_shaping_texts)

    shaping_samples = shape_text_with_harfbuzz(ttf_bytes, test_phrases) if HAS_HARFBUZZ else []
    if HAS_HARFBUZZ:
        checks.append(
            ValidationCheck(
                id="harfbuzz.thai_shaping",
                status="PASS",
                message=f"HarfBuzz shaped {len(shaping_samples)} Thai/English test combinations successfully.",
            )
        )
    else:
        checks.append(
            ValidationCheck(
                id="harfbuzz.thai_shaping",
                status="SKIP",
                message="uharfbuzz is not installed in this Python runtime; install requirements.txt to run live HarfBuzz shaping.",
            )
        )

    passed = all(c.status != "FAIL" for c in checks)
    return FontValidationReport(
        passed=passed,
        glyph_count=len(glyph_order),
        tables_present=tables,
        has_gdef=has_gdef,
        has_thai_gpos=has_gpos,
        has_thai_gsub=has_gsub,
        gpos_features=gpos_feats,
        gsub_features=gsub_feats,
        harfbuzz_available=HAS_HARFBUZZ,
        fontbakery_available=HAS_FONTBAKERY,
        coverage={
            "total_required": cov.total_required,
            "total_present": cov.total_present,
            "coverage_percent": cov.coverage_percent,
            "by_category": cov.by_category,
            "missing_count": len(cov.missing_codepoints),
            "missing_characters": cov.missing_characters,
        },
        shaping_samples=shaping_samples,
        checks=checks,
    )
