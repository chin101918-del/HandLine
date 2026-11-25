# HandLine / Personal Handwriting Font Studio

A full-stack Thai & English Handwriting-to-TTF Studio with **Multi-Instance Handwriting Database (IndexedDB + Supabase)**, **Constrained Seeded Handwriting Variation Engine**, **Geometric Slant (-25° to +25°)**, **TrueType (.TTF) Export with Thai OpenType GDEF/GPOS/GSUB (`mark`, `mkmk`, `ccmp`, `calt`, `salt`)**, and **Apple Pencil Palm Rejection & Input Protection**.

## Key Capabilities

1. **Multi-Instance Handwriting Font Database (`frontend/src/db/indexedDb.ts`)**
   - `FontSet` → `Glyph` (`unicode`, `character`, `instances[]`) → `GlyphInstance` (`id`, `strokes`, `advanceWidth`, `anchors`, `createdAt`, `metadata`).
   - Non-destructive automatic migration from legacy single-instance `localStorage` data into IndexedDB (`HandLineFontDB`), compatible with Supabase cloud sync (`supabase/migrations/001_initial_schema.sql`).
2. **Handwriting Variation Engine (`frontend/src/engine/variationEngine.ts`)**
   - Reproducible Mulberry32 seeded PRNG with anti-repetition glyph instance selection.
   - Separate Thai and English profiles: Variation Intensity (0–100%), Size Variation (0–50%), Slant (-25°..+25°), Character Spacing (0–50%), Word Spacing (0–50%), and safe baseline jitter.
   - Thai combining marks (`ั ิ ี ึ ื ุ ู ฺ ็ ่ ้ ๊ ๋ ์ ํ ๎`) inherit their base consonant's exact scale, slant shear, and vertical offset so mark-to-base and mark-to-mark alignment never detaches.
3. **Real Geometric Slant (`backend/font_compiler/stroke_to_outline.py`)**
   - Applies horizontal shear ($x' = x + (y - y_{\text{baseline}})\tan\theta$) consistently to both TrueType contours and Thai OpenType anchors, recalculating bounds and advance widths to prevent clipping/collisions. Kept strictly separate from Italic style.
4. **TrueType Export (`backend/font_compiler/compiler.py` & `thai_opentype.py`)**
   - Compiles multi-instance alternate glyphs (`uniXXXX.alt1`, `uniXXXX.alt2`, ...) into `GSUB` `calt` & `salt`, alongside `GDEF`, `GSUB` `ccmp` (`ำ` decomposition), and `GPOS` `mark`/`mkmk`.
   - Validation-gated `/api/v1/compile/ttf` refuses export if structural or metadata checks fail.
5. **Apple Pencil Palm Rejection & Input Protection (`frontend/src/engine/inputProtection.ts`)**
   - Two modes: **Apple Pencil Only** and **Finger Drawing**.
   - Filters Pointer Events using `pointerType`, `pointerId`, `setPointerCapture`, palm contact area (`width`/`height` ≥ 24px), post-pen touch cooldown (450ms), and micro-tap dot suppression while preserving Apple Pencil `pressure`, `tiltX`, and `tiltY`.

## Quick Start & Testing

```bash
# Backend tests (vector engine, slant shear, multi-instance calt/salt, FastAPI)
cd backend
PYTHONPATH=. python3 -m unittest discover -s tests -v

# Frontend engine tests (DB migration, Variation Engine, Apple Pencil Input Guard)
cd frontend
node tests/run_engine_tests.mjs

# Run full stack
docker compose up --build
```

## Known Platform Limitations

- **iPadOS Hardware Palm Rejection**: JavaScript cannot directly control iPadOS hardware-level palm rejection. This application relies on native iPadOS palm rejection and layers software-level Pointer Event filtering (`pointerType`, contact size, multi-pointer tracking, and pen-lift cooldown) on top. If a browser version omits stylus `pointerType` or contact dimensions, the guard falls back safely to standard pointer tracking.
- **OpenType Randomization in Third-Party Apps**: Exported `.ttf` files include `calt` and `salt` OpenType alternates for repeated characters, but third-party applications vary in `calt` support; HandLine's built-in Variation Engine remains authoritative for true seeded random rendering inside the app.
- **HarfBuzz / FontBakery / UFO Pipeline**: `uharfbuzz`, `ufoLib2`, `ufo2ft`, and `fontbakery` are declared in `backend/requirements.txt` and activate automatically when installed on a networked host.
