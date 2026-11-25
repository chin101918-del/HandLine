# Font Validation Report — SampleThaiHandwriting-Regular.ttf

- **File:** `SampleThaiHandwriting-Regular.ttf` (10,508 bytes)
- **Compiler Pipeline:** `fontTools.FontBuilder+feaLib`
- **Overall Validation Status:** `PASSED`
- **Glyph Count:** `64` (including `.notdef` and `space`)
- **SFNT Tables Present:** `GDEF, GPOS, GSUB, GlyphOrder, OS/2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post`
- **OpenType GDEF:** `True`
- **OpenType GPOS Features:** `mark, mkmk`
- **OpenType GSUB Features:** `calt, ccmp, salt`
- **Character Coverage (vs Full 164-char Thai+English Target):** `57/177` (`32.2%`)

## Automated Validation Checks

| Check ID | Status | Details |
| :--- | :--- | :--- |
| `sfnt.required_tables` | **PASS** | All 10 required TrueType SFNT tables are present. |
| `glyph_order.notdef_first` | **PASS** | Glyph order valid (64 glyphs, .notdef at GID 0). |
| `glyf.outlines` | **PASS** | Verified 62 TrueType glyphs with closed vector contours. |
| `cmap.unicode_coverage` | **PASS** | Unicode cmap maps 58 codepoints (57/177 target Thai+English set = 32.2%). |
| `metrics.thai_combining_zero_width` | **PASS** | All Thai combining marks have zero advance width (0 UPM). |
| `metrics.vertical_consistency` | **PASS** | UPM=1000, Ascender=880, Descender=-260, LineGap=90. |
| `metadata.name_table` | **PASS** | Name table complete (Family='SampleThaiHandwriting', PS='SampleThaiHandwriting-Regular'). |
| `opentype.gdef_glyph_classes` | **PASS** | GDEF GlyphClassDef table present (Base & Mark classes). |
| `opentype.thai_gpos` | **PASS** | GPOS features present: mark, mkmk. |
| `opentype.thai_gsub` | **PASS** | GSUB features present: calt, ccmp, salt. |
| `harfbuzz.thai_shaping` | **SKIP** | uharfbuzz is not installed in this Python runtime; install requirements.txt to run live HarfBuzz shaping. |

## OS-Level Fontconfig (`fc-query`) Verification

```text
SampleThaiHandwriting | Regular | lang= | glyphs=20-21 30-32 36 41 48 65 6c 6f e01-e02 e04 e07-e08 e0a e14-e15 e17 e19-e1f e21-e23 e25 e27 e2a-e2b e2d-e2e e30-e39 e40-e44 e47-e4d
```

## Remaining Environment Limitations (Honest Disclosure)

- **HarfBuzz (`uharfbuzz`) & FontBakery (`fontbakery`) & `ufoLib2`/`ufo2ft`**: These Python packages are declared in `backend/requirements.txt` and wired into `backend/font_compiler/`, but are not pre-installed in this offline sandbox VM (where outbound `pip install` is disabled). Installing `backend/requirements.txt` on a connected machine activates `ufoLib2` + `ufo2ft` UFO compilation and live `uharfbuzz` shaping tests automatically.
- **macOS Font Book & HandLine Installation**: Because this sandbox runs Linux, macOS Font Book installation and HandLine Font Manager import could not be executed directly here; however, `OS/2` Thai Unicode/CodePage ranges, `name` IDs 1–6, `GDEF`, `GPOS` (`mark`/`mkmk`), `GSUB` (`ccmp`), and Fontconfig (`fc-query`) all passed structural verification.
- **Supabase Cloud Credentials**: No fabricated credentials are included; configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and run `supabase/migrations/001_initial_schema.sql` in your Supabase project to activate live cloud auth, autosave, and private font storage.
