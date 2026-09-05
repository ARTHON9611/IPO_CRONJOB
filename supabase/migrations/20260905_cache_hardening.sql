-- IPO Board cache-hardening migration
-- Run this ONCE in Supabase dashboard -> SQL editor -> New query -> Run.
--
-- What it does:
--   1. Adds updated_at (freshness tracking for /api/health + sync correctness).
--   2. Adds a unique index on company_name (required for bulk upsert
--      on_conflict="company_name" in sync.py / lib/sync.js).
--
-- The sync code works WITHOUT this migration too (automatic per-row
-- fallback), but runs slower and /api/health reports freshness "unknown".

-- 1. Freshness timestamp
alter table public.ipos
  add column if not exists updated_at timestamptz default now();

-- Backfill existing rows so /api/health has a baseline immediately.
update public.ipos set updated_at = now() where updated_at is null;

-- 2. If this reports rows, delete/merge duplicates BEFORE creating the index:
-- select company_name, count(*) from public.ipos group by company_name having count(*) > 1;

-- 3. Unique index for bulk upsert conflict target
create unique index if not exists ipos_company_name_uidx
  on public.ipos (company_name);
