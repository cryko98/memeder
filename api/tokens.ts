// Vercel serverless function: /api/tokens
//
// Proxies the DexScreener API server-side so the browser never calls it directly
// (avoids CORS + keeps us under rate limits with a shared cache). Returns a
// cleaned, defensively-filtered deck of Solana memecoin cards.
//
// Data flow:
//   1. GET /token-boosts/top/v1            -> trending/boosted tokens (all chains)
//   2. filter chainId === "solana"         -> collect tokenAddress values
//   3. GET /latest/dex/tokens/{addrs}      -> pair data (batched, max 30/call)
//   4. pick the most-liquid pair per token -> map to our Token shape
//
// Tokens missing a logo or market cap are SKIPPED so the UI never crashes.

import type { VercelRequest, VercelResponse } from "@vercel/node";

// ----- DexScreener endpoints -----
const BOOSTS_URL = "https://api.dexscreener.com/token-boosts/top/v1";
const TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens/";
const MAX_ADDR_PER_CALL = 30;
const CACHE_SECONDS = 60;
// Don't show micro-cap dust: skip any token whose market cap is below this.
const MIN_MARKET_CAP = 30_000;

// ----- Minimal shapes of the DexScreener payloads we consume -----
interface BoostItem {
  chainId?: string;
  tokenAddress?: string;
}

interface DexPair {
  chainId?: string;
  pairAddress?: string;
  url?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  info?: { imageUrl?: string };
}

interface OutToken {
  tokenAddress: string;
  pairAddress: string | null;
  chainId: string;
  dexUrl: string;
  name: string;
  symbol: string;
  imageUrl: string;
  priceUsd: number | null;
  marketCap: number;
  volume24h: number | null;
  liquidityUsd: number | null;
  priceChange24h: number | null;
}

// In-memory cache. On Vercel this persists per warm lambda instance, which is
// enough to smooth out bursts; the Cache-Control header below also lets the CDN
// cache the response for ~60s.
let cache: { at: number; tokens: OutToken[] } | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Basic CORS (same-origin in practice, but harmless and helps local tooling).
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_SECONDS * 1000) {
      sendOk(res, cache.tokens, cache.at);
      return;
    }

    const tokens = await buildDeck();
    cache = { at: now, tokens };
    sendOk(res, tokens, now);
  } catch (err) {
    // If we have a stale cache, serve it rather than failing the client.
    if (cache) {
      sendOk(res, cache.tokens, cache.at);
      return;
    }
    res.status(502).json({
      error: "Failed to load tokens from DexScreener",
      detail: (err as Error).message,
    });
  }
}

function sendOk(res: VercelResponse, tokens: OutToken[], cachedAt: number) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`
  );
  res.status(200).json({ tokens, cachedAt });
}

async function buildDeck(): Promise<OutToken[]> {
  // 1. Trending/boosted tokens, filtered to Solana.
  const boosts = (await fetchJson(BOOSTS_URL)) as BoostItem[];
  const addresses = Array.from(
    new Set(
      (Array.isArray(boosts) ? boosts : [])
        .filter((b) => b.chainId === "solana" && typeof b.tokenAddress === "string")
        .map((b) => b.tokenAddress as string)
    )
  );

  if (addresses.length === 0) return [];

  // 2. Fetch pair data in batches of <= 30 addresses.
  const batches = chunk(addresses, MAX_ADDR_PER_CALL);
  const pairLists = await Promise.all(
    batches.map(async (batch) => {
      try {
        const data = (await fetchJson(TOKENS_URL + batch.join(","))) as
          | { pairs?: DexPair[] }
          | DexPair[];
        // The endpoint returns { pairs: [...] }; be defensive about shape.
        if (Array.isArray(data)) return data;
        return data.pairs ?? [];
      } catch {
        return [] as DexPair[];
      }
    })
  );

  const allPairs = pairLists.flat();

  // 3. For each token address, keep the most-liquid Solana pair.
  const bestByToken = new Map<string, DexPair>();
  for (const pair of allPairs) {
    if (pair.chainId !== "solana") continue;
    const addr = pair.baseToken?.address;
    if (!addr) continue;
    const existing = bestByToken.get(addr);
    if (!existing || liq(pair) > liq(existing)) {
      bestByToken.set(addr, pair);
    }
  }

  // 4. Map to our Token shape, skipping anything missing a logo or market cap.
  const out: OutToken[] = [];
  for (const addr of addresses) {
    const pair = bestByToken.get(addr);
    if (!pair) continue;

    const imageUrl = pair.info?.imageUrl;
    const marketCap = pair.marketCap ?? pair.fdv; // fdv fallback
    const name = pair.baseToken?.name;
    const symbol = pair.baseToken?.symbol;

    // Defensive skips — never crash the UI on incomplete data.
    if (!imageUrl) continue;
    if (marketCap === undefined || marketCap === null) continue;
    if (!name || !symbol) continue;
    // Skip micro-caps below the floor.
    if (marketCap < MIN_MARKET_CAP) continue;

    const pairAddress = pair.pairAddress ?? null;
    const dexUrl =
      pair.url ??
      (pairAddress ? `https://dexscreener.com/solana/${pairAddress}` : `https://dexscreener.com/solana/${addr}`);

    out.push({
      tokenAddress: addr,
      pairAddress,
      chainId: "solana",
      dexUrl,
      name,
      symbol,
      imageUrl,
      priceUsd: toNum(pair.priceUsd),
      marketCap,
      volume24h: pair.volume?.h24 ?? null,
      // NOTE: DexScreener has no holder count. We surface liquidity (USD) and
      // label it "Liquidity" in the UI. A future Helius RPC call could supply
      // real holder counts here.
      liquidityUsd: pair.liquidity?.usd ?? null,
      priceChange24h: pair.priceChange?.h24 ?? null,
    });
  }

  return out;
}

// ----- helpers -----
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`DexScreener ${res.status} for ${url}`);
  }
  return res.json();
}

function liq(p: DexPair): number {
  return p.liquidity?.usd ?? 0;
}

function toNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}
