"""
Personal Handwriting Font Studio — FastAPI Backend
Endpoints:
- GET  /api/v1/health
- GET  /api/v1/projects
- POST /api/v1/projects
- GET  /api/v1/projects/{project_id}
- PUT  /api/v1/projects/{project_id}/glyphs/{codepoint}
- POST /api/v1/glyphs/outline
- POST /api/v1/compile/ttf
- POST /api/v1/compile/validate
- POST /api/v1/compile/shape
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from font_compiler import (
    HAS_FONTBAKERY,
    HAS_HARFBUZZ,
    REQUIRED_THAI_TEST_COMBINATIONS,
    FontCompileRequest,
    FontMetricsSpec,
    GlyphCompileInput,
    StrokeInput,
    StrokePoint,
    compile_ttf,
    shape_text_with_harfbuzz,
    strokes_to_glyph_outline,
    validate_ttf_bytes,
)
from font_compiler.compiler import HAS_UFO_PIPELINE
from font_compiler.thai_opentype import is_thai_combining_mark

from .schemas import (
    CompileDirectRequest,
    GlyphPayload,
    OutlinePreviewRequest,
    OutlinePreviewResponse,
    ProjectCreateRequest,
    ProjectRecord,
    ValidationCheckDTO,
    ValidationReportDTO,
)

app = FastAPI(
    title="Personal Handwriting Font Studio API",
    version="2.0.0",
    description=(
        "Production REST API converting Thai & English handwriting into validated, "
        "installable TrueType (.TTF) fonts with OpenType GDEF/GPOS/GSUB tables."
    ),
)

allowed_origins = os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_PROJECTS: Dict[str, ProjectRecord] = {}


def _dump_model(obj: Any) -> Dict[str, Any]:
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    return obj.dict()


def _to_compile_request(req: CompileDirectRequest) -> FontCompileRequest:
    glyph_inputs: List[GlyphCompileInput] = []
    for g in req.glyphs:
        strokes = [
            StrokeInput(
                width=s.width,
                points=[StrokePoint(x=p.x, y=p.y, pressure=p.pressure) for p in s.points],
            )
            for s in g.strokes
            if s.points
        ]
        if not strokes and not g.edited_contours:
            continue
        glyph_inputs.append(
            GlyphCompileInput(
                codepoint=g.codepoint,
                character=g.character,
                strokes=strokes,
                canvas_width=g.canvas_width,
                canvas_height=g.canvas_height,
                advance_width=g.advance_width,
                lsb=g.lsb,
                rsb=g.rsb,
                edited_contours=g.edited_contours,
                anchors=g.anchors,
                alternate_strokes=[
                    [StrokeInput(width=s.width, points=[StrokePoint(x=p.x, y=p.y, pressure=p.pressure) for p in s.points]) for s in alt if s.points]
                    for alt in g.alternate_strokes
                ],
            )
        )
    return FontCompileRequest(
        family_name=req.family_name,
        style_name=req.style_name,
        full_name=req.full_name,
        postscript_name=req.postscript_name,
        designer=req.designer,
        copyright_text=req.copyright_text,
        version=req.version,
        slant_angle=req.slant_angle,
        units_per_em=req.metrics.units_per_em,
        ascender=req.metrics.ascender,
        cap_height=req.metrics.cap_height,
        x_height=req.metrics.x_height,
        descender=req.metrics.descender,
        line_gap=req.metrics.line_gap,
        glyphs=glyph_inputs,
    )


@app.get("/api/v1/health")
def health_check() -> Dict[str, Any]:
    return {
        "status": "ok",
        "service": "personal-handwriting-font-studio",
        "version": "2.0.0",
        "capabilities": {
            "ufo_pipeline": HAS_UFO_PIPELINE,
            "harfbuzz": HAS_HARFBUZZ,
            "fontbakery": HAS_FONTBAKERY,
        },
    }


@app.get("/api/v1/projects", response_model=List[ProjectRecord])
def list_projects() -> List[ProjectRecord]:
    return list(_PROJECTS.values())


@app.post("/api/v1/projects", response_model=ProjectRecord, status_code=201)
def create_project(payload: ProjectCreateRequest) -> ProjectRecord:
    now = datetime.now(timezone.utc)
    pid = str(uuid.uuid4())
    record = ProjectRecord(
        id=pid,
        created_at=now,
        updated_at=now,
        **_dump_model(payload),
    )
    _PROJECTS[pid] = record
    return record


@app.get("/api/v1/projects/{project_id}", response_model=ProjectRecord)
def get_project(project_id: str) -> ProjectRecord:
    if project_id not in _PROJECTS:
        raise HTTPException(status_code=404, detail="Project not found")
    return _PROJECTS[project_id]


@app.put("/api/v1/projects/{project_id}/glyphs/{codepoint}", response_model=GlyphPayload)
def upsert_glyph(project_id: str, codepoint: int, payload: GlyphPayload) -> GlyphPayload:
    project = _PROJECTS.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if payload.codepoint != codepoint:
        raise HTTPException(status_code=400, detail="Codepoint in URL does not match payload")
    project.glyphs[codepoint] = payload
    project.updated_at = datetime.now(timezone.utc)
    return payload


@app.post("/api/v1/glyphs/outline", response_model=OutlinePreviewResponse)
def generate_glyph_outline(payload: OutlinePreviewRequest) -> OutlinePreviewResponse:
    """Converts a single glyph's strokes into normalized vector contours, bearings, and anchors."""
    g = payload.glyph
    strokes = [
        StrokeInput(
            width=s.width,
            points=[StrokePoint(x=p.x, y=p.y, pressure=p.pressure) for p in s.points],
        )
        for s in g.strokes
        if s.points
    ]
    metrics = FontMetricsSpec(
        units_per_em=payload.metrics.units_per_em,
        ascender=payload.metrics.ascender,
        cap_height=payload.metrics.cap_height,
        x_height=payload.metrics.x_height,
        descender=payload.metrics.descender,
        canvas_width=g.canvas_width,
        canvas_height=g.canvas_height,
    )
    out = strokes_to_glyph_outline(
        strokes=strokes,
        metrics=metrics,
        codepoint=g.codepoint,
        is_combining_mark=is_thai_combining_mark(g.codepoint),
        custom_advance_width=g.advance_width,
        custom_lsb=g.lsb,
        custom_rsb=g.rsb,
        edited_contours=g.edited_contours,
        anchor_overrides=g.anchors,
    )
    return OutlinePreviewResponse(
        codepoint=g.codepoint,
        contours=out.contours,
        x_min=out.x_min,
        y_min=out.y_min,
        x_max=out.x_max,
        y_max=out.y_max,
        advance_width=out.advance_width,
        lsb=out.lsb,
        rsb=out.rsb,
        anchors=out.anchors,
    )


