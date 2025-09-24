-- Price snapshots table for training regression and charting
-- Run this SQL in your Supabase SQL editor

-- Extension for UUIDs if not already enabled
create extension if not exists "pgcrypto";

create table if not exists public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- We key primarily by symbol for easy joining from UI
  symbol text not null,             -- e.g., BTC
  coinlore_id text,                 -- numeric string from CoinLore, e.g., '90'
  name text,
  nameid text,                      -- coinlore slug, e.g., 'bitcoin'
  price_usd numeric not null,       -- use numeric to avoid float rounding
  market_cap_usd numeric,
  volume24 numeric,
  rank integer,
  source text not null default 'coinlore'
);

-- Helpful indexes for time-range queries
create index if not exists price_snapshots_symbol_created_at_idx on public.price_snapshots(symbol, created_at desc);
create index if not exists price_snapshots_coinlore_created_at_idx on public.price_snapshots(coinlore_id, created_at desc);

-- Enable RLS and allow public reads (UI fetches). Inserts happen from Edge Function using service role.
alter table public.price_snapshots enable row level security;

-- Allow anyone to select (read-only)
-- Postgres doesn't support IF NOT EXISTS on CREATE POLICY in some versions; use DO block for idempotence
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'price_snapshots'
      AND policyname = 'Allow read to anon'
  ) THEN
    CREATE POLICY "Allow read to anon" ON public.price_snapshots
      FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Ensure SELECT privilege (RLS still applies)
GRANT SELECT ON public.price_snapshots TO anon, authenticated;

-- No insert/update/delete policies for anon; service role bypasses RLS for Edge Function inserts.

-- Optional retention: clean old data (e.g., keep 60 days). Run manually/scheduler if desired.
-- delete from public.price_snapshots where created_at < now() - interval '60 days';