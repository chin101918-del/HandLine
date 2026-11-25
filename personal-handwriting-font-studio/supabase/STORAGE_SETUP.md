# Supabase Storage & Authentication Setup Guide

1. **Create a Supabase Project** at https://supabase.com and copy your Project URL and `anon` public key (never place `service_role` key in `frontend/.env`).
2. **Run SQL Migration**: Paste `supabase/migrations/001_initial_schema.sql` into the Supabase SQL Editor and execute it. This creates:
   - Tables: `profiles`, `font_projects`, `glyphs`, `font_versions`, `export_history`
   - Row Level Security (RLS) policies scoped strictly to `auth.uid()`
   - Three private storage buckets: `project-assets`, `exported-fonts`, `version-snapshots`
3. **Configure Authentication**:
   - In Supabase Dashboard → Authentication → Providers → Email: enable **Email + Password** and **Magic Link (OTP)**.
   - Add your frontend URL (`http://localhost:5173` and production domain) to **Redirect URLs**.
4. **Verify Bucket Access**:
   - All files are stored under `<user_id>/<project_id>/<filename>`.
   - Downloads use short-lived signed URLs (`createSignedUrl(path, 300)`), ensuring exported `.ttf` files and project snapshots remain private.
