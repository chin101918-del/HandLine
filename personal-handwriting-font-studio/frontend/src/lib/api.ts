import { FontSet, ValidationReport } from '../types/font';
import { getValidInstances } from '../db/indexedDb';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export function buildCompilePayload(fontSet: FontSet) {
  const glyphs = Object.values(fontSet.glyphs)
    .map((g) => {
      const valid = getValidInstances(g);
      if (valid.length === 0) return null;
      const primary = valid[0];
      const alternates = valid.slice(1).map((alt) =>
        alt.strokes.map((s) => ({
          id: s.id,
          width: s.width,
          points: s.points,
        }))
      );
      return {
        codepoint: g.unicode,
        character: g.character,
        category: g.category,
        canvas_width: primary.canvasWidth || 96,
        canvas_height: primary.canvasHeight || 120,
        strokes: primary.strokes.map((s) => ({
          id: s.id,
          width: s.width,
          points: s.points,
        })),
        alternate_strokes: alternates,
        advance_width: primary.advanceWidth,
        lsb: primary.lsb,
        rsb: primary.rsb,
        anchors: primary.anchors,
        is_completed: true,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    family_name: fontSet.familyName,
    style_name: fontSet.styleName,
    full_name: fontSet.fullName || `${fontSet.familyName} ${fontSet.styleName}`,
    postscript_name: fontSet.postscriptName || `${fontSet.familyName}-${fontSet.styleName}`,
    designer: fontSet.designer || 'Personal Handwriting Font Studio',
    copyright_text: fontSet.copyrightText || `Copyright (c) 2026 ${fontSet.familyName}`,
    version: fontSet.version,
    slant_angle: fontSet.slantAngle || 0,
    metrics: {
      units_per_em: fontSet.metrics.unitsPerEm,
      ascender: fontSet.metrics.ascender,
      cap_height: fontSet.metrics.capHeight,
      x_height: fontSet.metrics.xHeight,
      baseline: fontSet.metrics.baseline,
      descender: fontSet.metrics.descender,
      line_gap: fontSet.metrics.lineGap,
    },
    glyphs,
  };
}

export async function validateFontProject(fontSet: FontSet): Promise<ValidationReport> {
  const res = await fetch(`${API_BASE}/api/v1/compile/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCompilePayload(fontSet)),
  });
  if (!res.ok) {
    throw new Error(`Validation failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export async function compileAndDownloadTTF(fontSet: FontSet): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/v1/compile/ttf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildCompilePayload(fontSet)),
  });
  if (!res.ok) {
    throw new Error(`TTF compile failed (${res.status}): ${await res.text()}`);
  }
  return res.blob();
}
