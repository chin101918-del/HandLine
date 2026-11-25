import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  FolderOpen,
  LayoutDashboard,
  PenTool,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { CATEGORY_LABELS, CHARACTER_SET } from './data/charset';
import { CharacterCell } from './components/CharacterCell';
import { ThaiPreviewCanvas } from './components/ThaiPreviewCanvas';
import { RealFontPreview } from './components/RealFontPreview';
import {
  appendGlyphInstance,
  DEFAULT_METRICS,
  deleteFontSet,
  getValidInstances,
  listFontSets,
  loadStudioMeta,
  migrateLegacyProjectToFontSet,
  saveFontSet,
  saveStudioMeta,
} from './db/indexedDb';
import { DEFAULT_VARIATION_SETTINGS } from './engine/variationEngine';
import { compileAndDownloadTTF, validateFontProject } from './lib/api';
import {
  CharCategory,
  FontSet,
  GuideRatios,
  InputMode,
  Language,
  NavTab,
  Stroke,
  ValidationReport,
  VariationSettings,
} from './types/font';

const STORAGE_KEY = 'phfs_projects_v1';

const DEFAULT_GUIDES: GuideRatios = {
  ascender: 0.14,
  capHeight: 0.28,
  xHeight: 0.44,
  baseline: 0.74,
  descender: 0.92,
};

