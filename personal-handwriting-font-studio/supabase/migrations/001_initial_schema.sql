-- Personal Handwriting Font Studio — Complete Supabase PostgreSQL Schema & RLS
-- Tables: profiles, font_projects, glyphs, font_versions, export_history
-- Storage Buckets: project-assets, exported-fonts, version-snapshots (all private)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. User Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    preferred_language TEXT NOT NULL DEFAULT 'th' CHECK (preferred_language IN ('th', 'en')),
    default_stroke_width NUMERIC(5,2) NOT NULL DEFAULT 3.2,
    pressure_sensitivity BOOLEAN NOT NULL DEFAULT TRUE,
    cell_scale_px INTEGER NOT NULL DEFAULT 96 CHECK (cell_scale_px BETWEEN 72 AND 140),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Font Projects
CREATE TABLE IF NOT EXISTS public.font_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    family_name TEXT NOT NULL,
    style_name TEXT NOT NULL DEFAULT 'Regular',
    full_name TEXT NOT NULL DEFAULT '',
    postscript_name TEXT NOT NULL DEFAULT '',
    designer TEXT NOT NULL DEFAULT '',
    copyright_text TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.000',
    units_per_em INTEGER NOT NULL DEFAULT 1000 CHECK (units_per_em IN (1000, 2048)),
    ascender INTEGER NOT NULL DEFAULT 880,
    cap_height INTEGER NOT NULL DEFAULT 700,
    x_height INTEGER NOT NULL DEFAULT 500,
    baseline INTEGER NOT NULL DEFAULT 0,
    descender INTEGER NOT NULL DEFAULT -260,
    line_gap INTEGER NOT NULL DEFAULT 90,
    guide_ratios JSONB NOT NULL DEFAULT '{"ascender":0.14,"capHeight":0.28,"xHeight":0.44,"baseline":0.74,"descender":0.92}'::jsonb,
    schema_version INTEGER NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_font_projects_user ON public.font_projects(user_id, updated_at DESC);

-- 3. Glyphs (separates raw handwriting strokes from generated/edited vector outlines & anchors)
CREATE TABLE IF NOT EXISTS public.glyphs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.font_projects(id) ON DELETE CASCADE,
    codepoint INTEGER NOT NULL,
    character TEXT NOT NULL,
    category TEXT NOT NULL,
    canvas_width NUMERIC(6,2) NOT NULL DEFAULT 96,
    canvas_height NUMERIC(6,2) NOT NULL DEFAULT 120,
    strokes JSONB NOT NULL DEFAULT '[]'::jsonb,
    edited_contours JSONB,
    advance_width INTEGER,
    lsb INTEGER,
    rsb INTEGER,
    anchors JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, codepoint)
);

CREATE INDEX IF NOT EXISTS idx_glyphs_project ON public.glyphs(project_id);

-- 4. Font Version Snapshots (for Version History & Restore)
CREATE TABLE IF NOT EXISTS public.font_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.font_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version_label TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    glyph_count INTEGER NOT NULL DEFAULT 0,
    snapshot_storage_path TEXT,
    snapshot_inline JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_font_versions_project ON public.font_versions(project_id, created_at DESC);

-- 5. Export History (compiled .TTF records & validation reports)
CREATE TABLE IF NOT EXISTS public.export_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.font_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'ttf' CHECK (format IN ('ttf', 'otf', 'woff2')),
    storage_path TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    glyph_count INTEGER NOT NULL DEFAULT 0,
    validation_passed BOOLEAN NOT NULL DEFAULT FALSE,
    validation_report JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_history_project ON public.export_history(project_id, created_at DESC);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated ON public.font_projects;
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.font_projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_glyphs_updated ON public.glyphs;
CREATE TRIGGER trg_glyphs_updated BEFORE UPDATE ON public.glyphs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row Level Security (RLS) on ALL user-owned tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.font_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glyphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.font_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_owner_all" ON public.profiles
    FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "font_projects_owner_all" ON public.font_projects
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "glyphs_owner_all" ON public.glyphs
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.font_projects p WHERE p.id = glyphs.project_id AND p.user_id = auth.uid())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.font_projects p WHERE p.id = glyphs.project_id AND p.user_id = auth.uid())
    );

CREATE POLICY "font_versions_owner_all" ON public.font_versions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "export_history_owner_all" ON public.export_history
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Private Storage Buckets
INSERT INTO storage.buckets (id, name, public) VALUES
    ('project-assets', 'project-assets', FALSE),
    ('exported-fonts', 'exported-fonts', FALSE),
    ('version-snapshots', 'version-snapshots', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: user may access ONLY objects inside `<auth.uid()>/...`
CREATE POLICY "storage_owner_select" ON storage.objects
    FOR SELECT USING (
        bucket_id IN ('project-assets', 'exported-fonts', 'version-snapshots')
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "storage_owner_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id IN ('project-assets', 'exported-fonts', 'version-snapshots')
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "storage_owner_update" ON storage.objects
    FOR UPDATE USING (
        bucket_id IN ('project-assets', 'exported-fonts', 'version-snapshots')
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "storage_owner_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id IN ('project-assets', 'exported-fonts', 'version-snapshots')
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
