// SwipeFi — app entry point.
// Wires up the tab switcher, the swipe deck, voting, and the leaderboard.

import "./style.css";
import { fetchTokens } from "./api";
import { castVote, isSupabaseConfigured } from "./supabase";
import { makeSwipeable } from "./swipe";
import { hasVoted, markVoted } from "./store";
import {
  renderLeaderboard,
  startAutoRefresh,
  stopLeaderboard,
} from "./leaderboard";
import { formatUsd, formatPrice, formatPct } from "./format";
import type { Direction, Token } from "./types";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = template();

const tabSwipe = document.querySelector<HTMLButtonElement>("#tab-swipe")!;
const tabLeaderboard = document.querySelector<HTMLButtonElement>("#tab-leaderboard")!;
const viewSwipe = document.querySelector<HTMLDivElement>("#view-swipe")!;
const viewLeaderboard = document.querySelector<HTMLDivElement>("#view-leaderboard")!;
const deckEl = document.querySelector<HTMLDivElement>("#deck")!;
const btnBear = document.querySelector<HTMLButtonElement>("#btn-bear")!;
const btnBull = document.querySelector<HTMLButtonElement>("#btn-bull")!;
const toastEl = document.querySelector<HTMLDivElement>("#toast")!;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let deck: Token[] = [];
let loading = false;
let activeSwiper: ReturnType<typeof makeSwipeable> | null = null;

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function showTab(tab: "swipe" | "leaderboard") {
  const isSwipe = tab === "swipe";
  tabSwipe.classList.toggle("active", isSwipe);
  tabLeaderboard.classList.toggle("active", !isSwipe);
  viewSwipe.hidden = !isSwipe;
  viewLeaderboard.hidden = isSwipe;

  if (isSwipe) {
    stopLeaderboard();
  } else {
    // Render immediately on switch, then auto-refresh.
    void renderLeaderboard(viewLeaderboard);
    startAutoRefresh(viewLeaderboard);
  }
}

tabSwipe.addEventListener("click", () => showTab("swipe"));
tabLeaderboard.addEventListener("click", () => showTab("leaderboard"));

// ---------------------------------------------------------------------------
// Deck loading
// ---------------------------------------------------------------------------
async function loadDeck() {
  if (loading) return;
  loading = true;
  renderSkeleton();
  try {
    const tokens = await fetchTokens();
    // Skip tokens already voted on in this browser.
    deck = shuffle(tokens.filter((t) => !hasVoted(t.tokenAddress)));
    if (deck.length === 0) {
      renderDeckEmpty();
    } else {
      renderTopCards();
    }
  } catch (err) {
    renderDeckError((err as Error).message);
  } finally {
    loading = false;
  }
}

// ---------------------------------------------------------------------------
// Card rendering
// We render the top two cards: the active one (front) and the next one peeking
// behind for the stacked-card look.
// ---------------------------------------------------------------------------
function renderTopCards() {
  deckEl.innerHTML = "";
  activeSwiper?.destroy();
  activeSwiper = null;

  if (deck.length === 0) {
    renderDeckEmpty();
    return;
  }

  // Peeking next card (behind).
  if (deck[1]) {
    deckEl.appendChild(cardEl(deck[1], true));
  }

  // Active front card.
  const front = cardEl(deck[0], false);
  deckEl.appendChild(front);

  const stampBull = front.querySelector<HTMLDivElement>(".stamp-bull")!;
  const stampBear = front.querySelector<HTMLDivElement>(".stamp-bear")!;

  activeSwiper = makeSwipeable(front, {
    onDragDirection(dir, magnitude) {
      stampBull.style.opacity = dir === "bullish" ? String(magnitude) : "0";
      stampBear.style.opacity = dir === "bearish" ? String(magnitude) : "0";
    },
    onCommit(dir) {
      const token = deck[0];
      void handleVote(token, dir);
      deck.shift();
      if (deck.length === 0) {
        // Deck exhausted — refetch / reshuffle.
        void loadDeck();
      } else {
        renderTopCards();
      }
    },
  });
}

