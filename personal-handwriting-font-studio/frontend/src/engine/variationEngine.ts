/**
 * HandLine Handwriting Variation Engine
 * Constrained, deterministic (Mulberry32-seeded) rendering layout planner.
 * Drives ThaiPreviewCanvas directly with:
 * - Multi-instance glyph selection ignoring empty instances & avoiding consecutive repeats
 * - 0% intensity lock (primary instance, zero random size/slant/spacing/jitter)
 * - Per-glyph size variation, geometric slant (-25..+25 deg), safe baseline jitter
 * - Independent character spacing (between clusters) and word spacing (spaces only)
 * - Thai combining-mark preservation (marks inherit base scale, slant, and baseline)
 */

import { FontSet, GlyphInstance, VariationSettings } from '../types/font';
import { getValidInstances } from '../db/indexedDb';

export const DEFAULT_VARIATION_SETTINGS: VariationSettings = {
  seed: 20261125,
  thai: {
    intensity: 45,
    sizeVariation: 12,
    slantAngle: 0,
    charSpacingVariation: 14,
    wordSpacingVariation: 16,
    baselineJitter: 35,
  },
  english: {
    intensity: 45,
    sizeVariation: 14,
    slantAngle: 0,
    charSpacingVariation: 16,
    wordSpacingVariation: 18,
    baselineJitter: 35,
  },
};

export const THAI_ABOVE_VOWELS = new Set([0x0e31, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e47, 0x0e4d]);
export const THAI_TONE_MARKS = new Set([0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e4c, 0x0e4e]);
export const THAI_BELOW_MARKS = new Set([0x0e38, 0x0e39, 0x0e3a]);
export const THAI_COMBINING_CODEPOINTS = new Set([
  ...THAI_ABOVE_VOWELS,
  ...THAI_TONE_MARKS,
  ...THAI_BELOW_MARKS,
]);

