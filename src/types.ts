// Shared type definitions for SwipeFi.

/** Vote direction. Right swipe = bullish, left swipe = bearish. */
export type Direction = "bullish" | "bearish";

/**
 * A memecoin card as served by our /api/tokens proxy.
 * The proxy guarantees name, symbol, imageUrl and marketCap are present
 * (tokens missing a logo or market cap are filtered out server-side).
 */
export interface Token {
  tokenAddress: string;
  name: string;
  symbol: string;
  imageUrl: string;
  priceUsd: number | null;
  marketCap: number; // marketCap, or fdv fallback
  volume24h: number | null;
  /**
   * DexScreener has no holder count, so we surface liquidity (USD) here and
   * label it "Liquidity" in the UI. See api/tokens.ts for the Helius note.
   */
  liquidityUsd: number | null;
  priceChange24h: number | null; // percent, can be negative
}

/** Shape returned by the /api/tokens endpoint. */
export interface TokensResponse {
  tokens: Token[];
  /** Unix ms timestamp the proxy generated/cached this response. */
  cachedAt: number;
}

/** A row in the `votes` table / leaderboard. */
export interface LeaderboardRow {
  token_address: string;
  symbol: string | null;
  name: string | null;
  image_url: string | null;
  bullish: number;
  bearish: number;
  updated_at: string;
}

/** Leaderboard row enriched with derived fields for rendering. */
export interface RankedRow extends LeaderboardRow {
  net: number; // bullish - bearish
  total: number; // bullish + bearish
  bullishPct: number; // 0..100
}
