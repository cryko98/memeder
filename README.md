# SwipeFi — Memecoin Tinder 🔥

Swipe-based voting on real Solana memecoins. Swipe **right if you're bullish**,
**left if you're bearish**. Votes are stored in **Supabase**, so the leaderboard
is **global** across every visitor.

> "SwipeFi" is a placeholder name — rebrand freely.

- **Tech:** Vite + vanilla TypeScript (no React), plain CSS, dark theme, mobile-first
- **Data:** [DexScreener](https://docs.dexscreener.com/) (free, no API key), proxied server-side
- **Backend:** Supabase (`votes` table + atomic `cast_vote` RPC + RLS)
- **Deploy:** Vercel (static frontend + one serverless proxy function)

---

## What it is

A single-page app with two screens:

1. **Swipe deck** — one memecoin card at a time (next card peeks behind). Each
   card shows logo, name, `$TICKER`, market cap, 24h volume, liquidity, and 24h
   price change (green up / red down). Drag with mouse or finger: the card tilts
   and a **BULLISH** / **BEARISH** stamp fades in. Release past the threshold and
   the card flies off and the vote is recorded; otherwise it snaps back. There
   are also ✕ / ✓ fallback buttons.
2. **Leaderboard** — reads live from Supabase, ranked by **net score**
   (bullish − bearish). Each row shows rank, logo, name, `$TICKER`, net score, a
   bullish/bearish ratio bar, and total votes. Auto-refreshes every 15s (and on
   tab switch), with an optional Supabase realtime subscription.

---

## Local development

```bash
npm install
npm run dev
```

> **Important:** plain `npm run dev` (Vite) serves the frontend but **not** the
> `/api/tokens` serverless proxy. You have two options:
>
> - **Recommended:** install the Vercel CLI and run `vercel dev`, which serves
>   both the Vite app and the `api/` function locally.
>   ```bash
>   npm i -g vercel
>   vercel dev
>   ```
> - **Or** deploy once to Vercel and point local dev at the deployed proxy by
>   setting `VITE_TOKENS_URL=https://your-app.vercel.app/api/tokens` in `.env`.

### Environment variables

Copy `.env.example` to `.env` and fill in your Supabase values:

```bash
cp .env.example .env
```

```ini
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

`.env` is git-ignored — **never commit real keys**. The anon key is public by
design (Row Level Security protects the data), but keep your `.env` out of git
regardless.

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates:
   - the `votes` table (`token_address` PK, `symbol`, `name`, `image_url`,
     `bullish`, `bearish`, `updated_at`),
   - the `cast_vote(...)` RPC that **UPSERTs and atomically increments**
     bullish/bearish (race-safe under concurrent votes),
   - **Row Level Security** with public `SELECT` and public `EXECUTE` of the RPC.
3. Go to **Project Settings → API** and copy the **Project URL** and the
   **anon public** key into your `.env` (and into Vercel — see below).

### Why voting goes through an RPC

The anon key is shipped to the browser, so it must not be able to arbitrarily
overwrite counts. Direct table writes are therefore funneled through
`cast_vote`, which only ever performs a scoped `+1` increment. Anon can **read**
the leaderboard and **execute** the RPC, nothing more. (See the comments in
`schema.sql` if you'd rather lock it down further with a `security definer`
function and no INSERT/UPDATE policies.)

### Double-vote prevention (best-effort)

The app keeps a `localStorage` set of token addresses you've already voted on
and skips/disables re-voting. This is **best-effort, not abuse-proof** — clearing
storage, incognito windows, or another device all reset it. See **Future** below
for wallet-based verification.

---

## How the serverless proxy works

The browser **never** calls DexScreener directly (CORS + rate limits). Instead it
calls our own [`api/tokens.ts`](api/tokens.ts) on Vercel, which:

1. fetches trending/boosted tokens from `GET /token-boosts/top/v1` and filters to
   `chainId === "solana"`,
2. batches those addresses (max 30 per call) into
   `GET /latest/dex/tokens/{addresses}`,
3. picks the most-liquid pair per token and maps it to a clean card shape,
4. **skips** tokens missing a logo or market cap so the UI never crashes,
5. caches the response for ~60s (in-memory + `Cache-Control` for the CDN) to
   respect DexScreener's rate limits (300 req/min on `/latest/dex`).

DexScreener has **no holder count**, so the card shows `liquidity.usd` labeled
**"Liquidity"**. A code comment in `api/tokens.ts` notes where a Helius RPC call
could later supply real holder counts.

> Supabase, by contrast, **is** called directly from the client with the anon key
> — that's intended and safe thanks to RLS.

---

## Deploy to Vercel

1. Push this repo to GitHub (already wired to
   `https://github.com/cryko98/memeder`).
2. In Vercel, **Add New → Project** and import the repo. Vercel auto-detects Vite;
   `vercel.json` sets the build command, output dir, and the `api/tokens.ts`
   function.
3. **Add the environment variables in the Vercel dashboard** (Project →
   Settings → Environment Variables) — the same ones from your `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   These must be present at **build time** because Vite inlines `VITE_*` vars into
   the client bundle. Redeploy after adding them.
4. Deploy. The frontend is static; `/api/tokens` runs as a serverless function.

---

## Project structure

```
index.html              # app shell
src/
  main.ts               # wiring: tabs, deck, voting, toasts
  style.css             # dark, mobile-first styles
  api.ts                # client fetch wrapper -> /api/tokens
  supabase.ts           # Supabase client + castVote + fetchLeaderboard + realtime
  swipe.ts              # pointer-based drag/swipe logic
  leaderboard.ts        # render + auto-refresh leaderboard
  store.ts              # localStorage already-voted set
  format.ts             # number/price/percent formatting
  types.ts              # Token / Vote / LeaderboardRow types
api/
  tokens.ts             # Vercel serverless DexScreener proxy
supabase/
  schema.sql            # table + RPC + RLS policies
vercel.json             # Vercel build + function config
.env.example            # env template (placeholders)
```

---

## Future

- **Real holder counts** via [Helius](https://www.helius.dev/) RPC (DexScreener
  doesn't expose them; we show liquidity instead).
- **pump.fun launch integration** for fresh-launch discovery.
- **Wallet-based vote verification** (sign a message / token-gate) to make voting
  meaningfully abuse-resistant instead of the current best-effort localStorage
  guard.
