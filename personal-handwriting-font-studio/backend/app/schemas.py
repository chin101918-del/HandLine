from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field


class StrokePointDTO(BaseModel):
    x: float
    y: float
    pressure: float = Field(default=0.5, ge=0.0, le=1.0)
    timestamp: Optional[float] = None


class StrokeDTO(BaseModel):
    id: Optional[str] = None
    width: float = Field(default=3.2, gt=0.2, le=40.0)
    points: List[StrokePointDTO] = Field(default_factory=list)


class GlyphPayload(BaseModel):
    codepoint: int = Field(..., ge=32, le=0x10FFFF)
    character: str = Field(..., min_length=1, max_length=2)
    category: str = "thai_consonants"
    canvas_width: float = Field(default=96.0, gt=10.0)
    canvas_height: float = Field(default=120.0, gt=10.0)
    strokes: List[StrokeDTO] = Field(default_factory=list)
    alternate_strokes: List[List[StrokeDTO]] = Field(default_factory=list)
    edited_contours: Optional[List[List[Tuple[int, int]]]] = None
    advance_width: Optional[int] = None
    lsb: Optional[int] = None
    rsb: Optional[int] = None
    anchors: Optional[Dict[str, Tuple[int, int]]] = None
    is_completed: bool = False


class FontMetricsDTO(BaseModel):
    units_per_em: int = Field(default=1000)
    ascender: int = Field(default=880)
    cap_height: int = Field(default=700)
    x_height: int = Field(default=500)
    baseline: int = Field(default=0)
    descender: int = Field(default=-260)
    line_gap: int = Field(default=90)


class ProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    family_name: str = Field(..., min_length=1, max_length=64)
    style_name: str = Field(default="Regular", max_length=32)
    full_name: str = Field(default="", max_length=128)
    postscript_name: str = Field(default="", max_length=63)
    designer: str = Field(default="", max_length=120)
    copyright_text: str = Field(default="", max_length=200)
    version: str = Field(default="1.000", max_length=32)
    metrics: FontMetricsDTO = Field(default_factory=FontMetricsDTO)


class ProjectRecord(ProjectCreateRequest):
    id: str
    created_at: datetime
    updated_at: datetime
    glyphs: Dict[int, GlyphPayload] = Field(default_factory=dict)


class OutlinePreviewRequest(BaseModel):
    glyph: GlyphPayload
    metrics: FontMetricsDTO = Field(default_factory=FontMetricsDTO)


class OutlinePreviewResponse(BaseModel):
    codepoint: int
    contours: List[List[Tuple[int, int]]]
    x_min: int
    y_min: int
    x_max: int
    y_max: int
    advance_width: int
    lsb: int
    rsb: int
    anchors: Dict[str, Tuple[int, int]]


class CompileDirectRequest(BaseModel):
    family_name: str = Field(..., min_length=1, max_length=64)
    style_name: str = Field(default="Regular", max_length=32)
    full_name: str = Field(default="", max_length=128)
    postscript_name: str = Field(default="", max_length=63)
    designer: str = Field(default="Personal Handwriting Font Studio", max_length=120)
    copyright_text: str = Field(default="", max_length=200)
    version: str = Field(default="1.000", max_length=32)
    slant_angle: float = Field(default=0.0, ge=-25.0, le=25.0)
    metrics: FontMetricsDTO = Field(default_factory=FontMetricsDTO)
    glyphs: List[GlyphPayload] = Field(default_factory=list)
    test_texts: Optional[List[str]] = None


class ValidationCheckDTO(BaseModel):
    id: str
    status: str
    message: str


class ValidationReportDTO(BaseModel):
    passed: bool
    glyph_count: int
    pipeline_used: str
    tables_present: List[str]
    has_gdef: bool
    has_thai_gpos: bool
    has_thai_gsub: bool
    gpos_features: List[str]
    gsub_features: List[str]
    harfbuzz_available: bool
    fontbakery_available: bool
    coverage: Dict[str, Any]
    shaping_samples: List[Dict[str, Any]] = Field(default_factory=list)
    checks: List[ValidationCheckDTO] = Field(default_factory=list)
    fea_preview: str = ""
