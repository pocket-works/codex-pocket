import { useRef, useState, type CSSProperties, type TouchEvent } from "react";

// Touch gestures a phone expects from a native screen: dragging in from
// the left edge to go back, and dragging a bottom sheet down to close it.
// Both are pure touch handlers plus a transform; no listeners on window.

/** How far from the left edge a touch may start and still count as a back swipe. */
const EDGE_PX = 28;
/** Past this fraction of the screen width the swipe commits on release. */
const BACK_COMMIT = 0.35;
/** A sheet dragged down this far (px) closes on release. */
const SHEET_COMMIT_PX = 110;

interface Handlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export interface Gesture {
  handlers: Handlers;
  /** Transform to apply while the finger is down; empty when idle. */
  style: CSSProperties;
  dragging: boolean;
}

type Axis = "x" | "y" | "none";

/** Undecided under 10px; then only a clearly directional move (2:1) is a gesture, a slanted flick is "none". */
function axisOf(dx: number, dy: number): Axis | null {
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return null;
  if (Math.abs(dx) > Math.abs(dy) * 2) return "x";
  if (Math.abs(dy) > Math.abs(dx) * 2) return "y";
  return "none";
}

/** Drag offset as state (for the transform) and as a ref (for the release handler). */
function useOffset(): [number, (n: number) => void, { current: number }] {
  const [offset, setOffsetState] = useState(0);
  const ref = useRef(0);
  const setOffset = (n: number) => {
    ref.current = n;
    setOffsetState(n);
  };
  return [offset, setOffset, ref];
}

/** Drag the screen in from the left edge to go back, as iOS navigation does. */
export function useSwipeBack(onBack: () => void): Gesture {
  const [offset, setOffset, offsetRef] = useOffset();
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; axis: Axis | null } | null>(null);

  const handlers: Handlers = {
    onTouchStart(e) {
      const t = e.touches[0];
      start.current = t.clientX <= EDGE_PX ? { x: t.clientX, y: t.clientY, axis: null } : null;
    },
    onTouchMove(e) {
      const st = start.current;
      if (!st) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!st.axis) {
        st.axis = axisOf(dx, dy);
        if (st.axis === "x") setDragging(true);
      }
      if (st.axis !== "x") return;
      setOffset(Math.max(0, dx));
    },
    onTouchEnd() {
      const st = start.current;
      start.current = null;
      setDragging(false);
      if (st?.axis === "x" && offsetRef.current > window.innerWidth * BACK_COMMIT) onBack();
      setOffset(0);
    },
    onTouchCancel() {
      start.current = null;
      setDragging(false);
      setOffset(0);
    },
  };
  return { handlers, dragging, style: offset > 0 ? { transform: `translateX(${offset}px)` } : {} };
}

/**
 * Drag a bottom sheet down to close it. The drag starts anywhere on the
 * sheet as long as nothing between the finger and the sheet is scrolled
 * away from its top, so a list inside still scrolls normally.
 */
export function useSheetDrag(onClose: () => void): Gesture {
  const [offset, setOffset, offsetRef] = useOffset();
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; x: number; axis: Axis | null } | null>(null);

  const handlers: Handlers = {
    onTouchStart(e) {
      const t = e.touches[0];
      start.current = scrolledInside(e.target as Element, e.currentTarget as Element) ? null : { x: t.clientX, y: t.clientY, axis: null };
    },
    onTouchMove(e) {
      const st = start.current;
      if (!st) return;
      const t = e.touches[0];
      const dx = t.clientX - st.x;
      const dy = t.clientY - st.y;
      if (!st.axis) {
        st.axis = axisOf(dx, dy);
        // Upward is the inner list scrolling; only a downward drag is ours.
        if (st.axis === "y" && dy < 0) st.axis = "none";
        if (st.axis === "y") setDragging(true);
      }
      if (st.axis !== "y") return;
      setOffset(Math.max(0, dy));
    },
    onTouchEnd() {
      const st = start.current;
      start.current = null;
      setDragging(false);
      if (st?.axis === "y" && offsetRef.current > SHEET_COMMIT_PX) onClose();
      setOffset(0);
    },
    onTouchCancel() {
      start.current = null;
      setDragging(false);
      setOffset(0);
    },
  };
  return { handlers, dragging, style: offset > 0 ? { transform: `translateY(${offset}px)` } : {} };
}

function scrolledInside(from: Element | null, upTo: Element): boolean {
  for (let el = from; el && el !== upTo; el = el.parentElement) if (el.scrollTop > 0) return true;
  return upTo.scrollTop > 0;
}
