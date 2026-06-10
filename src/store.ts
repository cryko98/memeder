// localStorage-backed "already voted" set.
//
// Best-effort double-vote prevention per browser. This is NOT abuse-proof:
// clearing storage, incognito, or another device all reset it. See README's
// "Future" section for wallet-based vote verification.

const STORAGE_KEY = "swipefi:voted";

/** Load the set of token addresses this browser has already voted on. */
function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === "string"));
    return new Set();
  } catch {
    // Storage disabled / quota / parse error — degrade gracefully.
    return new Set();
  }
}

let voted: Set<string> = load();

/** Has the user already voted on this token in this browser? */
export function hasVoted(tokenAddress: string): boolean {
  return voted.has(tokenAddress);
}

/** Record a vote locally so we can skip/disable re-voting. */
export function markVoted(tokenAddress: string): void {
  voted.add(tokenAddress);
  persist();
}

/** Number of tokens voted on (handy for stats / debugging). */
export function votedCount(): number {
  return voted.size;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...voted]));
  } catch {
    // ignore write failures — voting still works for the current session
  }
}
