import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  MIN_GEO_TRAY_HEIGHT,
  getGeoTrayCollapsed,
  getGeoTrayHeight,
  saveGeoTrayCollapsed,
  saveGeoTrayHeight,
} from "../lib/geoTrayLayout";

export interface UseGeoTrayLayoutResult {
  height: number;
  collapsed: boolean;
  onDragHandleMouseDown: (event: ReactMouseEvent) => void;
  toggleCollapsed: () => void;
  expand: () => void;
}

/** `maxHeight` is dynamic (the caller passes a quarter of the viewport
 * height, recomputed on resize) rather than a fixed constant like the
 * sidebar's width — mirrored via a ref for the same reason `width` is in
 * useSidebarLayout: mousemove fires outside React's render cycle, so a
 * plain closure over the latest prop would go stale mid-drag. */
export function useGeoTrayLayout(maxHeight: number): UseGeoTrayLayoutResult {
  const [height, setHeight] = useState<number>(() =>
    Math.min(getGeoTrayHeight(), maxHeight),
  );
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    getGeoTrayCollapsed(),
  );
  const heightRef = useRef(height);
  const maxHeightRef = useRef(maxHeight);
  const dragStartRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  useEffect(() => {
    maxHeightRef.current = maxHeight;
    setHeight((prev) => Math.min(prev, maxHeight));
  }, [maxHeight]);

  const onDragHandleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      dragStartRef.current = { startY: event.clientY, startHeight: height };
    },
    [height],
  );

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (dragStartRef.current === null) return;
      // The tray is anchored to the bottom edge, so dragging the handle
      // UP (the mouse moving to a smaller clientY) should INCREASE
      // height — the opposite sign from the sidebar's left-right drag.
      const delta = dragStartRef.current.startY - event.clientY;
      const next = Math.min(
        maxHeightRef.current,
        Math.max(MIN_GEO_TRAY_HEIGHT, dragStartRef.current.startHeight + delta),
      );
      setHeight(next);
    }
    function handleMouseUp() {
      if (dragStartRef.current === null) return;
      dragStartRef.current = null;
      saveGeoTrayHeight(heightRef.current);
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
      saveGeoTrayCollapsed(next);
      return next;
    });
  }, []);

  // Not just toggleCollapsed(false) — an already-expanded tray shouldn't
  // toggle shut. Used to bring the tray into view when something external
  // (e.g. a legend click) wants to show the user where it navigated to.
  const expand = useCallback(() => {
    setCollapsed(false);
    saveGeoTrayCollapsed(false);
  }, []);

  return { height, collapsed, onDragHandleMouseDown, toggleCollapsed, expand };
}
