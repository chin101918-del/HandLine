import React, { useEffect, useRef } from 'react';
import { Check, Eraser, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { CharacterSpec } from '../data/charset';
import { PointerInputGuard } from '../engine/inputProtection';
import { GuideRatios, InputMode, Stroke, StrokePoint } from '../types/font';

interface CharacterCellProps {
  spec: CharacterSpec;
  strokes: Stroke[];
  instanceCount: number;
  activeInstanceIdx: number;
  isSelected: boolean;
  cellWidth: number;
  cellHeight: number;
  strokeWidth: number;
  pressureSensitive: boolean;
  tool: 'pen' | 'eraser';
  inputMode: InputMode;
  guides: GuideRatios;
  showCenterGuide: boolean;
  showGhostChar: boolean;
  onSelect: () => void;
  onChangeStrokes: (next: Stroke[]) => void;
  onAddInstance: () => void;
  onCycleInstance: () => void;
  onUndo: () => void;
  canUndo: boolean;
}

export const CharacterCell: React.FC<CharacterCellProps> = ({
  spec,
  strokes,
  instanceCount,
  activeInstanceIdx,
  isSelected,
  cellWidth,
  cellHeight,
  strokeWidth,
  pressureSensitive,
  tool,
  inputMode,
  guides,
  showCenterGuide,
  showGhostChar,
  onSelect,
  onChangeStrokes,
  onAddInstance,
  onCycleInstance,
  onUndo,
  canUndo,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>(strokes);
  strokesRef.current = strokes;

  // Software-level Apple Pencil palm rejection & multi-pointer guard layered over native iPadOS palm rejection
  const guardRef = useRef<PointerInputGuard>(new PointerInputGuard({ mode: inputMode }));
  useEffect(() => {
    guardRef.current.setMode(inputMode);
  }, [inputMode]);

  const drawAll = (extraStroke?: Stroke | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cellWidth * dpr) || canvas.height !== Math.round(cellHeight * dpr)) {
      canvas.width = Math.round(cellWidth * dpr);
      canvas.height = Math.round(cellHeight * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cellWidth, cellHeight);

    const drawGuide = (ratio: number, color: string, dashed = true) => {
      const y = Math.round(cellHeight * ratio) + 0.5;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      if (dashed) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cellWidth, y);
      ctx.stroke();
      ctx.restore();
    };

    drawGuide(guides.ascender, 'rgba(148, 163, 184, 0.35)', true);
    drawGuide(guides.capHeight, 'rgba(148, 163, 184, 0.25)', true);
    drawGuide(guides.xHeight, 'rgba(59, 130, 246, 0.22)', true);
    drawGuide(guides.baseline, 'rgba(15, 23, 42, 0.28)', false);
    drawGuide(guides.descender, 'rgba(148, 163, 184, 0.35)', true);

    if (showCenterGuide) {
      const cx = Math.round(cellWidth / 2) + 0.5;
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, cellHeight);
      ctx.stroke();
      ctx.restore();
    }

    if (showGhostChar && strokesRef.current.length === 0 && !extraStroke) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.font = `400 ${Math.round(cellHeight * 0.48)}px "Noto Sans Thai", "Inter", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const displayChar = spec.isCombining ? `◌${spec.char}` : spec.char;
      ctx.fillText(displayChar, cellWidth / 2, cellHeight * guides.baseline);
      ctx.restore();
    }

    const allStrokes = extraStroke ? [...strokesRef.current, extraStroke] : strokesRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    ctx.fillStyle = '#111827';

    for (const s of allStrokes) {
      const pts = s.points;
      if (pts.length === 0) continue;
      if (pts.length === 1) {
        const r = Math.max(1, s.width * 0.5 * (pressureSensitive ? 0.65 + 0.7 * pts[0].pressure : 1));
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1];
        const p1 = pts[i];
        const pressure = pressureSensitive ? (p0.pressure + p1.pressure) / 2 : 0.5;
        ctx.lineWidth = Math.max(1.1, s.width * (0.65 + 0.7 * pressure));
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  };

  useEffect(() => {
    drawAll();
  }, [strokes, cellWidth, cellHeight, guides, showCenterGuide, showGhostChar, pressureSensitive]);

  const getLocalPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return {
      x: Number((e.clientX - rect.left).toFixed(2)),
      y: Number((e.clientY - rect.top).toFixed(2)),
      pressure: Number(pressure.toFixed(3)),
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      timestamp: Date.now(),
    };
  };

  const eraseAt = (pt: StrokePoint) => {
    const threshold = Math.max(10, strokeWidth * 2.8);
    const filtered = strokesRef.current.filter(
      (s) => !s.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= threshold)
    );
    if (filtered.length !== strokesRef.current.length) {
      onChangeStrokes(filtered);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const decision = guardRef.current.onPointerDown(e.nativeEvent);
    if (decision === 'reject') return;

    e.preventDefault();
    onSelect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if capture is unsupported
    }
    const pt = getLocalPoint(e);
    if (tool === 'eraser') {
      eraseAt(pt);
      return;
    }
    const newStroke: Stroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      width: strokeWidth,
      points: [pt],
    };
    activeStrokeRef.current = newStroke;
    if (decision === 'accept') {
      drawAll(newStroke);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const decision = guardRef.current.onPointerMove(e.nativeEvent);
    if (decision === 'reject') return;

    if (tool === 'eraser') {
      if (e.buttons > 0) eraseAt(getLocalPoint(e));
      return;
    }
    if (!activeStrokeRef.current) return;
    e.preventDefault();
    const pt = getLocalPoint(e);
    const pts = activeStrokeRef.current.points;
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) >= 0.8) {
      pts.push(pt);
      drawAll(activeStrokeRef.current);
    }
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const shouldCommit = guardRef.current.onPointerEndOrCancel(e.nativeEvent);
    if (!activeStrokeRef.current) return;
    const finished = activeStrokeRef.current;
    activeStrokeRef.current = null;
    if (!shouldCommit) {
      drawAll();
      return;
    }
    onChangeStrokes([...strokesRef.current, finished]);
  };

  const handleLostCapture = () => {
    guardRef.current.reset();
    activeStrokeRef.current = null;
    drawAll();
  };

  const isCompleted = strokes.length > 0;

  return (
    <div
      onClick={onSelect}
      className={`group rounded-2xl bg-white border transition-all flex flex-col items-center p-2.5 ${
        isSelected
          ? 'border-[#1D1D1F] ring-2 ring-black/5 shadow-sm'
          : 'border-[#E5E5EA] hover:border-[#C7C7CC]'
      }`}
    >
      <div className="w-full flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-[#1D1D1F] leading-none">
            {spec.isCombining ? `◌${spec.char}` : spec.char}
          </span>
          <span className="text-[10px] text-[#8E8E93] font-mono">
            {spec.codepoint.toString(16).toUpperCase().padStart(4, '0')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {instanceCount > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCycleInstance();
              }}
              title="Switch sample instance"
              className="px-1.5 py-0.5 rounded-md bg-[#F2F2F7] text-[10px] font-mono hover:bg-[#E5E5EA]"
            >
              {activeInstanceIdx + 1}/{instanceCount}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddInstance();
            }}
            title="Add new handwriting instance"
            className="p-0.5 rounded-md bg-[#F2F2F7] hover:bg-[#1D1D1F] hover:text-white"
          >
            <Plus className="w-3 h-3" />
          </button>
          {isCompleted ? (
            <span className="w-4 h-4 rounded-full bg-[#1D1D1F] text-white flex items-center justify-center">
              <Check className="w-2.5 h-2.5" />
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-[#E5E5EA]" />
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: `${cellWidth}px`, height: `${cellHeight}px` }}
        className="studio-canvas rounded-xl bg-[#FAFAFC] border border-[#ECECF0] cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handleLostCapture}
      />

      <div className="w-full flex items-center justify-between mt-1.5 px-0.5 opacity-80 group-hover:opacity-100">
        <button
          type="button"
          disabled={!canUndo}
          onClick={(e) => {
            e.stopPropagation();
            onUndo();
          }}
          title="Undo"
          className="p-1 rounded-md text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#F2F2F7] disabled:opacity-30"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={!isCompleted}
          onClick={(e) => {
            e.stopPropagation();
            onChangeStrokes([]);
          }}
          title="Clear current instance"
          className="p-1 rounded-md text-[#6E6E73] hover:text-[#D70015] hover:bg-[#F2F2F7] disabled:opacity-30"
        >
          {tool === 'eraser' ? <Eraser className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
};
