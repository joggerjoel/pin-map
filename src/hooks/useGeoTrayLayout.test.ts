import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useGeoTrayLayout } from "./useGeoTrayLayout";
import {
  DEFAULT_GEO_TRAY_HEIGHT,
  MIN_GEO_TRAY_HEIGHT,
} from "../lib/geoTrayLayout";

beforeEach(() => {
  window.localStorage.clear();
});

function fireMouseMove(clientY: number) {
  window.dispatchEvent(new MouseEvent("mousemove", { clientY }));
}

function fireMouseUp() {
  window.dispatchEvent(new MouseEvent("mouseup"));
}

describe("useGeoTrayLayout", () => {
  it("starts expanded, at the default height, when localStorage is empty", () => {
    const { result } = renderHook(() => useGeoTrayLayout(300));
    expect(result.current.collapsed).toBe(false);
    expect(result.current.height).toBe(DEFAULT_GEO_TRAY_HEIGHT);
  });

  it("clamps the initial height to maxHeight when the default would exceed it", () => {
    const { result } = renderHook(() => useGeoTrayLayout(100));
    expect(result.current.height).toBe(100);
  });

  it("toggleCollapsed flips collapsed and persists it", () => {
    const { result } = renderHook(() => useGeoTrayLayout(300));

    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("pin-map:geo-tray-collapsed")).toBe(
      "true",
    );
  });

  it("dragging the handle up increases height, clamped to maxHeight", () => {
    const { result } = renderHook(() => useGeoTrayLayout(300));

    act(() => {
      result.current.onDragHandleMouseDown({
        clientY: 500,
      } as React.MouseEvent);
    });
    act(() => {
      fireMouseMove(400); // moved up 100px
    });
    expect(result.current.height).toBe(DEFAULT_GEO_TRAY_HEIGHT + 100);

    act(() => {
      fireMouseMove(0); // way past maxHeight
    });
    expect(result.current.height).toBe(300);

    act(() => {
      fireMouseUp();
    });
    expect(window.localStorage.getItem("pin-map:geo-tray-height")).toBe("300");
  });

  it("dragging the handle down decreases height, clamped to the minimum", () => {
    const { result } = renderHook(() => useGeoTrayLayout(300));

    act(() => {
      result.current.onDragHandleMouseDown({
        clientY: 500,
      } as React.MouseEvent);
    });
    act(() => {
      fireMouseMove(1000); // moved down 500px, well past the minimum
    });
    expect(result.current.height).toBe(MIN_GEO_TRAY_HEIGHT);
  });

  it("re-clamps height if maxHeight shrinks below the current height", () => {
    const { result, rerender } = renderHook(
      ({ maxHeight }) => useGeoTrayLayout(maxHeight),
      { initialProps: { maxHeight: 300 } },
    );
    act(() => {
      result.current.onDragHandleMouseDown({
        clientY: 500,
      } as React.MouseEvent);
    });
    act(() => {
      // delta = startY(500) - currentY(200) = 300; 160 default + 300 far
      // exceeds maxHeight(300), so it clamps to exactly 300.
      fireMouseMove(200);
    });
    expect(result.current.height).toBe(300);

    rerender({ maxHeight: 120 });
    expect(result.current.height).toBe(120);
  });
});
