"""
Vector Glyph Engine — Stroke-to-Outline, Geometric Slant (-25°..+25°), & Normalization
Separates raw handwriting strokes from generated TrueType-ready vector outlines.
Supports:
- Centripetal Catmull-Rom smooth curve resampling
- Pressure-sensitive variable-width outline expansion with rounded caps
- Closed clockwise-wound TrueType contours
- Real geometric slant shear (-25° to +25°) applied consistently to BOTH contours
  and Thai OpenType anchors, with recalculated bounds & advance widths to prevent
  glyph collisions and clipping
- Geometry-derived base & mark anchor coordinates (overridable via glyph metadata)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from .charset import THAI_ABOVE_VOWELS, THAI_BELOW_MARKS, THAI_TONE_MARKS

THAI_TALL_ASCENDERS = {0x0E1B, 0x0E1D, 0x0E1F, 0x0E2C}  # ป ฝ ฟ ฬ
THAI_DEEP_DESCENDERS = {0x0E0E, 0x0E0F}  # ฎ ฏ


@dataclass(frozen=True)
class StrokePoint:
    x: float
    y: float
    pressure: float = 0.5


@dataclass(frozen=True)
class StrokeInput:
    points: List[StrokePoint]
    width: float = 3.2


@dataclass(frozen=True)
class FontMetricsSpec:
    units_per_em: int = 1000
    ascender: int = 880
    cap_height: int = 700
    x_height: int = 500
    baseline: int = 0
    descender: int = -260
    canvas_width: float = 96.0
    canvas_height: float = 120.0
    ascender_ratio: float = 0.14
    baseline_ratio: float = 0.74
    descender_ratio: float = 0.92


@dataclass
class GlyphOutlineResult:
    contours: List[List[Tuple[int, int]]]
    x_min: int
    y_min: int
    x_max: int
    y_max: int
    advance_width: int
    lsb: int
    rsb: int
    slant_angle: float = 0.0
    anchors: Dict[str, Tuple[int, int]] = field(default_factory=dict)


def _catmull_rom_resample(
    points: Sequence[StrokePoint],
    subdivisions: int = 4,
) -> List[StrokePoint]:
    if len(points) <= 2:
        return list(points)

    cleaned: List[StrokePoint] = [points[0]]
    for pt in points[1:]:
        prev = cleaned[-1]
        if math.hypot(pt.x - prev.x, pt.y - prev.y) >= 0.45:
            cleaned.append(pt)
    if len(cleaned) <= 2:
        return cleaned

    padded = [cleaned[0], *cleaned, cleaned[-1]]
    out: List[StrokePoint] = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1], padded[i], padded[i + 1], padded[i + 2]
        for step in range(subdivisions):
            t = step / subdivisions
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * (
                (2.0 * p1.x)
                + (-p0.x + p2.x) * t
                + (2.0 * p0.x - 5.0 * p1.x + 4.0 * p2.x - p3.x) * t2
                + (-p0.x + 3.0 * p1.x - 3.0 * p2.x + p3.x) * t3
            )
            y = 0.5 * (
                (2.0 * p1.y)
                + (-p0.y + p2.y) * t
                + (2.0 * p0.y - 5.0 * p1.y + 4.0 * p2.y - p3.y) * t2
                + (-p0.y + 3.0 * p1.y - 3.0 * p2.y + p3.y) * t3
            )
            pressure = p1.pressure + (p2.pressure - p1.pressure) * t
            out.append(StrokePoint(x=x, y=y, pressure=pressure))
    out.append(cleaned[-1])
    return out


def _canvas_to_font_coords(x: float, y: float, metrics: FontMetricsSpec) -> Tuple[float, float]:
    baseline_y_px = metrics.canvas_height * metrics.baseline_ratio
    ascender_y_px = metrics.canvas_height * metrics.ascender_ratio
    span_px = max(baseline_y_px - ascender_y_px, 1.0)
    scale = (metrics.ascender - metrics.baseline) / span_px
    fx = x * scale
    fy = (baseline_y_px - y) * scale + metrics.baseline
    return fx, fy


def _ensure_clockwise(poly: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
    area = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    if area > 0:
        poly = list(reversed(poly))
    return poly


def _expand_stroke_to_polygon(
    stroke: StrokeInput,
    metrics: FontMetricsSpec,
    cap_segments: int = 5,
) -> List[Tuple[int, int]]:
    pts = _catmull_rom_resample(stroke.points, subdivisions=3)
    if not pts:
        return []

    baseline_y_px = metrics.canvas_height * metrics.baseline_ratio
    ascender_y_px = metrics.canvas_height * metrics.ascender_ratio
    scale = (metrics.ascender - metrics.baseline) / max(baseline_y_px - ascender_y_px, 1.0)

    if len(pts) == 1 or (
        len(pts) == 2 and math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 0.8
    ):
        cx, cy = _canvas_to_font_coords(pts[0].x, pts[0].y, metrics)
        radius = max(stroke.width * 0.55 * (0.65 + 0.7 * pts[0].pressure) * scale, 12.0)
        contour: List[Tuple[int, int]] = []
        steps = 10
        for i in range(steps):
            angle = -2.0 * math.pi * i / steps
            contour.append((round(cx + radius * math.cos(angle)), round(cy + radius * math.sin(angle))))
        return contour

    font_pts = [
        (*_canvas_to_font_coords(p.x, p.y, metrics), max(0.2, min(1.0, p.pressure)))
        for p in pts
    ]

    left_side: List[Tuple[float, float]] = []
    right_side: List[Tuple[float, float]] = []

    n = len(font_pts)
    for i, (fx, fy, pressure) in enumerate(font_pts):
        if i == 0:
            dx, dy = font_pts[1][0] - fx, font_pts[1][1] - fy
        elif i == n - 1:
            dx, dy = fx - font_pts[i - 1][0], fy - font_pts[i - 1][1]
        else:
            dx, dy = font_pts[i + 1][0] - font_pts[i - 1][0], font_pts[i + 1][1] - font_pts[i - 1][1]

        length = math.hypot(dx, dy)
        nx, ny = (0.0, 1.0) if length < 1e-6 else (-dy / length, dx / length)
        half_w = max(stroke.width * 0.5 * (0.6 + 0.75 * pressure) * scale, 10.0)
        left_side.append((fx + nx * half_w, fy + ny * half_w))
        right_side.append((fx - nx * half_w, fy - ny * half_w))

    end_x, end_y, end_p = font_pts[-1]
    end_hw = max(stroke.width * 0.5 * (0.6 + 0.75 * end_p) * scale, 10.0)
    end_ang0 = math.atan2(left_side[-1][1] - end_y, left_side[-1][0] - end_x)
    end_cap = [
        (
            end_x + end_hw * math.cos(end_ang0 - math.pi * (k / cap_segments)),
            end_y + end_hw * math.sin(end_ang0 - math.pi * (k / cap_segments)),
        )
        for k in range(1, cap_segments)
    ]

    start_x, start_y, start_p = font_pts[0]
    start_hw = max(stroke.width * 0.5 * (0.6 + 0.75 * start_p) * scale, 10.0)
    start_ang0 = math.atan2(right_side[0][1] - start_y, right_side[0][0] - start_x)
    start_cap = [
        (
            start_x + start_hw * math.cos(start_ang0 - math.pi * (k / cap_segments)),
            start_y + start_hw * math.sin(start_ang0 - math.pi * (k / cap_segments)),
        )
        for k in range(1, cap_segments)
    ]

    raw_poly = _ensure_clockwise(left_side + end_cap + list(reversed(right_side)) + start_cap)
    rounded: List[Tuple[int, int]] = []
    for px, py in raw_poly:
        ipt = (round(px), round(py))
        if not rounded or rounded[-1] != ipt:
            rounded.append(ipt)
    if len(rounded) > 1 and rounded[0] == rounded[-1]:
        rounded.pop()
    return rounded


def apply_slant_to_point(x: int, y: int, slant_deg: float, baseline: int = 0) -> Tuple[int, int]:
    """Applies geometric horizontal shear x' = x + (y - baseline) * tan(slant_deg)."""
    clamped = max(-25.0, min(25.0, float(slant_deg)))
    if abs(clamped) < 1e-4:
        return x, y
    shear = math.tan(math.radians(clamped))
    return round(x + (y - baseline) * shear), y