function cardEl(token: Token, behind: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "card" + (behind ? " card--behind" : "");
  const change = token.priceChange24h;
  const changeClass = change === null ? "" : change >= 0 ? "up" : "down";

  el.innerHTML = `
    <div class="stamp stamp-bull">BULLISH</div>
    <div class="stamp stamp-bear">BEARISH</div>
    <div class="card-logo-wrap">
      <img class="card-logo" src="${escapeAttr(token.imageUrl)}" alt="${escapeAttr(token.name)}"
           draggable="false" onerror="this.style.visibility='hidden'">
    </div>
    <div class="card-title">
      <span class="card-name">${escapeHtml(token.name)}</span>
      <span class="card-ticker">$${escapeHtml(token.symbol.toUpperCase())}</span>
    </div>
    <div class="card-price">
      ${formatPrice(token.priceUsd)}
      <span class="card-change ${changeClass}">${formatPct(change)}</span>
    </div>
    <div class="card-stats">
      <div class="stat">
        <span class="stat-label">Market Cap</span>
        <span class="stat-value">${formatUsd(token.marketCap)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">24h Volume</span>
        <span class="stat-value">${formatUsd(token.volume24h)}</span>
      </div>
      <div class="stat">
        <!-- DexScreener has no holder count; liquidity stands in. See api/tokens.ts -->
        <span class="stat-label">Liquidity</span>
        <span class="stat-value">${formatUsd(token.liquidityUsd)}</span>
      </div>
    </div>
  `;
  return el;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------
async function handleVote(token: Token, direction: Direction) {
  // Optimistically mark voted so we don't re-show this card.
  markVoted(token.tokenAddress);

  if (!isSupabaseConfigured()) {
    toast("Supabase not configured — vote not saved", "warn");
    return;
  }

  try {
    await castVote(token, direction);
    // Quiet success — no toast on every vote to keep the flow snappy.
  } catch (err) {
    // Voting must never block swiping; just surface a toast.
    toast(`Vote failed to save: ${(err as Error).message}`, "error");
  }
}

// Fallback buttons trigger the same fly-off + vote flow.
btnBull.addEventListener("click", () => activeSwiper?.programmatic("bullish"));
btnBear.addEventListener("click", () => activeSwiper?.programmatic("bearish"));

// ---------------------------------------------------------------------------
// Deck states (skeleton / empty / error)
// ---------------------------------------------------------------------------
function renderSkeleton() {
  deckEl.innerHTML = `
    <div class="card card--skeleton">
      <div class="skeleton skeleton-logo"></div>
      <div class="skeleton skeleton-line skeleton-line--wide"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-stats"></div>
    </div>
  `;
}

function renderDeckEmpty() {
  deckEl.innerHTML = `
    <div class="deck-msg">
      <p>You've swiped them all! 🎉</p>
      <button class="primary-btn" id="reload-deck">Load more</button>
    </div>
  `;
  deckEl.querySelector("#reload-deck")?.addEventListener("click", () => void loadDeck());
}

function renderDeckError(msg: string) {
  deckEl.innerHTML = `
    <div class="deck-msg">
      <p>Couldn't load tokens.</p>
      <p class="deck-msg-detail">${escapeHtml(msg)}</p>
      <button class="primary-btn" id="retry-deck">Retry</button>
    </div>
  `;
  deckEl.querySelector("#retry-deck")?.addEventListener("click", () => void loadDeck());
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer: number | null = null;
function toast(msg: string, kind: "info" | "warn" | "error" = "info") {
  toastEl.textContent = msg;
  toastEl.className = `toast toast--${kind} show`;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3500);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    // Math.random is fine here (visual shuffle, not security-sensitive).
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function template(): string {
  return `
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">🔥</span>
        <span class="brand-name">SwipeFi</span>
      </div>
      <nav class="tabs">
        <button id="tab-swipe" class="tab active">Swipe</button>
        <button id="tab-leaderboard" class="tab">Leaderboard</button>
      </nav>
    </header>

    <main class="content">
      <section id="view-swipe" class="view">
        <div class="deck-wrap">
          <div id="deck" class="deck"></div>
        </div>
        <div class="deck-actions">
          <button id="btn-bear" class="action-btn action-btn--bear" aria-label="Bearish">✕</button>
          <button id="btn-bull" class="action-btn action-btn--bull" aria-label="Bullish">✓</button>
        </div>
        <p class="hint">Swipe right if you're bullish, left if you're bearish.</p>
      </section>

      <section id="view-leaderboard" class="view" hidden></section>
    </main>

    <div id="toast" class="toast"></div>
  `;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
showTab("swipe");
void loadDeck();
