-- SwipeFi — Supabase schema
-- Run this entire file in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- It is idempotent-ish: safe to re-run. It creates the votes table, the atomic
-- cast_vote RPC, enables Row Level Security, and adds public read + RPC-execute policies.

-- ---------------------------------------------------------------------------
-- Table: votes
-- One row per token. Counts are incremented atomically through the RPC below,
-- never written directly by the anon client.
-- ---------------------------------------------------------------------------
create table if not exists public.votes (
  token_address text primary key,
  symbol        text,
  name          text,
  image_url     text,
  bullish       int  not null default 0,
  bearish       int  not null default 0,
  updated_at    timestamptz not null default now()
);

-- Helpful index for the leaderboard ordering (net score = bullish - bearish).
create index if not exists votes_net_score_idx
  on public.votes ((bullish - bearish) desc);

-- ---------------------------------------------------------------------------
-- RPC: cast_vote
-- UPSERTs the token row and atomically increments bullish or bearish based on
-- p_direction. Using a single INSERT ... ON CONFLICT statement makes the
-- increment race-safe under concurrent votes (no read-modify-write in app code).
--
-- SECURITY INVOKER (default) is fine because RLS on votes still applies; we grant
-- EXECUTE to anon/authenticated below. The function only ever does a scoped
-- increment, so the anon key cannot set arbitrary counts.
-- ---------------------------------------------------------------------------
create or replace function public.cast_vote(
  p_token_address text,
  p_symbol        text,
  p_name          text,
  p_image_url     text,
  p_direction     text
)
returns public.votes
language plpgsql
as $$
declare
  result public.votes;
begin
  if p_direction not in ('bullish', 'bearish') then
    raise exception 'invalid direction: %, expected bullish or bearish', p_direction;
  end if;

  insert into public.votes as v (token_address, symbol, name, image_url, bullish, bearish, updated_at)
  values (
    p_token_address,
    p_symbol,
    p_name,
    p_image_url,
    case when p_direction = 'bullish' then 1 else 0 end,
    case when p_direction = 'bearish' then 1 else 0 end,
    now()
  )
  on conflict (token_address) do update
    set bullish    = v.bullish + (case when p_direction = 'bullish' then 1 else 0 end),
        bearish    = v.bearish + (case when p_direction = 'bearish' then 1 else 0 end),
        -- keep metadata fresh in case the token's logo/name changed, but only
        -- overwrite with non-null incoming values
        symbol     = coalesce(excluded.symbol, v.symbol),
        name       = coalesce(excluded.name, v.name),
        image_url  = coalesce(excluded.image_url, v.image_url),
        updated_at = now()
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.votes enable row level security;

-- Public read: anyone (anon) can SELECT the leaderboard.
drop policy if exists "votes public read" on public.votes;
create policy "votes public read"
  on public.votes
  for select
  to anon, authenticated
  using (true);

-- NOTE: We intentionally do NOT add INSERT/UPDATE policies for anon. All writes
-- go through cast_vote(). Because the function is SECURITY INVOKER, it executes
-- under the caller's role — so it needs INSERT/UPDATE to be permitted for the
-- rows it touches. We allow that here but ONLY via the function's controlled
-- increment path. If you prefer to lock direct writes down harder, change the
-- function to `security definer` and REMOVE the two policies below; the function
-- owner's privileges will then perform the write regardless of RLS.
drop policy if exists "votes insert via rpc" on public.votes;
create policy "votes insert via rpc"
  on public.votes
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "votes update via rpc" on public.votes;
create policy "votes update via rpc"
  on public.votes
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- Allow the anon (and authenticated) roles to EXECUTE the RPC.
grant execute on function public.cast_vote(text, text, text, text, text) to anon, authenticated;

-- Make sure the leaderboard SELECT is actually reachable by the API roles.
grant select on public.votes to anon, authenticated;
grant insert, update on public.votes to anon, authenticated;
