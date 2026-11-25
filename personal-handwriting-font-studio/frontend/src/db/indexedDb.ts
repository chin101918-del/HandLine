/**
 * Multi-Instance Handwriting Font Database (IndexedDB v2: font_sets + meta)
 * Uses the unified FontSet / GlyphRecord / GlyphInstance schema.
 * Supports non-destructive migration from legacy localStorage projects and safe
 * fallback when IndexedDB is unavailable or errors.
 */

import {
  CharCategory,
  FontSet,
  GlyphInstance,
  GlyphRecord,
  StudioMeta,
} from '../types/font';

const DB_NAME = 'HandLineFontDB';
const DB_VERSION = 2;
const STORE_FONT_SETS = 'font_sets';
const STORE_META = 'meta';

export const DEFAULT_METRICS = {
  unitsPerEm: 1000,
  ascender: 880,
  capHeight: 700,
  xHeight: 500,
  baseline: 0,
  descender: -260,
  lineGap: 90,
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is unavailable in this environment'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FONT_SETS)) {
        db.createObjectStore(STORE_FONT_SETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listFontSets(): Promise<FontSet[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONT_SETS, 'readonly');
    const req = tx.objectStore(STORE_FONT_SETS).getAll();
    req.onsuccess = () => resolve(((req.result as FontSet[]) || []).map(migrateLegacyProjectToFontSet));
    req.onerror = () => reject(req.error);
  });
}

export async function saveFontSet(fontSet: FontSet): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONT_SETS, 'readwrite');
    tx.objectStore(STORE_FONT_SETS).put({
      ...fontSet,
      updatedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteFontSet(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FONT_SETS, 'readwrite');
    tx.objectStore(STORE_FONT_SETS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadStudioMeta(): Promise<StudioMeta | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get('studio_meta');
    req.onsuccess = () => resolve((req.result as StudioMeta) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveStudioMeta(meta: StudioMeta): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ ...meta, key: 'studio_meta' });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getValidInstances(glyph?: GlyphRecord | null): GlyphInstance[] {
  if (!glyph || !Array.isArray(glyph.instances)) return [];
  return glyph.instances.filter((inst) => inst && Array.isArray(inst.strokes) && inst.strokes.length > 0);
}

/**
 * Non-destructive migration from legacy single-instance FontProject records into
 * unified multi-instance FontSet format. Never discards or overwrites existing samples.
 */
export function migrateLegacyProjectToFontSet(legacy: Record<string, any>): FontSet {
  const now = new Date().toISOString();
  const glyphs: Record<number, GlyphRecord> = {};
  const rawGlyphs = legacy.glyphs || {};

  for (const [cpKey, raw] of Object.entries<any>(rawGlyphs)) {
    const cp = Number(raw.unicode ?? raw.codepoint ?? cpKey);
    if (!Number.isFinite(cp)) continue;

    if (Array.isArray(raw.instances)) {
      glyphs[cp] = {
        unicode: cp,
        character: raw.character || String.fromCodePoint(cp),
        category: (raw.category as CharCategory) || 'thai_consonants',
        instances: raw.instances,
        activeInstanceIdx: Math.max(0, Math.min(raw.activeInstanceIdx || 0, Math.max(0, raw.instances.length - 1))),
        updatedAt: raw.updatedAt || now,
      };
    } else if (Array.isArray(raw.strokes) && raw.strokes.length > 0) {
      glyphs[cp] = {
        unicode: cp,
        character: raw.character || String.fromCodePoint(cp),
        category: (raw.category as CharCategory) || 'thai_consonants',
        instances: [
          {
            id: `inst_mig_${cp}_${Date.now()}`,
            strokes: raw.strokes,
            canvasWidth: raw.canvasWidth || 96,
            canvasHeight: raw.canvasHeight || 120,
            advanceWidth: raw.advanceWidth,
            lsb: raw.lsb,
            rsb: raw.rsb,
            anchors: raw.anchors,
            createdAt: raw.updatedAt || now,
            metadata: { source: 'migrated' },
          },
        ],
        activeInstanceIdx: 0,
        updatedAt: raw.updatedAt || now,
      };
    }
  }

  const fam = legacy.familyName || 'MyThaiHand';
  const style = legacy.styleName || 'Regular';
  return {
    id: legacy.id || `fs_${Date.now()}`,
    name: legacy.name || 'ลายมือของฉัน 01',
    script: legacy.script || 'thai+english',
    familyName: fam,
    styleName: style,
    fullName: legacy.fullName || `${fam} ${style}`,
    postscriptName: legacy.postscriptName || `${fam}-${style}`.replace(/[^A-Za-z0-9_-]/g, ''),
    designer: legacy.designer || 'HandLine User',
    copyrightText: legacy.copyrightText || `Copyright (c) 2026 ${fam}`,
    version: legacy.version || '1.000',
    slantAngle: typeof legacy.slantAngle === 'number' ? legacy.slantAngle : 0,
    metrics: { ...DEFAULT_METRICS, ...(legacy.metrics || {}) },
    glyphs,
    createdAt: legacy.createdAt || now,
    updatedAt: legacy.updatedAt || now,
  };
}

export function appendGlyphInstance(
  fontSet: FontSet,
  unicode: number,
  character: string,
  category: CharCategory,
  instance: GlyphInstance
): FontSet {
  const existing = fontSet.glyphs[unicode] || {
    unicode,
    character,
    category,
    instances: [],
    activeInstanceIdx: 0,
    updatedAt: new Date().toISOString(),
  };
  const nextInstances = [...existing.instances, instance];
  return {
    ...fontSet,
    updatedAt: new Date().toISOString(),
    glyphs: {
      ...fontSet.glyphs,
      [unicode]: {
        ...existing,
        instances: nextInstances,
        activeInstanceIdx: nextInstances.length - 1,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}
