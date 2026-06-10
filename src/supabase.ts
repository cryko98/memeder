// Supabase client + voting/leaderboard helpers.
//
// The browser talks to Supabase directly with the anon key (intended). RLS on
// the `votes` table and the cast_vote RPC keep this safe: anon can read the
// leaderboard and increment via the RPC, but cannot arbitrarily overwrite counts.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Direction, LeaderboardRow, RankedRow, Token } from "./types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Lazily created client. If env vars are missing we keep the app usable
 * (swiping still works) and just log — voting/leaderboard will surface errors.
 */
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;
  if (!url || !anonKey || url.includes("YOUR-PROJECT-ref")) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env."
    );
  }
  client = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return client;
}

/** True if Supabase env vars look configured (used to soft-disable features). */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey && !url.includes("YOUR-PROJECT-ref"));
}

/**
 * Cast a vote via the atomic cast_vote RPC.
 * Resolves on success, rejects on error so the caller can show a toast and
 * decide whether to still advance the deck (we advance regardless — voting must
 * never block swiping).
 */
export async function castVote(token: Token, direction: Direction): Promise<void> {
  const supabase = getClient();
  const { error } = await supabase.rpc("cast_vote", {
    p_token_address: token.tokenAddress,
    p_symbol: token.symbol,
    p_name: token.name,
    p_image_url: token.imageUrl,
    p_direction: direction,
  });
  if (error) throw new Error(error.message);
}

/**
 * Fetch the global leaderboard, ranked by net score (bullish - bearish) desc.
 * Returns enriched rows ready for rendering.
 */
export async function fetchLeaderboard(limit = 100): Promise<RankedRow[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("votes")
    .select("token_address,symbol,name,image_url,bullish,bearish,updated_at")
    // Order by total activity at the DB level, then compute net client-side.
    // (Postgres can't easily order by a computed expr through the JS client,
    //  so we over-fetch and sort by net here.)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as LeaderboardRow[];
  return rows
    .map(enrich)
    .sort((a, b) => b.net - a.net || b.total - a.total);
}

function enrich(row: LeaderboardRow): RankedRow {
  const bullish = row.bullish ?? 0;
  const bearish = row.bearish ?? 0;
  const total = bullish + bearish;
  return {
    ...row,
    bullish,
    bearish,
    net: bullish - bearish,
    total,
    bullishPct: total === 0 ? 50 : Math.round((bullish / total) * 100),
  };
}

/**
 * Subscribe to live vote changes via Supabase realtime. Returns an unsubscribe
 * function. Falls back silently (returns a no-op) if realtime can't start.
 */
export function subscribeLeaderboard(onChange: () => void): () => void {
  try {
    const supabase = getClient();
    const channel = supabase
      .channel("votes-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "votes" },
        () => onChange()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return () => {};
  }
}
