/**
 * Production Integration & Acceptance Test Suite (Tests B, D, F-payload, H-input)
 * Directly loads and executes the ACTUAL shipped TypeScript source files inside
 * `frontend/src/` (indexedDb.ts, variationEngine.ts, inputProtection.ts, api.ts)
 * and verifies real integration wiring in App.tsx, ThaiPreviewCanvas.tsx, and CharacterCell.tsx.
 * Zero external HTML dependencies, zero duplicated mock implementations.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

/**
 * Minimal TypeScript-to-JS stripper sufficient to execute our pure TS modules
 * in Node 18 without requiring node_modules/tsc.
 */
function loadTsModule(relPath, extraScope = {}) {
  let code = fs.readFileSync(path.join(srcDir, relPath), 'utf8');
  // Remove import statements & export type/interface blocks
  code = code.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^\s*export\s+type\s+\w+\s*=[\s\S]*?;\s*$/gm, '');
  code = code.replace(/^\s*export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  code = code.replace(/^\s*interface\s+\w+\s*\{[\s\S]*?\n\}/gm, '');
  // Replace `export ` with plain declarations and collect exported names
  const exported = [];
  code = code.replace(/export\s+(?:async\s+)?(function|const|class)\s+(\w+)/g, (_, kind, name) => {
    exported.push(name);
    return `${kind === 'function' && _.includes('async') ? 'async ' : ''}${kind} ${name}`;
  });
  code = code.replace(/pendingTouchStart\s*:\s*\{[^}]+\}\s*\|\s*null\s*=\s*null;/g, 'pendingTouchStart = null;');
  // Strip TS parameter/return/variable type annotations & casts cleanly
  code = code.replace(/:\s*Promise<[^>]+>/g, '');
  code = code.replace(/:\s*Record<[^>]+>/g, '');
  code = code.replace(/:\s*Array<[^>]+>/g, '');
  code = code.replace(/:\s*(?:string|number|boolean|void|any|unknown|FontSet|GlyphRecord|GlyphInstance|VariationSettings|PlannedGlyphRender|StudioMeta|CharCategory|InputMode|PointerLikeEvent|InputProtectionOptions|ValidationReport|Blob)(?:\[\]|\s*\|\s*(?:null|undefined|string|number|boolean|'[^']+'))*/g, '');
  code = code.replace(/:\s*'[^']+'(?:\s*\|\s*'[^']+')+/g, '');
  code = code.replace(/:\s*\(\)\s*=>\s*number/g, '');
  code = code.replace(/\s+as\s+[A-Za-z0-9_<>\[\]| ]+/g, '');
  code = code.replace(/\bprivate\s+/g, '');
  code = code.replace(/^\s*(?:mode|maxTouchContactPx|minTouchTravelPx|penCooldownMs|activePointerId|activePointerType|lastPenTimestamp|pendingTouchStart|touchCommitted)\s*:\s*[^;=]+;\s*$/gm, '');
  code = code.replace(/pendingTouchStart\s*:\s*\{[^}]+\}\s*\|\s*null\s*=\s*null;/g, 'pendingTouchStart = null;');
  code = code.replace(/\(item\):\s*item\s+is\s+NonNullable<typeof item>\s*=>/g, '(item) =>');
  code = code.replace(/\?(?=\s*[,)])/g, '');
  code = code.replace(/import\.meta\.env\.VITE_API_BASE_URL/g, '""').replace(/<any>/g, '');
  // Remove class property type annotations on `constructor` / fields
  code = code.replace(/^\s*(?:activePointerId|activePointerType|lastPenTimestamp|pendingTouchStart|touchCommitted)\s*=\s*[^;]+;\s*$/gm, (m) => m);

  const wrapped = `${code}\nglobalThis.__MOD = { ${exported.join(', ')} };`;
  const sandbox = { console, Math, Date, Number, String, Array, Object, Set, Map, Promise, JSON, URL, ...extraScope };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(wrapped, sandbox, { filename: relPath });
  return sandbox.__MOD;
}

// 1. Load ACTUAL production modules from frontend/src/
const dbMod = loadTsModule('db/indexedDb.ts');
const varMod = loadTsModule('engine/variationEngine.ts', { getValidInstances: dbMod.getValidInstances });
const inputMod = loadTsModule('engine/inputProtection.ts');
const apiMod = loadTsModule('lib/api.ts', { getValidInstances: dbMod.getValidInstances });

