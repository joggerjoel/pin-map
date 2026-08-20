import type { MouseEvent as ReactMouseEvent } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSidebarLayout } from "./useSidebarLayout";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  getSidebarWidth,
} from "../lib/sidebarLayout";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useSidebarLayout", () => {
  it("starts with the default width and expanded when localStorage is empty", () => {
    const { result } = renderHook(() => useSidebarLayout());

    expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(result.current.collapsed).toBe(false);
  });

  it("toggleCollapsed flips collapsed and persists it", () => {
    const { result } = renderHook(() => useSidebarLayout());

    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("pin-map:sidebar-collapsed")).toBe(
      "true",
    );

    act(() => {
      result.current.toggleCollapsed();
    });
    expect(result.current.collapsed).toBe(false);
    expect(window.localStorage.getItem("pin-map:sidebar-collapsed")).toBe(
      "false",
    );
  });

  it("dragging the splitter updates width", () => {
    const { result } = renderHook(() => useSidebarLayout());
    const startingWidth = result.current.width;

    act(() => {
      result.current.onSplitterMouseDown({
        clientX: 100,
      } as ReactMouseEvent);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 }));
    });

    expect(result.current.width).toBe(startingWidth + 50);
  });

  it("clamps dragging past the maximum width", () => {
    const { result } = renderHook(() => useSidebarLayout());

    act(() => {
      result.current.onSplitterMouseDown({
        clientX: 100,
      } as ReactMouseEvent);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100000 }));
    });

    expect(result.current.width).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("clamps dragging past the minimum width", () => {
    const { result } = renderHook(() => useSidebarLayout());

    act(() => {
      result.current.onSplitterMouseDown({
        clientX: 100,
      } as ReactMouseEvent);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: -100000 }));
    });

    expect(result.current.width).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("persists the final width when the drag is released", () => {
    const { result } = renderHook(() => useSidebarLayout());

    act(() => {
      result.current.onSplitterMouseDown({
        clientX: 100,
      } as ReactMouseEvent);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 180 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(getSidebarWidth()).toBe(result.current.width);
  });

  it("moving the mouse with no active drag does not change width", () => {
    const { result } = renderHook(() => useSidebarLayout());
    const startingWidth = result.current.width;

    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 }));
    });

    expect(result.current.width).toBe(startingWidth);
  });
});
