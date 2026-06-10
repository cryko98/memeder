// Renders the global leaderboard from Supabase data.

import { fetchLeaderboard, isSupabaseConfigured } from "./supabase";
import type { RankedRow } from "./types";
import { formatCompact } from "./format";

let refreshTimer: number | null = null;

/**
 * Render the leaderboard into `container` and start a 15s auto-refresh.
 * Call stopLeaderboard() when leaving the tab to clear the timer.
 */
export async function renderLeaderboard(container: HTMLElement): Promise<void> {
  if (!isSupabaseConfigured()) {
    container.innerHTML = configHint();
    return;
  }
  await refresh(container);
  startAutoRefresh(container);
}

export function startAutoRefresh(container: HTMLElement): void {
  stopLeaderboard();
  refreshTimer = window.setInterval(() => {
    void refresh(container);
  }, 15_000);
}

export function stopLeaderboard(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function refresh(container: HTMLElement): Promise<void> {
  try {
    const rows = await fetchLeaderboard();
    container.innerHTML = rows.length ? rowsHtml(rows) : emptyState();
  } catch (err) {
    // Only show the error if we have nothing rendered yet; otherwise keep stale
    // data on screen and try again next tick.
    if (!container.querySelector(".lb-row")) {
      container.innerHTML = errorState((err as Error).message);
      container.querySelector<HTMLButtonElement>(".retry-btn")?.addEventListener(
        "click",
        () => void refresh(container)
      );
    }
  }
}

function rowsHtml(rows: RankedRow[]): string {
  return `
    <div class="lb-list">
      ${rows.map((r, i) => rowHtml(r, i + 1)).join("")}
    </div>
  `;
}

function rowHtml(r: RankedRow, rank: number): string {
  const netClass = r.net > 0 ? "pos" : r.net < 0 ? "neg" : "";
  const sign = r.net > 0 ? "+" : "";
  const name = escapeHtml(r.name || r.symbol || shortAddr(r.token_address));
  const symbol = escapeHtml((r.symbol || "").toUpperCase());
  const logo = r.image_url
    ? `<img class="lb-logo" src="${escapeAttr(r.image_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<div class="lb-logo lb-logo--placeholder">?</div>`;

  return `
    <div class="lb-row">
      <div class="lb-rank">${rank}</div>
      ${logo}
      <div class="lb-meta">
        <div class="lb-name">${name}</div>
        <div class="lb-symbol">$${symbol}</div>
      </div>
      <div class="lb-stats">
        <div class="lb-net ${netClass}">${sign}${r.net}</div>
        <div class="lb-ratiobar" title="${r.bullish} bullish / ${r.bearish} bearish">
          <div class="lb-ratiobar-fill" style="width:${r.bullishPct}%"></div>
        </div>
        <div class="lb-total">${r.total} vote${r.total === 1 ? "" : "s"}</div>
      </div>
    </div>
  `;
}

function emptyState(): string {
  return `<div class="lb-empty">No votes yet. Go swipe some coins! 🔥</div>`;
}

function errorState(msg: string): string {
  return `
    <div class="lb-error">
      <p>Couldn't load the leaderboard.</p>
      <p class="lb-error-detail">${escapeHtml(msg)}</p>
      <button class="retry-btn">Retry</button>
    </div>
  `;
}

function configHint(): string {
  return `
    <div class="lb-error">
      <p>Supabase isn't configured yet.</p>
      <p class="lb-error-detail">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env, then run the SQL in supabase/schema.sql.</p>
    </div>
  `;
}

function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
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

// Re-export so other modules importing from leaderboard can format numbers.
export { formatCompact };