@app.post("/api/v1/compile/ttf")
def compile_font_direct(payload: CompileDirectRequest) -> Response:
    """Compiles, validates, and returns a downloadable TrueType (.TTF) file."""
    compile_req = _to_compile_request(payload)
    if not compile_req.glyphs:
        raise HTTPException(
            status_code=400,
            detail="At least one drawn glyph is required before compiling a TTF.",
        )
    try:
        result = compile_ttf(compile_req)
        report = validate_ttf_bytes(result.ttf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Font compilation error: {exc}")

    if not report.passed:
        failed = [c.message for c in report.checks if c.status == "FAIL"]
        raise HTTPException(
            status_code=422,
            detail=f"Font failed validation and cannot be exported: {'; '.join(failed)}",
        )

    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "", payload.family_name) or "HandwritingFont"
    filename = f"{safe_name}-{payload.style_name}.ttf"
    return Response(
        content=result.ttf_bytes,
        media_type="font/ttf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Font-Pipeline": result.pipeline_used,
            "X-Glyph-Count": str(result.glyph_count),
            "X-Validation-Passed": "true",
        },
    )


@app.post("/api/v1/compile/validate", response_model=ValidationReportDTO)
def validate_font_direct(payload: CompileDirectRequest) -> ValidationReportDTO:
    compile_req = _to_compile_request(payload)
    if not compile_req.glyphs:
        raise HTTPException(status_code=400, detail="At least one drawn glyph is required")
    try:
        result = compile_ttf(compile_req)
        report = validate_ttf_bytes(result.ttf_bytes, extra_shaping_texts=payload.test_texts)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Validation error: {exc}")

    return ValidationReportDTO(
        passed=report.passed,
        glyph_count=report.glyph_count,
        pipeline_used=result.pipeline_used,
        tables_present=report.tables_present,
        has_gdef=report.has_gdef,
        has_thai_gpos=report.has_thai_gpos,
        has_thai_gsub=report.has_thai_gsub,
        gpos_features=report.gpos_features,
        gsub_features=report.gsub_features,
        harfbuzz_available=report.harfbuzz_available,
        fontbakery_available=report.fontbakery_available,
        coverage=report.coverage,
        shaping_samples=report.shaping_samples,
        checks=[
            ValidationCheckDTO(id=c.id, status=c.status, message=c.message)
            for c in report.checks
        ],
        fea_preview=result.fea_source,
    )


@app.post("/api/v1/compile/shape")
def test_thai_shaping(payload: CompileDirectRequest) -> Dict[str, Any]:
    """Compiles the font in memory and runs HarfBuzz Thai shaping tests."""
    compile_req = _to_compile_request(payload)
    if not compile_req.glyphs:
        raise HTTPException(status_code=400, detail="At least one drawn glyph is required")
    result = compile_ttf(compile_req)
    texts = payload.test_texts or list(REQUIRED_THAI_TEST_COMBINATIONS)
    if not HAS_HARFBUZZ:
        report = validate_ttf_bytes(result.ttf_bytes)
        return {
            "harfbuzz_available": False,
            "message": "uharfbuzz is not installed in this runtime; GPOS/GSUB tables were verified structurally.",
            "gpos_features": report.gpos_features,
            "gsub_features": report.gsub_features,
            "shaping_samples": [],
        }
    samples = shape_text_with_harfbuzz(result.ttf_bytes, texts)
    return {
        "harfbuzz_available": True,
        "pipeline_used": result.pipeline_used,
        "shaping_samples": samples,
    }