function createEmptyFontSet(name: string, familyName: string): FontSet {
  const now = new Date().toISOString();
  return {
    id: `fs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    script: 'thai+english',
    familyName,
    styleName: 'Regular',
    fullName: `${familyName} Regular`,
    postscriptName: `${familyName}-Regular`,
    designer: '',
    copyrightText: `Copyright (c) 2026 ${familyName}`,
    version: '1.000',
    slantAngle: 0,
    metrics: { ...DEFAULT_METRICS },
    glyphs: {},
    createdAt: now,
    updatedAt: now,
  };
}

export default function App() {
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [lang, setLang] = useState<Language>('th');
  const [tab, setTab] = useState<NavTab>('studio');
  const [fontSets, setFontSets] = useState<FontSet[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [category, setCategory] = useState<CharCategory>('thai_consonants');
  const [selectedCp, setSelectedCp] = useState<number>(0x0e01);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [inputMode, setInputMode] = useState<InputMode>('finger_drawing');
  const [strokeWidth, setStrokeWidth] = useState<number>(3.2);
  const [pressureSensitive, setPressureSensitive] = useState<boolean>(true);
  const [cellScale, setCellScale] = useState<number>(96);
  const [showCenterGuide, setShowCenterGuide] = useState<boolean>(true);
  const [showGhostChar, setShowGhostChar] = useState<boolean>(true);
  const [guides, setGuides] = useState<GuideRatios>(DEFAULT_GUIDES);
  const [undoMap, setUndoMap] = useState<Record<number, Stroke[][]>>({});

  // Variation Engine State (separate Thai & English profiles + reproducible seed)
  const [variation, setVariation] = useState<VariationSettings>(DEFAULT_VARIATION_SETTINGS);
  const [varScriptTab, setVarScriptTab] = useState<'thai' | 'english'>('thai');
  const [previewMode, setPreviewMode] = useState<'variation' | 'compiled_ttf'>('variation');
  const [previewText, setPreviewText] = useState<string>(
    'กิ กี กุ กู ก่ ก้ กั่ กิ้ เก่ง น้ำ ผู้ ที่ ขึ้น สวัสดี\nThe quick brown fox jumps over 12345'
  );
  const [previewSize, setPreviewSize] = useState<number>(42);
  const [previewLineHeight, setPreviewLineHeight] = useState<number>(1.7);
  const [previewSpacing, setPreviewSpacing] = useState<number>(1);
  const [layoutStats, setLayoutStats] = useState({ totalGlyphs: 0, alternatesUsed: 0, minScale: 1, maxScale: 1 });

  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [exportStatus, setExportStatus] = useState<string>('');

  // Startup Restoration: load IndexedDB BEFORE rendering so an empty project never flashes
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      let restoredSets: FontSet[] = [];
      let restoredMeta = null;

      try {
        restoredSets = await listFontSets();
        restoredMeta = await loadStudioMeta();
      } catch {
        // IndexedDB unavailable -> fallback safely to localStorage without deleting data
      }

      // Non-destructive merge with any legacy localStorage projects
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as any[];
          const byId = new Map(restoredSets.map((f) => [f.id, f]));
          for (const item of parsed) {
            const migrated = migrateLegacyProjectToFontSet(item);
            if (!byId.has(migrated.id)) {
              byId.set(migrated.id, migrated);
              saveFontSet(migrated).catch(() => {});
            }
          }
          restoredSets = Array.from(byId.values());
        }
      } catch {
        // ignore localStorage read errors
      }

      if (restoredSets.length === 0) {
        const initial = createEmptyFontSet('ลายมือของฉัน 01', 'MyThaiHand');
        restoredSets = [initial];
        saveFontSet(initial).catch(() => {});
      }

      if (cancelled) return;
      setFontSets(restoredSets);
      const preferredId =
        restoredMeta?.activeFontSetId && restoredSets.some((f) => f.id === restoredMeta.activeFontSetId)
          ? restoredMeta.activeFontSetId
          : restoredSets[0].id;
      setActiveId(preferredId);

      if (restoredMeta) {
        if (restoredMeta.variation) setVariation(restoredMeta.variation);
        if (restoredMeta.inputMode) setInputMode(restoredMeta.inputMode);
        if (restoredMeta.guides) setGuides(restoredMeta.guides);
        if (restoredMeta.lang) setLang(restoredMeta.lang);
        if (restoredMeta.cellScale) setCellScale(restoredMeta.cellScale);
        if (restoredMeta.previewText) setPreviewText(restoredMeta.previewText);
        if (restoredMeta.previewSize) setPreviewSize(restoredMeta.previewSize);
      }
      setHydrated(true);
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSet = useMemo(
    () => fontSets.find((f) => f.id === activeId) || fontSets[0],
    [fontSets, activeId]
  );

  // Persist StudioMeta + localStorage backup whenever settings change
  useEffect(() => {
    if (!hydrated || !activeSet) return;
    saveStudioMeta({
      key: 'studio_meta',
      activeFontSetId: activeSet.id,
      variation,
      inputMode,
      guides,
      lang,
      cellScale,
      strokeWidth,
      pressureSensitive,
      showCenterGuide,
      showGhostChar,
      previewText,
      previewSize,
      previewLineHeight,
      previewSpacing,
    }).catch(() => {});
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fontSets));
    } catch {
      // ignore quota errors
    }
  }, [
    hydrated,
    fontSets,
    activeSet,
    variation,
    inputMode,
    guides,
    lang,
    cellScale,
    strokeWidth,
    pressureSensitive,
    showCenterGuide,
    showGhostChar,
    previewText,
    previewSize,
    previewLineHeight,
    previewSpacing,
  ]);

  const updateActiveSet = (updater: (f: FontSet) => FontSet) => {
    if (!activeSet) return;
    const updated = { ...updater(activeSet), updatedAt: new Date().toISOString() };
    setFontSets((prev) => prev.map((f) => (f.id === activeSet.id ? updated : f)));
    saveFontSet(updated).catch(() => {});
  };

  const handleGlyphStrokes = (cp: number, char: string, cat: CharCategory, nextStrokes: Stroke[]) => {
    if (!activeSet) return;
    const existing = activeSet.glyphs[cp];
    const currentIdx = existing ? existing.activeInstanceIdx : 0;
    const prevStrokes = existing?.instances[currentIdx]?.strokes || [];
    setUndoMap((prev) => ({
      ...prev,
      [cp]: [...(prev[cp] || []).slice(-19), prevStrokes],
    }));

    updateActiveSet((fs) => {
      const prevRec = fs.glyphs[cp];
      const instances = prevRec && prevRec.instances.length > 0
        ? [...prevRec.instances]
        : [
            {
              id: `inst_${cp}_${Date.now()}`,
              strokes: [],
              canvasWidth: cellScale,
              canvasHeight: Math.round(cellScale * 1.25),
              createdAt: new Date().toISOString(),
            },
          ];
      const idx = Math.min(prevRec?.activeInstanceIdx || 0, instances.length - 1);
      instances[idx] = {
        ...instances[idx],
        strokes: nextStrokes,
        canvasWidth: cellScale,
        canvasHeight: Math.round(cellScale * 1.25),
      };
      return {
        ...fs,
        glyphs: {
          ...fs.glyphs,
          [cp]: {
            unicode: cp,
            character: char,
            category: cat,
            instances,
            activeInstanceIdx: idx,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const handleAddInstance = (cp: number, char: string, cat: CharCategory) => {
    updateActiveSet((fs) =>
      appendGlyphInstance(fs, cp, char, cat, {
        id: `inst_${cp}_${Date.now()}`,
        strokes: [],
        canvasWidth: cellScale,
        canvasHeight: Math.round(cellScale * 1.25),
        createdAt: new Date().toISOString(),
        metadata: { source: 'drawn' },
      })
    );
  };

  const handleCycleInstance = (cp: number) => {
    updateActiveSet((fs) => {
      const rec = fs.glyphs[cp];
      if (!rec || rec.instances.length <= 1) return fs;
      return {
        ...fs,
        glyphs: {
          ...fs.glyphs,
          [cp]: {
            ...rec,
            activeInstanceIdx: (rec.activeInstanceIdx + 1) % rec.instances.length,
          },
        },
      };
    });
  };

  const handleUndo = (cp: number, char: string, cat: CharCategory) => {
    const stack = undoMap[cp] || [];
    if (stack.length === 0) return;
    const prevStrokes = stack[stack.length - 1];
    setUndoMap((prev) => ({ ...prev, [cp]: stack.slice(0, -1) }));
    handleGlyphStrokes(cp, char, cat, prevStrokes);
  };

  if (!hydrated || !activeSet) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F7] text-sm text-[#6E6E73]">
        Loading HandLine Font Database…
      </div>
    );
  }

  const completedCount = Object.values(activeSet.glyphs).filter((g) => getValidInstances(g).length > 0).length;
  const visibleChars = CHARACTER_SET.filter((c) => c.category === category);
  const activeVarCfg = variation[varScriptTab];

  const updateVarField = (key: keyof typeof activeVarCfg, val: number) => {
    setVariation((prev) => ({
      ...prev,
      [varScriptTab]: { ...prev[varScriptTab], [key]: val },
    }));
    if (key === 'slantAngle') {
      updateActiveSet((fs) => ({ ...fs, slantAngle: val }));
    }
  };

  const handleValidate = async () => {
    setExportStatus(lang === 'th' ? 'กำลังตรวจสอบโครงสร้าง OpenType...' : 'Validating OpenType tables...');
    try {
      const report = await validateFontProject(activeSet);
      setValidation(report);
      setExportStatus(report.passed ? 'Validation passed' : 'Validation issues found');
    } catch (err) {
      setExportStatus(String(err));
    }
  };

  const handleExportTTF = async () => {
    setExportStatus(lang === 'th' ? 'กำลังคอมไพล์ไฟล์ .TTF...' : 'Compiling .TTF file...');
    try {
      const blob = await compileAndDownloadTTF(activeSet);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeSet.familyName || 'HandwritingFont'}-${activeSet.styleName}.ttf`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus(lang === 'th' ? 'ดาวน์โหลดไฟล์ .TTF สำเร็จ' : 'Downloaded .TTF successfully');
    } catch (err) {
      setExportStatus(String(err));
    }
  };

  const navItems: { id: NavTab; labelTh: string; labelEn: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', labelTh: 'แดชบอร์ด', labelEn: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'my-fonts', labelTh: 'ฟอนต์ของฉัน', labelEn: 'My Fonts', icon: <FolderOpen className="w-4 h-4" /> },
    { id: 'studio', labelTh: 'สตูดิโอลายมือ', labelEn: 'Handwriting Studio', icon: <PenTool className="w-4 h-4" /> },
    { id: 'preview', labelTh: 'ตัวอย่างฟอนต์', labelEn: 'Font Preview', icon: <Eye className="w-4 h-4" /> },
    { id: 'export', labelTh: 'ส่งออก (.TTF)', labelEn: 'Export', icon: <Download className="w-4 h-4" /> },
    { id: 'settings', labelTh: 'ตั้งค่า', labelEn: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex bg-[#F5F5F7] text-[#1D1D1F]">
      <aside className="w-60 shrink-0 bg-white border-r border-[#E5E5EA] flex flex-col justify-between p-4">
        <div>
          <div className="px-2 py-3 mb-4">
            <h1 className="text-sm font-semibold tracking-tight">Personal Handwriting</h1>
            <p className="text-xs text-[#6E6E73]">HandLine Font Studio</p>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors ${
                  tab === item.id ? 'bg-[#1D1D1F] text-white font-medium' : 'text-[#424245] hover:bg-[#F2F2F7]'
                }`}
              >
                {item.icon}
                <span>{lang === 'th' ? item.labelTh : item.labelEn}</span>
              </button>
            ))}
          </nav>
        </div>
        <div className="pt-4 border-t border-[#E5E5EA] flex items-center justify-between px-2">
          <span className="text-xs text-[#6E6E73]">
            {completedCount}/{CHARACTER_SET.length}
          </span>
          <button
            onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
            className="text-xs px-2.5 py-1 rounded-lg border border-[#D2D2D7] hover:bg-[#F2F2F7]"
          >
            {lang === 'th' ? 'EN' : 'ไทย'}
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {tab === 'dashboard' && (
          <div className="max-w-4xl space-y-6">
            <h2 className="text-2xl font-semibold">{lang === 'th' ? 'ภาพรวมโปรเจกต์ฟอนต์' : 'Studio Dashboard'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5">
                <p className="text-xs text-[#6E6E73]">{lang === 'th' ? 'ชุดฟอนต์ปัจจุบัน' : 'Active Font Set'}</p>
                <p className="text-lg font-semibold mt-1">{activeSet.name}</p>
              </div>
              <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5">
                <p className="text-xs text-[#6E6E73]">{lang === 'th' ? 'อักขระที่เขียนแล้ว' : 'Completed Glyphs'}</p>
                <p className="text-lg font-semibold mt-1">
                  {completedCount} / {CHARACTER_SET.length}
                </p>
              </div>
              <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5">
                <p className="text-xs text-[#6E6E73]">IndexedDB</p>
                <p className="text-lg font-semibold mt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#1D1D1F]" />
                  {lang === 'th' ? 'บันทึกอัตโนมัติแล้ว' : 'Restored & Active'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setTab('studio')}
              className="px-4 py-2.5 rounded-xl bg-[#1D1D1F] text-white text-sm font-medium hover:bg-black"
            >
              {lang === 'th' ? 'เปิดสตูดิโอลายมือต่อ' : 'Continue in Handwriting Studio'}
            </button>
          </div>
        )}

        {tab === 'my-fonts' && (
          <div className="max-w-4xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">{lang === 'th' ? 'ฟอนต์ของฉัน (Font Sets)' : 'My Font Sets'}</h2>
              <button
                onClick={() => {
                  const idx = fontSets.length + 1;
                  const created = createEmptyFontSet(`ลายมือของฉัน 0${idx}`, `MyThaiHand${idx}`);
                  setFontSets((prev) => [created, ...prev]);
                  setActiveId(created.id);
                  saveFontSet(created).catch(() => {});
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1D1D1F] text-white text-sm"
              >
                <Plus className="w-4 h-4" />
                {lang === 'th' ? 'สร้างชุดฟอนต์ใหม่' : 'New Font Set'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fontSets.map((fs) => (
                <div
                  key={fs.id}
                  onClick={() => setActiveId(fs.id)}
                  className={`p-5 rounded-2xl bg-white border cursor-pointer transition-all ${
                    fs.id === activeSet.id ? 'border-[#1D1D1F]' : 'border-[#E5E5EA]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{fs.name}</h3>
                      <p className="text-xs text-[#6E6E73]">
                        {fs.familyName} · {fs.styleName} · Slant {fs.slantAngle}°
                      </p>
                    </div>
                    {fontSets.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFontSets((prev) => prev.filter((item) => item.id !== fs.id));
                          deleteFontSet(fs.id).catch(() => {});
                        }}
                        className="p-1.5 text-[#8E8E93] hover:text-[#D70015]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'studio' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-[#E5E5EA]">
              <div className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(CATEGORY_LABELS) as CharCategory[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                      category === cat ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7] text-[#424245] hover:bg-[#E5E5EA]'
                    }`}
                  >
                    {CATEGORY_LABELS[cat][lang]}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  onClick={() => setTool('pen')}
                  className={`px-2.5 py-1 rounded-lg border ${
                    tool === 'pen' ? 'bg-[#1D1D1F] text-white border-[#1D1D1F]' : 'border-[#D2D2D7]'
                  }`}
                >
                  {lang === 'th' ? 'ปากกา' : 'Pen'}
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`px-2.5 py-1 rounded-lg border ${
                    tool === 'eraser' ? 'bg-[#1D1D1F] text-white border-[#1D1D1F]' : 'border-[#D2D2D7]'
                  }`}
                >
                  {lang === 'th' ? 'ยางลบ' : 'Eraser'}
                </button>
                <button
                  onClick={() => setInputMode(inputMode === 'pencil_only' ? 'finger_drawing' : 'pencil_only')}
                  className={`px-2.5 py-1 rounded-lg border ${
                    inputMode === 'pencil_only' ? 'bg-[#1D1D1F] text-white border-[#1D1D1F]' : 'border-[#D2D2D7]'
                  }`}
                >
                  {inputMode === 'pencil_only' ? 'Apple Pencil Only' : 'Finger Drawing'}
                </button>
                <label className="flex items-center gap-1.5">
                  <span>{strokeWidth.toFixed(1)}px</span>
                  <input
                    type="range"
                    min="1.5"
                    max="7"
                    step="0.2"
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    className="w-20"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {visibleChars.map((spec) => {
                const rec = activeSet.glyphs[spec.codepoint];
                const activeIdx = rec ? rec.activeInstanceIdx : 0;
                const activeStrokes = rec?.instances[activeIdx]?.strokes || [];
                return (
                  <CharacterCell
                    key={spec.codepoint}
                    spec={spec}
                    strokes={activeStrokes}
                    instanceCount={rec?.instances.length || 1}
                    activeInstanceIdx={activeIdx}
                    isSelected={selectedCp === spec.codepoint}
                    cellWidth={cellScale}
                    cellHeight={Math.round(cellScale * 1.25)}
                    strokeWidth={strokeWidth}
                    pressureSensitive={pressureSensitive}
                    tool={tool}
                    inputMode={inputMode}
                    guides={guides}
                    showCenterGuide={showCenterGuide}
                    showGhostChar={showGhostChar}
                    onSelect={() => setSelectedCp(spec.codepoint)}
                    onChangeStrokes={(next) => handleGlyphStrokes(spec.codepoint, spec.char, spec.category, next)}
                    onAddInstance={() => handleAddInstance(spec.codepoint, spec.char, spec.category)}
                    onCycleInstance={() => handleCycleInstance(spec.codepoint)}
                    onUndo={() => handleUndo(spec.codepoint, spec.char, spec.category)}
                    canUndo={(undoMap[spec.codepoint]?.length || 0) > 0}
                  />
                );
              })}
            </div>
          </div>
        )}

        {tab === 'preview' && (
          <div className="max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold">
                {lang === 'th' ? 'ตัวอย่างฟอนต์ & Variation Engine' : 'Font Preview & Variation Engine'}
              </h2>
              <div className="inline-flex rounded-xl bg-white p-1 border border-[#E5E5EA] text-xs">
                <button
                  onClick={() => setPreviewMode('variation')}
                  className={`px-3 py-1.5 rounded-lg font-medium ${
                    previewMode === 'variation' ? 'bg-[#1D1D1F] text-white' : 'text-[#6E6E73]'
                  }`}
                >
                  Current Project (Variation)
                </button>
                <button
                  onClick={() => setPreviewMode('compiled_ttf')}
                  className={`px-3 py-1.5 rounded-lg font-medium ${
                    previewMode === 'compiled_ttf' ? 'bg-[#1D1D1F] text-white' : 'text-[#6E6E73]'
                  }`}
                >
                  Compiled .TTF Preview
                </button>
              </div>
            </div>

            <textarea
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-[#E5E5EA] bg-white p-4 text-sm focus:outline-none focus:border-[#1D1D1F]"
            />

            {/* Variation Controls Panel wired directly to ThaiPreviewCanvas */}
            <div className="bg-white rounded-2xl border border-[#E5E5EA] p-4 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Variation & Slant</span>
                  <button
                    onClick={() => setVarScriptTab('thai')}
                    className={`px-2.5 py-1 rounded-lg ${varScriptTab === 'thai' ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7]'}`}
                  >
                    ไทย (Thai)
                  </button>
                  <button
                    onClick={() => setVarScriptTab('english')}
                    className={`px-2.5 py-1 rounded-lg ${varScriptTab === 'english' ? 'bg-[#1D1D1F] text-white' : 'bg-[#F5F5F7]'}`}
                  >
                    English
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1">
                    <span>Seed:</span>
                    <input
                      type="number"
                      value={variation.seed}
                      onChange={(e) => setVariation((v) => ({ ...v, seed: Number(e.target.value) || 1 }))}
                      className="w-24 px-2 py-1 rounded-lg border border-[#D2D2D7] font-mono"
                    />
                  </label>
                  <button
                    onClick={() => setVariation((v) => ({ ...v, seed: Math.floor(Math.random() * 90000000) + 10000000 }))}
                    className="px-2.5 py-1 rounded-lg bg-[#1D1D1F] text-white font-medium"
                  >
                    Randomize
                  </button>
                  <button
                    onClick={() =>
                      setVariation((v) => ({
                        ...v,
                        [varScriptTab]: {
                          intensity: 0,
                          sizeVariation: 0,
                          slantAngle: 0,
                          charSpacingVariation: 0,
                          wordSpacingVariation: 0,
                          baselineJitter: 0,
                        },
                      }))
                    }
                    className="px-2.5 py-1 rounded-lg border border-[#D2D2D7]"
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <label className="space-y-1">
                  <span>Intensity: {activeVarCfg.intensity}%</span>
                  <input type="range" min="0" max="100" value={activeVarCfg.intensity} onChange={(e) => updateVarField('intensity', Number(e.target.value))} className="w-full" />
                </label>
                <label className="space-y-1">
                  <span>Size Var: {activeVarCfg.sizeVariation}%</span>
                  <input type="range" min="0" max="50" value={activeVarCfg.sizeVariation} onChange={(e) => updateVarField('sizeVariation', Number(e.target.value))} className="w-full" />
                </label>
                <label className="space-y-1">
                  <span>Slant: {activeVarCfg.slantAngle}°</span>
                  <input type="range" min="-25" max="25" value={activeVarCfg.slantAngle} onChange={(e) => updateVarField('slantAngle', Number(e.target.value))} className="w-full" />
                </label>
                <label className="space-y-1">
                  <span>Char Space: {activeVarCfg.charSpacingVariation}%</span>
                  <input type="range" min="0" max="50" value={activeVarCfg.charSpacingVariation} onChange={(e) => updateVarField('charSpacingVariation', Number(e.target.value))} className="w-full" />
                </label>
                <label className="space-y-1">
                  <span>Word Space: {activeVarCfg.wordSpacingVariation}%</span>
                  <input type="range" min="0" max="50" value={activeVarCfg.wordSpacingVariation} onChange={(e) => updateVarField('wordSpacingVariation', Number(e.target.value))} className="w-full" />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs bg-white rounded-2xl border border-[#E5E5EA] px-4 py-3">
              <label className="flex items-center gap-2">
                <span>Size: {previewSize}px</span>
                <input type="range" min="24" max="84" value={previewSize} onChange={(e) => setPreviewSize(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2">
                <span>Line: {previewLineHeight}</span>
                <input type="range" min="1.2" max="2.4" step="0.1" value={previewLineHeight} onChange={(e) => setPreviewLineHeight(Number(e.target.value))} />
              </label>
              <label className="flex items-center gap-2">
                <span>Tracking: {previewSpacing}px</span>
                <input type="range" min="-2" max="12" value={previewSpacing} onChange={(e) => setPreviewSpacing(Number(e.target.value))} />
              </label>
              <span className="text-[#6E6E73]">
                Seed {variation.seed} · Alternates: {layoutStats.alternatesUsed}/{layoutStats.totalGlyphs} · Scale {layoutStats.minScale.toFixed(2)}x–{layoutStats.maxScale.toFixed(2)}x
              </span>
            </div>

            {previewMode === 'variation' ? (
              <ThaiPreviewCanvas
                project={activeSet}
                text={previewText}
                fontSize={previewSize}
                lineHeight={previewLineHeight}
                letterSpacing={previewSpacing}
                guides={guides}
                variation={variation}
                onLayoutStats={setLayoutStats}
              />
            ) : (
              <RealFontPreview
                project={activeSet}
                text={previewText}
                fontSize={previewSize}
                lineHeight={previewLineHeight}
                letterSpacing={previewSpacing}
                lang={lang}
              />
            )}
          </div>
        )}

        {tab === 'export' && (
          <div className="max-w-3xl space-y-5">
            <h2 className="text-2xl font-semibold">{lang === 'th' ? 'ส่งออกไฟล์ฟอนต์ (.TTF)' : 'Export TrueType Font'}</h2>
            <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-xs space-y-1">
                  <span className="text-[#6E6E73]">Font Family Name</span>
                  <input
                    value={activeSet.familyName}
                    onChange={(e) => updateActiveSet((p) => ({ ...p, familyName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7]"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-[#6E6E73]">Style (Subfamily — Separate from Slant)</span>
                  <input
                    value={activeSet.styleName}
                    onChange={(e) => updateActiveSet((p) => ({ ...p, styleName: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7]"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-[#6E6E73]">Geometric Slant ({activeSet.slantAngle}°)</span>
                  <input
                    type="range"
                    min="-25"
                    max="25"
                    value={activeSet.slantAngle}
                    onChange={(e) => updateActiveSet((p) => ({ ...p, slantAngle: Number(e.target.value) }))}
                    className="w-full"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-[#6E6E73]">Version</span>
                  <input
                    value={activeSet.version}
                    onChange={(e) => updateActiveSet((p) => ({ ...p, version: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-[#D2D2D7]"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleValidate}
                  className="px-4 py-2 rounded-xl border border-[#1D1D1F] text-sm font-medium hover:bg-[#F2F2F7]"
                >
                  {lang === 'th' ? 'ตรวจสอบ OpenType & HarfBuzz' : 'Validate OpenType & HarfBuzz'}
                </button>
                <button
                  onClick={handleExportTTF}
                  className="px-4 py-2 rounded-xl bg-[#1D1D1F] text-white text-sm font-medium hover:bg-black"
                >
                  {lang === 'th' ? 'คอมไพล์และดาวน์โหลด .TTF' : 'Compile & Download .TTF'}
                </button>
              </div>
              {exportStatus && <p className="text-xs text-[#424245]">{exportStatus}</p>}
              {validation && (
                <div className="p-3 rounded-xl bg-[#F5F5F7] text-xs space-y-1">
                  <p className="font-medium">
                    Pipeline: {validation.pipeline_used} · Glyphs: {validation.glyph_count} · GPOS: {validation.gpos_features.join(', ')} · GSUB: {validation.gsub_features.join(', ')}
                  </p>
                  {validation.checks.map((c) => (
                    <p key={c.id}>[{c.status}] {c.id}: {c.message}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-2xl font-semibold">{lang === 'th' ? 'ตั้งค่าสตูดิโอ' : 'Studio Settings'}</h2>
            <div className="bg-white rounded-2xl border border-[#E5E5EA] p-5 space-y-4 text-sm">
              <label className="flex items-center justify-between">
                <span>Cell Size: {cellScale}px</span>
                <input type="range" min="76" max="128" value={cellScale} onChange={(e) => setCellScale(Number(e.target.value))} />
              </label>
              <label className="flex items-center justify-between">
                <span>Apple Pencil Pressure Sensitivity</span>
                <input type="checkbox" checked={pressureSensitive} onChange={(e) => setPressureSensitive(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between">
                <span>Show Center Guide</span>
                <input type="checkbox" checked={showCenterGuide} onChange={(e) => setShowCenterGuide(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between">
                <span>Show Ghost Character Reference</span>
                <input type="checkbox" checked={showGhostChar} onChange={(e) => setShowGhostChar(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between">
                <span>Baseline Ratio: {Math.round(guides.baseline * 100)}%</span>
                <input
                  type="range"
                  min="0.65"
                  max="0.84"
                  step="0.01"
                  value={guides.baseline}
                  onChange={(e) => setGuides((g) => ({ ...g, baseline: Number(e.target.value) }))}
                />
              </label>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
