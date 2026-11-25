import { createClient, Session } from '@supabase/supabase-js';
import { FontSet } from '../types/font';
import { getValidInstances } from '../db/indexedDb';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export const isSupabaseConfigured = Boolean(supabase);

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signInWithMagicLink(email: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getActiveSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function cloudSaveProject(fontSet: FontSet, userId: string): Promise<void> {
  if (!supabase) return;
  const { error: projErr } = await supabase.from('font_projects').upsert({
    id: fontSet.id,
    user_id: userId,
    name: fontSet.name,
    family_name: fontSet.familyName,
    style_name: fontSet.styleName,
    full_name: fontSet.fullName,
    postscript_name: fontSet.postscriptName,
    designer: fontSet.designer,
    copyright_text: fontSet.copyrightText,
    version: fontSet.version,
    units_per_em: fontSet.metrics.unitsPerEm,
    ascender: fontSet.metrics.ascender,
    cap_height: fontSet.metrics.capHeight,
    x_height: fontSet.metrics.xHeight,
    baseline: fontSet.metrics.baseline,
    descender: fontSet.metrics.descender,
    line_gap: fontSet.metrics.lineGap,
  });
  if (projErr) throw projErr;

  const glyphRows = Object.values(fontSet.glyphs).map((g) => {
    const valid = getValidInstances(g);
    const primary = valid[0];
    return {
      project_id: fontSet.id,
      codepoint: g.unicode,
      character: g.character,
      category: g.category,
      canvas_width: primary?.canvasWidth || 96,
      canvas_height: primary?.canvasHeight || 120,
      strokes: g.instances, // stores full multi-instance array in JSONB
      is_completed: valid.length > 0,
    };
  });
  if (glyphRows.length > 0) {
    const { error: gErr } = await supabase
      .from('glyphs')
      .upsert(glyphRows, { onConflict: 'project_id,codepoint' });
    if (gErr) throw gErr;
  }
}