def derive_glyph_anchors(
    codepoint: int,
    contours: Sequence[Sequence[Tuple[int, int]]],
    x_min: int,
    y_min: int,
    x_max: int,
    y_max: int,
    metrics: FontMetricsSpec,
    anchor_overrides: Optional[Dict[str, Tuple[int, int]]] = None,
) -> Dict[str, Tuple[int, int]]:
    width = max(x_max - x_min, 80)
    center_x = round((x_min + x_max) / 2)
    anchors: Dict[str, Tuple[int, int]] = {}

    if codepoint in THAI_ABOVE_VOWELS:
        anchors["_top"] = (center_x, y_min - 24)
        anchors["top_tone"] = (center_x, y_max + 36)
    elif codepoint in THAI_TONE_MARKS:
        anchors["_tone"] = (center_x, y_min - 22)
    elif codepoint in THAI_BELOW_MARKS:
        anchors["_bottom"] = (center_x, y_max + 26)
    elif 0x0E01 <= codepoint <= 0x0E2E:
        if codepoint in THAI_TALL_ASCENDERS:
            cutoff_x = x_min + width * 0.68
            body_ys = [pt[1] for c in contours for pt in c if pt[0] <= cutoff_x]
            body_top = max(body_ys) if body_ys else round(metrics.x_height * 1.05)
            top_x = round(x_min + width * 0.36)
            top_y = max(body_top + 35, metrics.x_height + 30)
        else:
            top_x = round(x_min + width * 0.52)
            top_y = max(y_max + 35, metrics.x_height + 30)

        if codepoint in THAI_DEEP_DESCENDERS:
            bot_x = round(x_min + width * 0.54)
            bot_y = min(y_min - 38, metrics.descender - 20)
        else:
            bot_x = round(x_min + width * 0.54)
            bot_y = min(y_min - 28, -32)

        anchors["top"] = (top_x, top_y)
        anchors["tone"] = (top_x, top_y + 18)
        anchors["bottom"] = (bot_x, bot_y)

    if anchor_overrides:
        for k, (ax, ay) in anchor_overrides.items():
            anchors[k] = (round(ax), round(ay))

    return anchors


