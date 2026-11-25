/**
 * Unified HandLine / Personal Handwriting Font Studio Data Model
 * Single canonical schema shared across React UI, IndexedDB, Variation Engine,
 * FastAPI Compiler REST API, and Supabase cloud sync.
 */

export type Language = 'th' | 'en';
export type NavTab = 'dashboard' | 'my-fonts' | 'studio' | 'preview' | 'export' | 'settings';
export type InputMode = 'pencil_only' | 'finger_drawing';

export type CharCategory =
  | 'thai_consonants'
  | 'thai_vowels'
  | 'thai_tones'
  | 'thai_digits'
  | 'latin_upper'
  | 'latin_lower'
  | 'digits_punct';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  timestamp?: number;
}

export interface Stroke {
  id: string;
  width: number;
  points: StrokePoint[];
}

export interface GlyphInstance {
  id: string;
  strokes: Stroke[];
  canvasWidth: number;
  canvasHeight: number;
  advanceWidth?: number;
  lsb?: number;
  rsb?: number;
  anchors?: Record<string, [number, number]>;
  createdAt: string;
  metadata?: {
    source?: 'drawn' | 'migrated' | 'sample';
    note?: string;
  };
}

export interface GlyphRecord {
  unicode: number;
  character: string;
  category: CharCategory;
  instances: GlyphInstance[];
  activeInstanceIdx: number;
  updatedAt: string;
}

export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  capHeight: number;
  xHeight: number;
  baseline: number;
  descender: number;
  lineGap: number;
}

export interface GuideRatios {
  ascender: number;
  capHeight: number;
  xHeight: number;
  baseline: number;
  descender: number;
}

export interface ScriptVariationConfig {
  intensity: number; // 0..100
  sizeVariation: number; // 0..50 (%)
  slantAngle: number; // -25..+25 (deg)
  charSpacingVariation: number; // 0..50 (%)
  wordSpacingVariation: number; // 0..50 (%)
  baselineJitter: number; // 0..100
}

export interface VariationSettings {
  seed: number;
  thai: ScriptVariationConfig;
  english: ScriptVariationConfig;
}

export interface FontSet {
  id: string;
  name: string;
  script: 'thai+english' | 'thai' | 'english';
  familyName: string;
  styleName: string;
  fullName: string;
  postscriptName: string;
  designer: string;
  copyrightText: string;
  version: string;
  slantAngle: number; // -25..+25 geometric slant (independent of Italic styleName)
  metrics: FontMetrics;
  glyphs: Record<number, GlyphRecord>;
  createdAt: string;
  updatedAt: string;
}

export interface StudioMeta {
  key: 'studio_meta';
  activeFontSetId: string;
  variation: VariationSettings;
  inputMode: InputMode;
  guides: GuideRatios;
  lang: Language;
  cellScale: number;
  strokeWidth: number;
  pressureSensitive: boolean;
  showCenterGuide: boolean;
  showGhostChar: boolean;
  previewText: string;
  previewSize: number;
  previewLineHeight: number;
  previewSpacing: number;
}

export interface ValidationReport {
  passed: boolean;
  glyph_count: number;
  pipeline_used: string;
  tables_present: string[];
  has_gdef: boolean;
  has_thai_gpos: boolean;
  has_thai_gsub: boolean;
  gpos_features: string[];
  gsub_features: string[];
  harfbuzz_available: boolean;
  fontbakery_available: boolean;
  coverage: Record<string, unknown>;
  checks: { id: string; status: string; message: string }[];
  fea_preview: string;
}

// Backwards-compatible alias for Supabase helper imports
export type FontProject = FontSet;
