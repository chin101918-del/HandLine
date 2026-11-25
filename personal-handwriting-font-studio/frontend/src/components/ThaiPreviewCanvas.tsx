import React, { useEffect, useRef } from 'react';
import {
  planVariedTextLayout,
  THAI_ABOVE_VOWELS,
  THAI_TONE_MARKS,
} from '../engine/variationEngine';
import { FontSet, GuideRatios, VariationSettings } from '../types/font';

const TALL_ASCENDERS = new Set([0x0e1b, 0x0e1d, 0x0e1f, 0x0e2c]);

interface ThaiPreviewCanvasProps {
  project: FontSet;
  text: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  guides: GuideRatios;
  variation: VariationSettings;
  onLayoutStats?: (stats: { totalGlyphs: number; alternatesUsed: number; minScale: number; maxScale: number }) => void;
}

export const ThaiPreviewCanvas: React.FC<ThaiPreviewCanvasProps> = ({
  project,
  text,
  fontSize,
  lineHeight,
  letterSpacing,
  guides,
  variation,
  onLayoutStats,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 720;
    const height = 280;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    const plan = planVariedTextLayout(text, project, variation);

    const paddingX = 28;
    const lineStep = fontSize * lineHeight;
    let cursorX = paddingX;
    let baselineY = paddingX + fontSize * 1.15;

    let activeBase: {
      centerX: number;
      baselineY: number;
      cp: number;
      hasUpperMark: boolean;
    } | null = null;

    let totalGlyphs = 0;
    let alternatesUsed = 0;
    let minScale = Infinity;
    let maxScale = -Infinity;

    for (const item of plan) {
      if (item.type === 'newline') {
        cursorX = paddingX;
        baselineY += lineStep;
        activeBase = null;
        continue;
      }

      if (item.type === 'space') {
        const baseSpace = fontSize * 0.36;
        const spaceAdvance = Math.max(
          fontSize * 0.14,
          baseSpace + baseSpace * item.wordSpaceDeltaRatio + letterSpacing
        );
        cursorX += spaceAdvance;
        activeBase = null;
        continue;
      }

      totalGlyphs += 1;
      if (item.instanceIndex > 0) alternatesUsed += 1;
      if (item.scaleFactor < minScale) minScale = item.scaleFactor;
      if (item.scaleFactor > maxScale) maxScale = item.scaleFactor;

      const isAbove = THAI_ABOVE_VOWELS.has(item.codepoint);
      const isTone = THAI_TONE_MARKS.has(item.codepoint);
      const shear = Math.tan((item.slantDeg * Math.PI) / 180);
      const inst = item.instance;

      if (inst && inst.strokes.length > 0) {
        const chCanvas = inst.canvasHeight || 120;
        const span = Math.max(chCanvas * (guides.baseline - guides.ascender), 1);
        const scale = (fontSize * item.scaleFactor) / span;

        let minX = Infinity;
        let maxX = -Infinity;
        for (const s of inst.strokes) {
          for (const p of s.points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
          }
        }
        const glyphW = Math.max((maxX - minX) * scale, fontSize * 0.22 * item.scaleFactor);

        if (!item.isCombining && cursorX + glyphW > width - paddingX && cursorX > paddingX) {
          cursorX = paddingX;
          baselineY += lineStep;
          activeBase = null;
        }

        const glyphBaselineY = item.isCombining && activeBase
          ? activeBase.baselineY
          : baselineY + item.baselineOffsetRatio * fontSize;

        let offsetX: number;
        let offsetY: number;
        let pivotX: number;
        let pivotY: number;

        if (item.isCombining && activeBase) {
          const markCenter = ((minX + maxX) / 2) * scale;
          const tallShift = TALL_ASCENDERS.has(activeBase.cp) ? -fontSize * item.scaleFactor * 0.14 : 0;
          offsetX = activeBase.centerX - markCenter + tallShift;
          offsetY = glyphBaselineY - chCanvas * guides.baseline * scale;
          if (isTone && activeBase.hasUpperMark) {
            offsetY -= fontSize * item.scaleFactor * 0.24;
          }
          if (isAbove) activeBase.hasUpperMark = true;
          pivotX = activeBase.centerX;
          pivotY = glyphBaselineY;
        } else {
          offsetX = cursorX - minX * scale;
          offsetY = glyphBaselineY - chCanvas * guides.baseline * scale;
          pivotX = cursorX + glyphW * 0.5;
          pivotY = glyphBaselineY;
          activeBase = {
            centerX: pivotX,
            baselineY: glyphBaselineY,
            cp: item.codepoint,
            hasUpperMark: false,
          };
        }

        // Apply real geometric slant shear around the base glyph's baseline so Thai marks remain locked
        ctx.save();
        ctx.translate(pivotX, pivotY);
        if (Math.abs(shear) > 1e-4) ctx.transform(1, 0, -shear, 1, 0, 0);
        ctx.translate(-pivotX, -pivotY);

        ctx.strokeStyle = '#1D1D1F';
        ctx.fillStyle = '#1D1D1F';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const s of inst.strokes) {
          if (s.points.length === 1) {
            const p = s.points[0];
            ctx.beginPath();
            ctx.arc(offsetX + p.x * scale, offsetY + p.y * scale, Math.max(1, s.width * scale * 0.5), 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          for (let i = 1; i < s.points.length; i++) {
            const p0 = s.points[i - 1];
            const p1 = s.points[i];
            ctx.lineWidth = Math.max(1.2, s.width * scale * (0.65 + 0.7 * ((p0.pressure + p1.pressure) / 2)));
            ctx.beginPath();
            ctx.moveTo(offsetX + p0.x * scale, offsetY + p0.y * scale);
            ctx.lineTo(offsetX + p1.x * scale, offsetY + p1.y * scale);
            ctx.stroke();
          }
        }
        ctx.restore();

        if (!item.isCombining) {
          const charSpace = fontSize * 0.12 + letterSpacing + item.charSpaceDeltaRatio * fontSize;
          cursorX += glyphW + Math.max(-fontSize * 0.06, charSpace);
        }
      } else {
        // Unwritten glyph fallback rendered with exact same variation scale & slant
        if (!item.isCombining && cursorX > width - paddingX - fontSize) {
          cursorX = paddingX;
          baselineY += lineStep;
          activeBase = null;
        }
        const glyphBaselineY = item.isCombining && activeBase
          ? activeBase.baselineY
          : baselineY + item.baselineOffsetRatio * fontSize;
        ctx.save();
        ctx.font = `400 ${Math.round(fontSize * item.scaleFactor)}px "Noto Sans Thai", "Inter", sans-serif`;
        const measured = ctx.measureText(item.char).width;
        const drawX = item.isCombining && activeBase ? activeBase.centerX : cursorX;
        ctx.translate(drawX, glyphBaselineY);
        if (Math.abs(shear) > 1e-4) ctx.transform(1, 0, -shear, 1, 0, 0);
        ctx.fillStyle = '#B0B0B8';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(item.char, 0, 0);
        ctx.restore();

        if (!item.isCombining) {
          activeBase = {
            centerX: cursorX + measured * 0.5,
            baselineY: glyphBaselineY,
            cp: item.codepoint,
            hasUpperMark: false,
          };
          const charSpace = letterSpacing + item.charSpaceDeltaRatio * fontSize;
          cursorX += measured + Math.max(-fontSize * 0.06, charSpace);
        } else if (isAbove && activeBase) {
          activeBase.hasUpperMark = true;
        }
      }
    }

    ctx.restore();
    if (onLayoutStats) {
      onLayoutStats({
        totalGlyphs,
        alternatesUsed,
        minScale: isFinite(minScale) ? minScale : 1,
        maxScale: isFinite(maxScale) ? maxScale : 1,
      });
    }
  }, [project, text, fontSize, lineHeight, letterSpacing, guides, variation, onLayoutStats]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-[280px] rounded-2xl border border-[#E5E5EA] bg-white"
    />
  );
};
