import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (!window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
  });
}

// jsdom doesn't implement scrollIntoView; stub it so components that call it
// (e.g. to scroll a highlighted item into view) don't throw in tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement ResizeObserver at all — a bare no-op stub so any
// component that observes its own container size doesn't throw on mount.
// Tests that need to actually verify resize-triggered behavior define a
// more capable mock scoped to their own file (see MapView.test.tsx).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom doesn't implement IntersectionObserver either — same no-op stub
// approach. Tests that need to actually verify intersection-triggered
// behavior define a more capable mock scoped to their own file (see
// UnsortedPhotosPanel.test.tsx).
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds: ReadonlyArray<number> = [];
  } as unknown as typeof globalThis.IntersectionObserver;
}