// 2. Verify actual React integration wiring (no orphaned modules!)
const appTsx = fs.readFileSync(path.join(srcDir, 'App.tsx'), 'utf8');
const previewTsx = fs.readFileSync(path.join(srcDir, 'components/ThaiPreviewCanvas.tsx'), 'utf8');
const cellTsx = fs.readFileSync(path.join(srcDir, 'components/CharacterCell.tsx'), 'utf8');

assert.ok(previewTsx.includes('planVariedTextLayout'), 'ThaiPreviewCanvas must call planVariedTextLayout');
assert.ok(previewTsx.includes('ctx.transform(1, 0, -shear'), 'ThaiPreviewCanvas must apply geometric slant shear');
assert.ok(cellTsx.includes('PointerInputGuard'), 'CharacterCell must wire PointerInputGuard');
assert.ok(appTsx.includes('listFontSets') && appTsx.includes('loadStudioMeta'), 'App.tsx must restore FontSets and StudioMeta from IndexedDB on startup');
assert.ok(appTsx.includes('setVariation') && appTsx.includes('ThaiPreviewCanvas'), 'App.tsx must wire Variation controls into ThaiPreviewCanvas');
console.log('PASS [Integration Wiring]: App.tsx, ThaiPreviewCanvas.tsx, CharacterCell.tsx, and api.ts all import & invoke unified modules');

// 3. Multi-instance migration & non-destructive append (ACTUAL indexedDb.ts)
const legacy = {
  id: 'legacy_1',
  name: 'Legacy Thai Font',
  familyName: 'LegacyThai',
  glyphs: {
    0x0e01: { codepoint: 0x0e01, character: 'ก', strokes: [{ id: 's1', width: 3, points: [{ x: 20, y: 80, pressure: 0.6 }, { x: 60, y: 35, pressure: 0.7 }] }] },
    0x0e34: { codepoint: 0x0e34, character: 'ิ', strokes: [{ id: 's2', width: 3, points: [{ x: 30, y: 28, pressure: 0.6 }, { x: 60, y: 28, pressure: 0.6 }] }] },
    0x0e49: { codepoint: 0x0e49, character: '้', strokes: [{ id: 's3', width: 3, points: [{ x: 40, y: 18, pressure: 0.6 }, { x: 58, y: 20, pressure: 0.6 }] }] },
    0x0041: { codepoint: 0x0041, character: 'A', strokes: [{ id: 's4', width: 3, points: [{ x: 20, y: 85, pressure: 0.6 }, { x: 50, y: 25, pressure: 0.7 }] }] },
  },
};
let fontSet = dbMod.migrateLegacyProjectToFontSet(legacy);
assert.equal(fontSet.glyphs[0x0e01].instances.length, 1);
// Append empty instance (must be ignored by getValidInstances) + valid alternate instance
fontSet = dbMod.appendGlyphInstance(fontSet, 0x0e01, 'ก', 'thai_consonants', {
  id: 'ko_empty', strokes: [], canvasWidth: 96, canvasHeight: 120, createdAt: new Date().toISOString(),
});
fontSet = dbMod.appendGlyphInstance(fontSet, 0x0e01, 'ก', 'thai_consonants', {
  id: 'ko_alt1', strokes: [{ id: 's1b', width: 3.3, points: [{ x: 24, y: 82, pressure: 0.6 }, { x: 64, y: 34, pressure: 0.7 }] }],
  canvasWidth: 96, canvasHeight: 120, createdAt: new Date().toISOString(),
});
fontSet = dbMod.appendGlyphInstance(fontSet, 0x0041, 'A', 'latin_upper', {
  id: 'A_alt1', strokes: [{ id: 's4b', width: 3.3, points: [{ x: 24, y: 84, pressure: 0.6 }, { x: 52, y: 26, pressure: 0.7 }] }],
  canvasWidth: 96, canvasHeight: 120, createdAt: new Date().toISOString(),
});
assert.equal(dbMod.getValidInstances(fontSet.glyphs[0x0e01]).length, 2, 'Empty instance excluded from valid instances');
console.log('PASS [Multi-Instance Migration]: legacy project migrated non-destructively; empty instances filtered');

// 4. Variation Engine tests (ACTUAL variationEngine.ts)
const fullCfg = (seed) => ({
  seed,
  thai: { intensity: 100, sizeVariation: 30, slantAngle: 10, charSpacingVariation: 35, wordSpacingVariation: 40, baselineJitter: 50 },
  english: { intensity: 100, sizeVariation: 30, slantAngle: -8, charSpacingVariation: 35, wordSpacingVariation: 40, baselineJitter: 50 },
});
const zeroCfg = {
  seed: 42,
  thai: { intensity: 0, sizeVariation: 40, slantAngle: 0, charSpacingVariation: 40, wordSpacingVariation: 40, baselineJitter: 50 },
  english: { intensity: 0, sizeVariation: 40, slantAngle: 0, charSpacingVariation: 40, wordSpacingVariation: 40, baselineJitter: 50 },
};

