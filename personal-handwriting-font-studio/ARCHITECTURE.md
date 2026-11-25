# Architecture & Deployment Guide — Personal Handwriting Font Studio

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React 18 + TypeScript + Vite + Tailwind CSS)      │
│ - Character Sheet (actual-size Pointer Events + Apple Pencil)│
│ - Vector Outline & Anchor Inspector                         │
│ - Real Font Preview (@font-face TTF) + Editor Stroke Preview│
│ - Supabase Auth (Email / Magic Link) + Cloud Autosave       │
│ - LocalStorage v1→v2 Migration & Offline Fallback           │
└───────────────┬─────────────────────────────┬───────────────┘
                │ REST (HTTPS / JSON)         │ Supabase JS SDK (anon key)
                ▼                             ▼
┌─────────────────────────────────┐  ┌────────────────────────┐
│ Backend (Python 3.11 + FastAPI) │  │ Supabase Cloud         │
│ - /api/v1/glyphs/outline        │  │ - Auth (Email/OTP)     │
│ - /api/v1/compile/validate      │  │ - PostgreSQL + RLS     │
│ - /api/v1/compile/shape         │  │   (profiles, projects, │
│ - /api/v1/compile/ttf           │  │    glyphs, versions,   │
│                                 │  │    export_history)     │
│ Decoupled `font_compiler/`:     │  │ - Private Storage      │
│ 1. stroke_to_outline.py         │  │   (exported-fonts,     │
│ 2. thai_opentype.py (GDEF/GPOS) │  │    version-snapshots)  │
│ 3. compiler.py (ufo2ft/FontTools)│ └────────────────────────┘
│ 4. validator.py (HarfBuzz/FB)   │
└─────────────────────────────────┘
```

## Thai OpenType Shaping Pipeline

1. **Strokes → Outlines (`stroke_to_outline.py`)**: Centripetal Catmull-Rom resampling + pressure-weighted variable-width ribbon expansion + clockwise winding verification in 1000 UPM space.
2. **Geometry-Derived Anchors**: Base Thai consonants (`ก–ฮ`) derive `top`, `tone`, and `bottom` anchors directly from actual glyph contour geometry (tall ascenders `ป ฝ ฟ ฬ` measure body top excluding the right stem and shift `top` left; deep descenders `ฎ ฏ` drop `bottom` below the tail). Users can override any anchor explicitly.
3. **OpenType Feature Generation (`thai_opentype.py`)**:
   - `GDEF`: Classifies base glyphs (class 1) and Thai combining marks (class 3) so HarfBuzz/CoreText/DirectWrite fire mark lookups reliably.
   - `GSUB ccmp`: Canonical decomposition of `SARA AM` (`U+0E33` → `U+0E4D` + `U+0E32`) so words like `น้ำ` stack tone marks cleanly above `ํ`.
   - `GPOS mark` & `mkmk`: Mark-to-base attachment and mark-to-mark vertical stacking for tone marks above upper vowels (`กั่`, `กิ้`, `ที่`, `ขึ้น`).
4. **Validation-Gated Export**: `/api/v1/compile/ttf` refuses to emit a `.ttf` if SFNT tables, glyph order, outlines, combining-mark zero-widths, metrics, or name records fail validation.

## Deployment

### Backend (Fly.io / Railway / Cloud Run / Docker)
```bash
cd backend
docker build -t phfs-backend .
docker run -p 8000:8000 -e CORS_ORIGINS=https://your-studio-domain.com phfs-backend
```

### Frontend (Vercel / Netlify / Cloudflare Pages)
1. Set root directory to `frontend/`.
2. Configure environment variables: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Build command: `npm run build`, Output directory: `dist`.
