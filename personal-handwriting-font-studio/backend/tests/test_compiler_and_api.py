import io
import unittest

from fastapi.testclient import TestClient
from fontTools.ttLib import TTFont

from app.main import app
from font_compiler import (
    FontCompileRequest,
    FontMetricsSpec,
    GlyphCompileInput,
    StrokeInput,
    StrokePoint,
    compile_ttf,
    strokes_to_glyph_outline,
    validate_ttf_bytes,
)


def _stroke(pts, width=3.4):
    return StrokeInput(
        width=width,
        points=[StrokePoint(x=x, y=y, pressure=p) for (x, y, p) in pts],
    )


class TestVectorEngineSlantAndAlternates(unittest.TestCase):
    def test_positive_and_negative_slant_shear_outlines_and_anchors(self) -> None:
        metrics = FontMetricsSpec()
        ko_strokes = [_stroke([(26, 86, 0.5), (30, 38, 0.7), (66, 38, 0.7), (68, 86, 0.5)])]
        upright = strokes_to_glyph_outline(ko_strokes, metrics, codepoint=0x0E01, slant_angle=0.0)
        pos_slant = strokes_to_glyph_outline(ko_strokes, metrics, codepoint=0x0E01, slant_angle=15.0)
        neg_slant = strokes_to_glyph_outline(ko_strokes, metrics, codepoint=0x0E01, slant_angle=-15.0)

        # Positive slant shifts top anchor right relative to bottom anchor; negative shifts left
        up_dx = upright.anchors["top"][0] - upright.anchors["bottom"][0]
        pos_dx = pos_slant.anchors["top"][0] - pos_slant.anchors["bottom"][0]
        neg_dx = neg_slant.anchors["top"][0] - neg_slant.anchors["bottom"][0]
        self.assertGreater(pos_dx, up_dx + 60)
        self.assertLess(neg_dx, up_dx - 60)
        # Advance widths recalculated so slanted glyphs never clip
        self.assertGreater(pos_slant.advance_width, pos_slant.x_max)
        self.assertGreater(neg_slant.advance_width, neg_slant.x_max)
        self.assertGreaterEqual(pos_slant.lsb, 55)
        self.assertGreaterEqual(neg_slant.lsb, 55)

    def test_multi_instance_calt_salt_and_slanted_thai_ttf(self) -> None:
        ko_alt1 = [_stroke([(24, 86, 0.5), (32, 36, 0.7), (68, 36, 0.7), (66, 86, 0.5)])]
        ko_alt2 = [_stroke([(28, 86, 0.5), (28, 40, 0.7), (64, 40, 0.7), (70, 86, 0.5)])]

        glyphs = [
            GlyphCompileInput(
                0x0E01,
                "ก",
                [_stroke([(26, 86, 0.5), (30, 38, 0.7), (66, 38, 0.7), (68, 86, 0.5)])],
                alternate_strokes=[ko_alt1, ko_alt2],
            ),
            GlyphCompileInput(0x0E19, "น", [_stroke([(26, 40, 0.5), (28, 86, 0.7), (68, 86, 0.7), (68, 40, 0.5)])]),
            GlyphCompileInput(0x0E31, "ั", [_stroke([(34, 28, 0.6), (48, 36, 0.7), (64, 26, 0.6)])]),
            GlyphCompileInput(0x0E32, "า", [_stroke([(34, 42, 0.5), (60, 42, 0.7), (62, 86, 0.5)])]),
            GlyphCompileInput(0x0E33, "ำ", [_stroke([(48, 22, 0.6), (52, 22, 0.6)]), _stroke([(36, 42, 0.5), (62, 86, 0.6)])]),
            GlyphCompileInput(0x0E34, "ิ", [_stroke([(32, 34, 0.6), (48, 24, 0.8), (64, 34, 0.6)])]),
            GlyphCompileInput(0x0E38, "ุ", [_stroke([(44, 96, 0.6), (54, 110, 0.6)])]),
            GlyphCompileInput(0x0E48, "่", [_stroke([(48, 14, 0.6), (48, 28, 0.6)])]),
            GlyphCompileInput(0x0E49, "้", [_stroke([(38, 24, 0.6), (50, 16, 0.7), (64, 22, 0.6)])]),
            GlyphCompileInput(0x0E4D, "ํ", [_stroke([(44, 24, 0.6), (52, 24, 0.6)])]),
            GlyphCompileInput(0x0041, "A", [_stroke([(22, 88, 0.6), (48, 24, 0.7), (74, 88, 0.6)])]),
        ]
        res = compile_ttf(
            FontCompileRequest(
                family_name="HandLineSlantTest",
                style_name="Regular",
                slant_angle=12.0,
                designer="Automated Test",
                glyphs=glyphs,
            )
        )
        self.assertEqual(res.alternate_glyph_count, 2)
        tt = TTFont(io.BytesIO(res.ttf_bytes))
        self.assertIn("uni0E01.alt1", tt.getGlyphOrder())
        self.assertIn("uni0E01.alt2", tt.getGlyphOrder())
        self.assertEqual(round(tt["post"].italicAngle), -12)

        report = validate_ttf_bytes(res.ttf_bytes)
        self.assertTrue(report.passed)
        self.assertIn("mark", report.gpos_features)
        self.assertIn("mkmk", report.gpos_features)
        self.assertIn("ccmp", report.gsub_features)
        self.assertIn("calt", report.gsub_features)
        self.assertIn("salt", report.gsub_features)


class TestFastAPIEndpoints(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health_outline_validate_and_download_ttf(self) -> None:
        health = self.client.get("/api/v1/health")
        self.assertEqual(health.status_code, 200)
        sample_glyph = {
            "codepoint": 0x0E01,
            "character": "ก",
            "category": "thai_consonants",
            "canvas_width": 96,
            "canvas_height": 120,
            "strokes": [
                {
                    "width": 3.4,
                    "points": [
                        {"x": 26, "y": 86, "pressure": 0.5},
                        {"x": 32, "y": 38, "pressure": 0.7},
                        {"x": 66, "y": 38, "pressure": 0.7},
                        {"x": 68, "y": 86, "pressure": 0.5},
                    ],
                }
            ],
        }
        compile_payload = {
            "family_name": "HandLineAPITest",
            "style_name": "Regular",
            "slant_angle": 8.0,
            "designer": "API Suite",
            "version": "2.1.0",
            "glyphs": [
                sample_glyph,
                {
                    "codepoint": 0x0E34,
                    "character": "ิ",
                    "category": "thai_vowels",
                    "canvas_width": 96,
                    "canvas_height": 120,
                    "strokes": [
                        {"width": 3.0, "points": [{"x": 32, "y": 32, "pressure": 0.6}, {"x": 64, "y": 32, "pressure": 0.6}]}
                    ],
                },
            ],
        }
        val_res = self.client.post("/api/v1/compile/validate", json=compile_payload)
        self.assertEqual(val_res.status_code, 200)
        self.assertTrue(val_res.json()["passed"])

        ttf_res = self.client.post("/api/v1/compile/ttf", json=compile_payload)
        self.assertEqual(ttf_res.status_code, 200)
        self.assertEqual(ttf_res.headers["content-type"], "font/ttf")
        self.assertGreater(len(ttf_res.content), 500)


if __name__ == "__main__":
    unittest.main()
