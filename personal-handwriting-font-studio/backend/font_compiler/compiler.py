"""
TrueType (.TTF) Font Compiler Module
Supports multi-instance alternate glyphs (calt/salt), real geometric slant (-25°..+25°),
Thai GDEF/GPOS/GSUB tables, and OS/2 v4 Thai Unicode/CodePage ranges.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

from .stroke_to_outline import (
    FontMetricsSpec,
    GlyphOutlineResult,
    StrokeInput,
    strokes_to_glyph_outline,
)
from .thai_opentype import (
    GlyphOpenTypeInfo,
    generate_thai_fea,
    is_thai_combining_mark,
    unicode_to_glyph_name,
)

try:
    import ufo2ft
    import ufoLib2

    HAS_UFO_PIPELINE = True
except ImportError:
    HAS_UFO_PIPELINE = False


@dataclass
class GlyphCompileInput:
    codepoint: int
    character: str
    strokes: List[StrokeInput]
    canvas_width: float = 96.0
    canvas_height: float = 120.0
    advance_width: Optional[int] = None
    lsb: Optional[int] = None
    rsb: Optional[int] = None
    edited_contours: Optional[List[List[Tuple[int, int]]]] = None
    anchors: Optional[Dict[str, Tuple[int, int]]] = None
    # Additional handwritten instances for the same Unicode character (compiled as .alt1, .alt2, ...)
    alternate_strokes: List[List[StrokeInput]] = field(default_factory=list)


@dataclass
class FontCompileRequest:
    family_name: str
    style_name: str = "Regular"
    full_name: str = ""
    postscript_name: str = ""
    designer: str = "Personal Handwriting Font Studio"
    copyright_text: str = ""
    version: str = "1.000"
    slant_angle: float = 0.0  # Geometric slant (-25..+25 deg), separate from style_name (Italic)
    units_per_em: int = 1000
    ascender: int = 880
    cap_height: int = 700
    x_height: int = 500
    descender: int = -260
    line_gap: int = 90
    glyphs: Sequence[GlyphCompileInput] = ()


@dataclass
class FontCompileResult:
    ttf_bytes: bytes
    glyph_count: int
    alternate_glyph_count: int
    pipeline_used: str
    fea_source: str
    compiled_glyphs: Dict[int, GlyphOutlineResult] = field(default_factory=dict)


def _draw_notdef_contour(units_per_em: int) -> List[List[Tuple[int, int]]]:
    w = round(units_per_em * 0.54)
    h = round(units_per_em * 0.72)
    t = max(round(units_per_em * 0.05), 35)
    outer = [(40, 0), (40, h), (40 + w, h), (40 + w, 0)]
    inner = [(40 + t, t), (40 + w - t, t), (40 + w - t, h - t), (40 + t, h - t)]
    return [outer, list(reversed(inner))]


def _sanitized_ps_name(req: FontCompileRequest) -> str:
    raw = req.postscript_name.strip() or f"{req.family_name}-{req.style_name}"
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", raw)
    return (cleaned or "HandwritingFont-Regular")[:63]


def _compile_via_fontbuilder(
    req: FontCompileRequest,
    primary_outlines: Dict[int, Tuple[str, GlyphOutlineResult]],
    alternate_outlines: Dict[int, List[Tuple[str, GlyphOutlineResult]]],
    fea_source: str,
) -> bytes:
    glyph_order = [".notdef", "space"]
    cmap: Dict[int, str] = {0x0020: "space"}
    for cp in sorted(primary_outlines.keys()):
        if cp == 0x0020:
            continue
        gname = primary_outlines[cp][0]
        glyph_order.append(gname)
        cmap[cp] = gname
        for alt_name, _ in alternate_outlines.get(cp, []):
            glyph_order.append(alt_name)

    fb = FontBuilder(req.units_per_em, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)

    glyf_dict = {}
    metrics_dict = {}

    notdef_pen = TTGlyphPen(None)
    for contour in _draw_notdef_contour(req.units_per_em):
        notdef_pen.moveTo(contour[0])
        for pt in contour[1:]:
            notdef_pen.lineTo(pt)
        notdef_pen.closePath()
    glyf_dict[".notdef"] = notdef_pen.glyph()
    metrics_dict[".notdef"] = (round(req.units_per_em * 0.62), 40)

    glyf_dict["space"] = TTGlyphPen(None).glyph()
    metrics_dict["space"] = (round(req.units_per_em * 0.32), 0)

    def _add_outline(gname: str, outline: GlyphOutlineResult) -> None:
        pen = TTGlyphPen(None)
        for contour in outline.contours:
            if len(contour) < 3:
                continue
            pen.moveTo(contour[0])
            for pt in contour[1:]:
                pen.lineTo(pt)
            pen.closePath()
        glyf_dict[gname] = pen.glyph()
        metrics_dict[gname] = (outline.advance_width, outline.lsb)

    for cp, (gname, outline) in primary_outlines.items():
        if cp == 0x0020:
            continue
        _add_outline(gname, outline)
        for alt_name, alt_outline in alternate_outlines.get(cp, []):
            _add_outline(alt_name, alt_outline)

    fb.setupGlyf(glyf_dict)
    fb.setupHorizontalMetrics(metrics_dict)
    fb.setupHorizontalHeader(
        ascent=req.ascender,
        descent=req.descender,
        lineGap=req.line_gap,
    )

    ps_name = _sanitized_ps_name(req)
    full_name = req.full_name.strip() or f"{req.family_name} {req.style_name}"
    copyright_str = req.copyright_text.strip() or f"Copyright (c) {req.designer}"
    fb.setupNameTable(
        {
            "copyright": copyright_str,
            "familyName": req.family_name,
            "styleName": req.style_name,
            "uniqueFontIdentifier": f"{req.version};PHFS;{ps_name}",
            "fullName": full_name,
            "version": f"Version {req.version}",
            "psName": ps_name,
            "designer": req.designer,
        }
    )

    fb.setupOS2(
        version=4,
        sTypoAscender=req.ascender,
        sTypoDescender=req.descender,
        sTypoLineGap=req.line_gap,
        usWinAscent=max(req.ascender + 120, 1000),
        usWinDescent=max(abs(req.descender) + 80, 340),
        sxHeight=req.x_height,
        sCapHeight=req.cap_height,
        fsSelection=0x0040 | 0x0080,
        ulUnicodeRange1=0x00000001,
        ulUnicodeRange2=0x01000000,
        ulCodePageRange1=0x00010001,
    )
    fb.setupPost(italicAngle=-round(req.slant_angle, 2))

    tt_font: TTFont = fb.font
    if fea_source.strip():
        addOpenTypeFeaturesFromString(tt_font, fea_source)

    buf = io.BytesIO()
    tt_font.save(buf)
    return buf.getvalue()


def compile_ttf(req: FontCompileRequest) -> FontCompileResult:
    primary_outlines: Dict[int, Tuple[str, GlyphOutlineResult]] = {}
    alternate_outlines: Dict[int, List[Tuple[str, GlyphOutlineResult]]] = {}
    ot_primary: Dict[int, GlyphOpenTypeInfo] = {}
    ot_alternates: Dict[int, List[GlyphOpenTypeInfo]] = {}
    compiled_map: Dict[int, GlyphOutlineResult] = {}
    total_alts = 0

    for g in req.glyphs:
        metrics = FontMetricsSpec(
            units_per_em=req.units_per_em,
            ascender=req.ascender,
            cap_height=req.cap_height,
            x_height=req.x_height,
            descender=req.descender,
            canvas_width=g.canvas_width,
            canvas_height=g.canvas_height,
        )
        combining = is_thai_combining_mark(g.codepoint)
        outline = strokes_to_glyph_outline(
            strokes=g.strokes,
            metrics=metrics,
            codepoint=g.codepoint,
            is_combining_mark=combining,
            custom_advance_width=g.advance_width,
            custom_lsb=g.lsb,
            custom_rsb=g.rsb,
            edited_contours=g.edited_contours,
            anchor_overrides=g.anchors,
            slant_angle=req.slant_angle,
        )
        gname = unicode_to_glyph_name(g.codepoint, 0)
        primary_outlines[g.codepoint] = (gname, outline)
        compiled_map[g.codepoint] = outline
        ot_primary[g.codepoint] = GlyphOpenTypeInfo(
            glyph_name=gname,
            codepoint=g.codepoint,
            x_min=outline.x_min,
            y_min=outline.y_min,
            x_max=outline.x_max,
            y_max=outline.y_max,
            advance_width=outline.advance_width,
            anchors=outline.anchors,
        )

        if g.alternate_strokes:
            alt_list: List[Tuple[str, GlyphOutlineResult]] = []
            ot_alt_list: List[GlyphOpenTypeInfo] = []
            for idx, alt_stroke_set in enumerate(g.alternate_strokes, start=1):
                if not alt_stroke_set:
                    continue
                alt_outline = strokes_to_glyph_outline(
                    strokes=alt_stroke_set,
                    metrics=metrics,
                    codepoint=g.codepoint,
                    is_combining_mark=combining,
                    slant_angle=req.slant_angle,
                )
                alt_name = unicode_to_glyph_name(g.codepoint, idx)
                alt_list.append((alt_name, alt_outline))
                ot_alt_list.append(
                    GlyphOpenTypeInfo(
                        glyph_name=alt_name,
                        codepoint=g.codepoint,
                        x_min=alt_outline.x_min,
                        y_min=alt_outline.y_min,
                        x_max=alt_outline.x_max,
                        y_max=alt_outline.y_max,
                        advance_width=alt_outline.advance_width,
                        anchors=alt_outline.anchors,
                        is_alternate=True,
                    )
                )
                total_alts += 1
            if alt_list:
                alternate_outlines[g.codepoint] = alt_list
                ot_alternates[g.codepoint] = ot_alt_list

    fea_source = generate_thai_fea(glyph_infos=ot_primary, alternate_infos=ot_alternates)
    ttf_bytes = _compile_via_fontbuilder(req, primary_outlines, alternate_outlines, fea_source)
    pipeline_used = "fontTools.FontBuilder+feaLib"

    return FontCompileResult(
        ttf_bytes=ttf_bytes,
        glyph_count=len(primary_outlines) + total_alts + 2,
        alternate_glyph_count=total_alts,
        pipeline_used=pipeline_used,
        fea_source=fea_source,
        compiled_glyphs=compiled_map,
    )
