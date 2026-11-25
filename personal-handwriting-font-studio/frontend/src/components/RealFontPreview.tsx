import React, { useEffect, useState } from 'react';
import { FontProject } from '../types/font';
import { compileAndDownloadTTF } from '../lib/api';

interface RealFontPreviewProps {
  project: FontProject;
  text: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  lang: 'th' | 'en';
}

export const RealFontPreview: React.FC<RealFontPreviewProps> = ({
  project,
  text,
  fontSize,
  lineHeight,
  letterSpacing,
  lang,
}) => {
  const [fontLoadedName, setFontLoadedName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const loadFromBackend = async () => {
    setLoading(true);
    setStatus(lang === 'th' ? 'กำลังคอมไพล์ .TTF จริงจาก Backend...' : 'Compiling real .TTF from backend...');
    try {
      const blob = await compileAndDownloadTTF(project);
      const buf = await blob.arrayBuffer();
      const faceName = `PHFS_Live_${Date.now()}`;
      const face = new FontFace(faceName, buf);
      await face.load();
      document.fonts.add(face);
      setFontLoadedName(faceName);
      setStatus(lang === 'th' ? 'โหลดฟอนต์ .TTF จริงสำเร็จแล้ว' : 'Loaded compiled .TTF via FontFace API');
    } catch (err) {
      setStatus(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFontLoadedName(null);
  }, [project.id]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[#6E6E73]">
          {status || (lang === 'th' ? 'คลิกเพื่อคอมไพล์และแสดงผลด้วยไฟล์ .TTF จริง' : 'Compile and render using an actual .TTF binary')}
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={loadFromBackend}
          className="px-3.5 py-1.5 rounded-xl bg-[#1D1D1F] text-white text-xs font-medium hover:bg-black disabled:opacity-40"
        >
          {loading ? '...' : lang === 'th' ? 'คอมไพล์และโหลด .TTF จริง' : 'Compile & Load Real .TTF'}
        </button>
      </div>

      <div
        className="w-full min-h-[240px] rounded-2xl border border-[#E5E5EA] bg-white p-6 whitespace-pre-wrap break-words"
        style={{
          fontFamily: fontLoadedName ? `"${fontLoadedName}", "Noto Sans Thai", sans-serif` : '"Noto Sans Thai", sans-serif',
          fontSize: `${fontSize}px`,
          lineHeight,
          letterSpacing: `${letterSpacing}px`,
        }}
      >
        {text}
      </div>
    </div>
  );
};
