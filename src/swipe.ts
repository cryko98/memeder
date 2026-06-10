// Drag/swipe gesture logic for a single card element.
//
// Supports mouse + touch via Pointer Events. The card follows the pointer,
// tilts based on horizontal offset, and reveals a BULLISH/BEARISH stamp. On
// release past the threshold the card flies off and we report the direction;
// otherwise it snaps back. CSS transforms/transitions only — no libraries.

import type { Direction } from "./types";

export interface SwipeHandlers {
  /** Called continuously during drag with the current direction hint (or null). */
  onDragDirection?: (dir: Direction | null, magnitude: number) => void;
  /** Called once when the card is released past threshold and flies off. */
  onCommit: (dir: Direction) => void;
}

// Horizontal distance (px) past which a release counts as a vote.
const THRESHOLD = 110;
// How far (px) the card flies off-screen on commit.
const FLY_DISTANCE = 1000;
// Max tilt in degrees at full drag.
const MAX_TILT = 18;

/**
 * Make a card element draggable. Returns a `destroy` function to remove
 * listeners, and a `programmatic(dir)` function so the ✕ / ✓ buttons can
 * trigger the same fly-off animation.
 */
export function makeSwipeable(card: HTMLElement, handlers: SwipeHandlers) {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let pointerId: number | null = null;
  let committed = false;

  function setTransform(dx: number, dy: number, extraRotate = 0) {
    const tilt = clamp((dx / THRESHOLD) * MAX_TILT, -MAX_TILT, MAX_TILT) + extraRotate;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${tilt}deg)`;
  }

  function directionFor(dx: number): Direction | null {
    if (Math.abs(dx) < 12) return null;
    return dx > 0 ? "bullish" : "bearish";
  }

  function onPointerDown(e: PointerEvent) {
    if (committed) return;
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    // Disable transition so the card tracks the finger 1:1.
    card.style.transition = "none";
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    setTransform(dx, dy);
    const dir = directionFor(dx);
    const magnitude = clamp(Math.abs(dx) / THRESHOLD, 0, 1);
    handlers.onDragDirection?.(dir, magnitude);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    card.classList.remove("dragging");
    const dx = e.clientX - startX;
    const dir = directionFor(dx);

    if (dir && Math.abs(dx) >= THRESHOLD) {
      flyOff(dir);
    } else {
      snapBack();
    }
  }

  function snapBack() {
    card.style.transition = "transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)";
    card.style.transform = "translate(0, 0) rotate(0deg)";
    handlers.onDragDirection?.(null, 0);
  }

  function flyOff(dir: Direction) {
    if (committed) return;
    committed = true;
    const sign = dir === "bullish" ? 1 : -1;
    card.style.transition = "transform 0.45s ease-out, opacity 0.45s ease-out";
    card.style.transform = `translate(${sign * FLY_DISTANCE}px, -80px) rotate(${sign * 28}deg)`;
    card.style.opacity = "0";
    handlers.onDragDirection?.(dir, 1);
    // Report after the fly animation kicks off; caller advances the deck.
    window.setTimeout(() => handlers.onCommit(dir), 300);
  }

  card.addEventListener("pointerdown", onPointerDown);
  card.addEventListener("pointermove", onPointerMove);
  card.addEventListener("pointerup", onPointerUp);
  card.addEventListener("pointercancel", onPointerUp);

  return {
    /** Trigger the same commit flow as a manual swipe (for fallback buttons). */
    programmatic(dir: Direction) {
      if (committed) return;
      flyOff(dir);
    },
    destroy() {
      card.removeEventListener("pointerdown", onPointerDown);
      card.removeEventListener("pointermove", onPointerMove);
      card.removeEventListener("pointerup", onPointerUp);
      card.removeEventListener("pointercancel", onPointerUp);
    },
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