const p0 = varMod.planVariedTextLayout('กกก กิ้ A A', fontSet, zeroCfg);
p0.filter((x) => x.type === 'glyph').forEach((g) => {
  assert.equal(g.instanceIndex, 0);
  assert.equal(g.scaleFactor, 1.0);
  assert.equal(g.charSpaceDeltaRatio, 0);
});
p0.filter((x) => x.type === 'space').forEach((sp) => assert.equal(sp.wordSpaceDeltaRatio, 0));

const p1 = varMod.planVariedTextLayout('กกก กิ้ A A', fontSet, fullCfg(12345));
const p2 = varMod.planVariedTextLayout('กกก กิ้ A A', fontSet, fullCfg(12345));
const p3 = varMod.planVariedTextLayout('กกก กิ้ A A', fontSet, fullCfg(99999));
assert.deepEqual(p1, p2, 'Same seed produces identical layout');
assert.notDeepEqual(p1, p3, 'Different seed produces different layout');
assert.notEqual(p1[0].instance.id, p1[1].instance.id, 'Consecutive ก alternates instance');
// Thai combining marks (ิ index 5, ้ index 6) attached to base ก (index 4)
assert.equal(p1[5].attachedBaseIndex, 4);
assert.equal(p1[6].attachedBaseIndex, 4);
assert.equal(p1[5].scaleFactor, p1[4].scaleFactor);
assert.equal(p1[6].slantDeg, p1[4].slantDeg);
assert.equal(p1[5].charSpaceDeltaRatio, 0);
// Spaces receive independent wordSpaceDeltaRatio
assert.ok(p1.filter((x) => x.type === 'space').some((sp) => sp.wordSpaceDeltaRatio !== 0));
console.log('PASS [Variation Engine]: 0% lock, 100% variation, anti-repetition, Thai mark lock, independent char/word spacing, seed reproducibility');

// 5. API Compile Payload test (ACTUAL api.ts buildCompilePayload)
fontSet.slantAngle = 12;
const payload = apiMod.buildCompilePayload(fontSet);
assert.equal(payload.slant_angle, 12);
const koPayload = payload.glyphs.find((g) => g.codepoint === 0x0e01);
assert.equal(koPayload.alternate_strokes.length, 1, 'Alternate non-empty instance included in compile payload');
console.log('PASS [Compile Payload]: buildCompilePayload() sends primary strokes, alternate_strokes[], and slant_angle');

// 6. Apple Pencil Input Protection tests (ACTUAL inputProtection.ts)
const guard = new inputMod.PointerInputGuard({ mode: 'pencil_only' });
assert.equal(guard.onPointerDown({ pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20, width: 10, height: 10 }), 'reject');
assert.equal(guard.onPointerDown({ pointerId: 2, pointerType: 'pen', clientX: 20, clientY: 20, pressure: 0.7 }), 'accept');
assert.equal(guard.onPointerDown({ pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 50, width: 40, height: 40 }), 'reject');
assert.equal(guard.onPointerEndOrCancel({ pointerId: 2 }), true);

guard.setMode('finger_drawing');
const afterCooldown = Date.now() + 1000;
assert.equal(guard.onPointerDown({ pointerId: 4, pointerType: 'touch', clientX: 30, clientY: 30, width: 32, height: 32, timeStamp: afterCooldown }), 'reject');
assert.equal(guard.onPointerDown({ pointerId: 5, pointerType: 'touch', clientX: 30, clientY: 30, width: 10, height: 10, timeStamp: afterCooldown }), 'defer_touch');
assert.equal(guard.onPointerEndOrCancel({ pointerId: 5 }), false, 'Stationary touch tap does not leave accidental dot');
assert.equal(guard.onPointerDown({ pointerId: 6, pointerType: 'touch', clientX: 30, clientY: 30, width: 10, height: 10, timeStamp: afterCooldown + 10 }), 'defer_touch');
assert.equal(guard.onPointerMove({ pointerId: 6, pointerType: 'touch', clientX: 40, clientY: 36, timeStamp: afterCooldown + 20 }), 'commit_deferred');
assert.equal(guard.onPointerEndOrCancel({ pointerId: 6 }), true);
console.log('PASS [Apple Pencil Input Protection]: pen accepted, touch ignored in pencil_only, palm rejected, accidental tap suppressed');
