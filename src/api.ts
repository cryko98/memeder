// Client-side fetch wrapper for our serverless token proxy.
//
// The browser NEVER calls DexScreener directly (CORS + rate limits). It only
// talks to our own /api/tokens function, which proxies and caches DexScreener.

import type { TokensResponse, Token } from "./types";

// Allow overriding the proxy URL for plain `vite` dev (no `vercel dev`).
// In production / `vercel dev` this stays as the relative path.
const TOKENS_URL = (import.meta.env.VITE_TOKENS_URL as string | undefined) || "/api/tokens";

/**
 * Fetch a fresh deck of memecoin cards from our proxy.
 * Throws on network / non-2xx so the caller can show a retry state.
 */
export async function fetchTokens(): Promise<Token[]> {
  const res = await fetch(TOKENS_URL, {
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Token proxy responded ${res.status}`);
  }

  const data = (await res.json()) as TokensResponse;
  if (!data || !Array.isArray(data.tokens)) {
    throw new Error("Malformed token response");
  }
  return data.tokens;
}
