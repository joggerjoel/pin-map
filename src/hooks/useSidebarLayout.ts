import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  getSidebarCollapsed,
  getSidebarWidth,
  saveSidebarCollapsed,
  saveSidebarWidth,
} from "../lib/sidebarLayout";

export interface UseSidebarLayoutResult {
  width: number;
  collapsed: boolean;
  onSplitterMouseDown: (event: ReactMouseEvent) => void;
  toggleCollapsed: () => void;
}

export function useSidebarLayout(): UseSidebarLayoutResult {
  const [width, setWidth] = useState<number>(() => getSidebarWidth());
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    getSidebarCollapsed(),
  );
  const widthRef = useRef(width);
  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const onSplitterMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      dragStartRef.current = { startX: event.clientX, startWidth: width };
    },
    [width],
  );

  // These are registered once via `window.addEventListener` with an empty
  // dependency array because mousemove/mouseup fire in rapid succession
  // outside React's render cycle (same reasoning as `draggedIndexRef` in
  // PlaceList.tsx) — reading `width` from a stale closure would be wrong.
  // `widthRef` mirrors `width` for the same reason, so `handleMouseUp`
  // always saves the latest value.
  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (dragStartRef.current === null) return;
      const delta = event.clientX - dragStartRef.current.startX;
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, dragStartRef.current.startWidth + delta),
      );
      setWidth(next);
    }
    function handleMouseUp() {
      if (dragStartRef.current === null) return;
      dragStartRef.current = null;
      saveSidebarWidth(widthRef.current);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      saveSidebarCollapsed(next);
      return next;
    });
  }, []);

  return { width, collapsed, onSplitterMouseDown, toggleCollapsed };
}