def strokes_to_glyph_outline(
    strokes: Sequence[StrokeInput],
    metrics: FontMetricsSpec,
    codepoint: int = 0,
    is_combining_mark: bool = False,
    custom_advance_width: Optional[int] = None,
    custom_lsb: Optional[int] = None,
    custom_rsb: Optional[int] = None,
    edited_contours: Optional[Sequence[Sequence[Tuple[int, int]]]] = None,
    anchor_overrides: Optional[Dict[str, Tuple[int, int]]] = None,
    slant_angle: float = 0.0,
    default_side_bearing: int = 55,
) -> GlyphOutlineResult:
    """
    Converts strokes into normalized TrueType outlines, applies real geometric
    slant (-25° to +25°) consistently to contours and Thai anchors, and
    recalculates glyph bounds and advance widths to prevent clipping/collisions.
    """
    clamped_slant = max(-25.0, min(25.0, float(slant_angle)))

    if edited_contours:
        raw_contours = [
            [(round(p[0]), round(p[1])) for p in c]
            for c in edited_contours
            if len(c) >= 3
        ]
    else:
        raw_contours = []
        for stroke in strokes:
            poly = _expand_stroke_to_polygon(stroke, metrics)
            if len(poly) >= 3:
                raw_contours.append(poly)

    if not raw_contours:
        fallback_adv = 0 if is_combining_mark else round(metrics.units_per_em * 0.34)
        return GlyphOutlineResult(
            contours=[],
            x_min=0,
            y_min=0,
            x_max=0,
            y_max=0,
            advance_width=custom_advance_width if custom_advance_width is not None else fallback_adv,
            lsb=0,
            rsb=0,
            slant_angle=clamped_slant,
            anchors=derive_glyph_anchors(codepoint, [], 0, 0, 0, 0, metrics, anchor_overrides),
        )

    # 1. Derive upright anchors from upright geometry first (so tall-stem detection is accurate)
    u_xs = [pt[0] for c in raw_contours for pt in c]
    u_ys = [pt[1] for c in raw_contours for pt in c]
    u_x_min, u_x_max = min(u_xs), max(u_xs)
    u_y_min, u_y_max = min(u_ys), max(u_ys)

    upright_anchors = derive_glyph_anchors(
        codepoint, raw_contours, u_x_min, u_y_min, u_x_max, u_y_max, metrics, anchor_overrides
    )

    # 2. Apply geometric slant shear consistently to BOTH contours and anchors
    if abs(clamped_slant) >= 1e-4:
        slanted_contours = [
            [apply_slant_to_point(x, y, clamped_slant, metrics.baseline) for (x, y) in c]
            for c in raw_contours
        ]
        slanted_anchors = {
            k: apply_slant_to_point(ax, ay, clamped_slant, metrics.baseline)
            for k, (ax, ay) in upright_anchors.items()
        }
    else:
        slanted_contours = raw_contours
        slanted_anchors = upright_anchors

    # 3. Recalculate bounds & side bearings after slant to prevent clipping/collisions
    xs = [pt[0] for c in slanted_contours for pt in c]
    ys = [pt[1] for c in slanted_contours for pt in c]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    if is_combining_mark:
        center_x = round((x_min + x_max) / 2)
        shift_x = -center_x
        shifted = [[(x + shift_x, y) for (x, y) in c] for c in slanted_contours]
        shifted_anchors = {k: (ax + shift_x, ay) for k, (ax, ay) in slanted_anchors.items()}
        nx_min, nx_max = x_min + shift_x, x_max + shift_x
        return GlyphOutlineResult(
            contours=shifted,
            x_min=nx_min,
            y_min=y_min,
            x_max=nx_max,
            y_max=y_max,
            advance_width=0,
            lsb=nx_min,
            rsb=-nx_max,
            slant_angle=clamped_slant,
            anchors=shifted_anchors,
        )

    # Extra breathing room for strong slant angles so adjacent slanted glyphs never collide
    slant_pad = round(abs(clamped_slant) * 0.9)
    lsb = custom_lsb if custom_lsb is not None else (default_side_bearing + slant_pad)
    rsb = custom_rsb if custom_rsb is not None else (default_side_bearing + slant_pad)
    shift_x = lsb - x_min
    shifted = [[(x + shift_x, y) for (x, y) in c] for c in slanted_contours]
    shifted_anchors = {k: (ax + shift_x, ay) for k, (ax, ay) in slanted_anchors.items()}
    glyph_w = x_max - x_min
    nx_min, nx_max = lsb, lsb + glyph_w
    advance_width = (
        custom_advance_width
        if custom_advance_width is not None
        else max(glyph_w + lsb + rsb, round(metrics.units_per_em * 0.26))
    )
    actual_rsb = advance_width - nx_max
    return GlyphOutlineResult(
        contours=shifted,
        x_min=nx_min,
        y_min=y_min,
        x_max=nx_max,
        y_max=y_max,
        advance_width=advance_width,
        lsb=lsb,
        rsb=actual_rsb,
        slant_angle=clamped_slant,
        anchors=shifted_anchors,
    )