export function createSeededRng(seed: number): () => number {
  let a = (Number(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlannedGlyphRender {
  index: number;
  type: 'glyph' | 'space' | 'newline';
  char: string;
  codepoint: number;
  script: 'thai' | 'english';
  isCombining: boolean;
  instanceIndex: number;
  instance: GlyphInstance | null;
  scaleFactor: number;
  slantDeg: number;
  baselineOffsetRatio: number;
  charSpaceDeltaRatio: number; // fraction of fontSize
  wordSpaceDeltaRatio: number; // fraction of base space width (spaces only)
  attachedBaseIndex: number | null;
}

export function planVariedTextLayout(
  text: string,
  fontSet: FontSet,
  settings: VariationSettings
): PlannedGlyphRender[] {
  const rng = createSeededRng(settings.seed);
  const lastChosenInstance: Record<number, number> = {};
  const chars = Array.from(text);
  const plan: PlannedGlyphRender[] = [];

  let activeBasePlan: PlannedGlyphRender | null = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') {
      plan.push({
        index: i,
        type: 'newline',
        char: '\n',
        codepoint: 10,
        script: 'english',
        isCombining: false,
        instanceIndex: 0,
        instance: null,
        scaleFactor: 1,
        slantDeg: 0,
        baselineOffsetRatio: 0,
        charSpaceDeltaRatio: 0,
        wordSpaceDeltaRatio: 0,
        attachedBaseIndex: null,
      });
      activeBasePlan = null;
      continue;
    }

    const cp = ch.codePointAt(0) || 32;
    const isThai = cp >= 0x0e00 && cp <= 0x0e7f;
    const script: 'thai' | 'english' = isThai ? 'thai' : 'english';

    if (ch === ' ') {
      // Word spacing applies ONLY to actual whitespace characters (independent of charSpacing)
      const wsCfg = activeBasePlan && activeBasePlan.script === 'thai' ? settings.thai : settings.english;
      const wsInt = Math.max(0, Math.min(100, wsCfg.intensity)) / 100;
      const wsPct = Math.max(0, Math.min(50, wsCfg.wordSpacingVariation)) / 100;
      const wordSpaceDeltaRatio = wsInt === 0 ? 0 : Number(((rng() * 2 - 1) * wsPct * wsInt).toFixed(4));
      plan.push({
        index: i,
        type: 'space',
        char: ' ',
        codepoint: 32,
        script: activeBasePlan ? activeBasePlan.script : 'english',
        isCombining: false,
        instanceIndex: 0,
        instance: null,
        scaleFactor: 1,
        slantDeg: 0,
        baselineOffsetRatio: 0,
        charSpaceDeltaRatio: 0,
        wordSpaceDeltaRatio,
        attachedBaseIndex: null,
      });
      activeBasePlan = null;
      continue;
    }

    const cfg = isThai ? settings.thai : settings.english;
    const intensity = Math.max(0, Math.min(100, cfg.intensity)) / 100;
    const isCombining = THAI_COMBINING_CODEPOINTS.has(cp);
    const validInsts = getValidInstances(fontSet.glyphs[cp]);

    // Real Glyph Instance Selection (empty instances excluded; primary at 0%; avoids consecutive repeat when >=2)
    let chosenIdx = 0;
    if (validInsts.length > 1 && intensity > 0) {
      const prev = lastChosenInstance[cp];
      const shouldVary = intensity >= 0.99 || rng() < intensity;
      if (shouldVary) {
        const candidates: number[] = [];
        for (let k = 0; k < validInsts.length; k++) {
          if (k !== prev) candidates.push(k);
        }
        chosenIdx = candidates[Math.floor(rng() * candidates.length)];
      }
    }
    lastChosenInstance[cp] = chosenIdx;
    const selectedInst = validInsts.length > 0 ? validInsts[chosenIdx] : null;

    if (isCombining && activeBasePlan) {
      // Thai combining mark inherits base scale, slant, and vertical offset — never detaches or gets spacing
      plan.push({
        index: i,
        type: 'glyph',
        char: ch,
        codepoint: cp,
        script,
        isCombining: true,
        instanceIndex: chosenIdx,
        instance: selectedInst,
        scaleFactor: activeBasePlan.scaleFactor,
        slantDeg: activeBasePlan.slantDeg,
        baselineOffsetRatio: activeBasePlan.baselineOffsetRatio,
        charSpaceDeltaRatio: 0,
        wordSpaceDeltaRatio: 0,
        attachedBaseIndex: activeBasePlan.index,
      });
      continue;
    }

    const sizePct = Math.max(0, Math.min(50, cfg.sizeVariation)) / 100;
    const scaleFactor =
      intensity === 0
        ? 1.0
        : Number(Math.max(0.65, Math.min(1.45, 1 + (rng() * 2 - 1) * sizePct * intensity)).toFixed(4));

    const baseSlant = Math.max(-25, Math.min(25, cfg.slantAngle));
    const slantJitter = intensity === 0 ? 0 : (rng() * 2 - 1) * 3.5 * intensity;
    const slantDeg = Number(Math.max(-25, Math.min(25, baseSlant + slantJitter)).toFixed(2));

    const maxBaseJitter = (Math.min(100, Math.max(0, cfg.baselineJitter)) / 100) * 0.032 * intensity;
    const baselineOffsetRatio = intensity === 0 ? 0 : Number(((rng() * 2 - 1) * maxBaseJitter).toFixed(4));

    const charSpacePct = Math.max(0, Math.min(50, cfg.charSpacingVariation)) / 100;
    const charSpaceDeltaRatio =
      intensity === 0 ? 0 : Number(((rng() * 2 - 1) * charSpacePct * 0.28 * intensity).toFixed(4));

    const entry: PlannedGlyphRender = {
      index: i,
      type: 'glyph',
      char: ch,
      codepoint: cp,
      script,
      isCombining: false,
      instanceIndex: chosenIdx,
      instance: selectedInst,
      scaleFactor,
      slantDeg,
      baselineOffsetRatio,
      charSpaceDeltaRatio,
      wordSpaceDeltaRatio: 0,
      attachedBaseIndex: null,
    };
    plan.push(entry);
    activeBasePlan = entry;
  }

  return plan;
}
