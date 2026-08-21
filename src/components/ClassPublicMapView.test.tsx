import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassPublicMapView } from "./ClassPublicMapView";
import type { PublicRosterLocation } from "../lib/classPublicRosterRepository";

const { markerInstances, MockMap, MockMarker, MockPopup } = vi.hoisted(() => {
  const markerInstances: InstanceType<typeof MockMarker>[] = [];

  class MockMap {
    sources = new Map<string, { data: unknown }>();
    handlers: Record<string, Array<() => void>> = {};
    constructor(public options: unknown) {}
    remove(): void {}
    isStyleLoaded(): boolean {
      return true;
    }
    on(event: string, handler: () => void): void {
      (this.handlers[event] ??= []).push(handler);
    }
    off(event: string, handler: () => void): void {
      this.handlers[event] = (this.handlers[event] ?? []).filter(
        (h) => h !== handler,
      );
    }
    once(_event: string, handler: () => void): void {
      handler();
    }
    getSource(id: string): { setData: (data: unknown) => void } | undefined {
      const record = this.sources.get(id);
      if (record === undefined) return undefined;
      return { setData: (data: unknown) => (record.data = data) };
    }
    addSource(id: string, options: { data: unknown }): void {
      this.sources.set(id, { data: options.data });
    }
    addLayer(): void {}
    project([lng, lat]: [number, number]): { x: number; y: number } {
      return { x: lng, y: lat };
    }
    unproject([x, y]: [number, number]): { lng: number; lat: number } {
      return { lng: x, lat: y };
    }
  }

  class MockPopup {
    domContent: unknown;
    setDOMContent(content: unknown): MockPopup {
      this.domContent = content;
      return this;
    }
  }

  class MockMarker {
    lngLat: [number, number] | undefined;
    popup: MockPopup | undefined;
    removed = false;
    element: HTMLElement | undefined;
    constructor(options?: { element?: HTMLElement }) {
      this.element = options?.element;
      markerInstances.push(this);
    }
    setLngLat(lngLat: [number, number]): MockMarker {
      this.lngLat = lngLat;
      return this;
    }
    setPopup(popup: MockPopup): MockMarker {
      this.popup = popup;
      return this;
    }
    addTo(): MockMarker {
      return this;
    }
    remove(): void {
      this.removed = true;
    }
  }

  return { markerInstances, MockMap, MockMarker, MockPopup };
});

vi.mock("mapbox-gl", () => ({
  default: {
    Map: MockMap,
    Marker: MockMarker,
    Popup: MockPopup,
    accessToken: "",
  },
}));

beforeEach(() => {
  markerInstances.length = 0;
  window.localStorage.clear();
});

const jane: PublicRosterLocation = {
  id: 1,
  imageUrl:
    "https://files.sohyper.com/class1989/class1989-001_sheet1_row1_col1.png",
  livingLat: 42.96,
  livingLng: -85.67,
};

describe("ClassPublicMapView", () => {
  it("places an avatar marker for each person at their cached location", () => {
    render(<ClassPublicMapView token="pk.test" people={[jane]} />);

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0]?.lngLat).toEqual([
      jane.livingLng,
      jane.livingLat,
    ]);
    expect(markerInstances[0]?.element?.className).toBe(
      "class-meetup-map__avatar-marker",
    );
  });

  it("shows only the photo in the popup, with no name text anywhere", () => {
    render(<ClassPublicMapView token="pk.test" people={[jane]} />);

    const content = markerInstances[0]?.popup?.domContent as HTMLDivElement;
    expect(content.textContent).toBe("");
    const img = content.querySelector("img");
    expect(img?.src).toBe(jane.imageUrl);
    expect(img?.alt).toBe("");
  });

  it("does not put a name in the marker's own alt text either", () => {
    render(<ClassPublicMapView token="pk.test" people={[jane]} />);

    const img = markerInstances[0]?.element?.querySelector("img");
    expect(img?.alt).toBe("");
  });

  it("re-renders markers when the people list changes", () => {
    const { rerender } = render(
      <ClassPublicMapView token="pk.test" people={[jane]} />,
    );
    expect(markerInstances).toHaveLength(1);

    const other: PublicRosterLocation = { ...jane, id: 2 };
    rerender(<ClassPublicMapView token="pk.test" people={[jane, other]} />);

    expect(markerInstances).toHaveLength(3);
    expect(markerInstances[0]?.removed).toBe(true);
  });

  it("shows a Spider toggle defaulting to on, available without signing in", () => {
    render(<ClassPublicMapView token="pk.test" people={[jane]} />);

    expect(
      screen.getByRole("button", { name: "Spider: On" }),
    ).toBeInTheDocument();
  });

  it("toggles the Spider label and persists the preference on click", async () => {
    const user = userEvent.setup();
    render(<ClassPublicMapView token="pk.test" people={[jane]} />);

    await user.click(screen.getByRole("button", { name: "Spider: On" }));

    expect(
      screen.getByRole("button", { name: "Spider: Off" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("pin-map:class-declutter-enabled")).toBe(
      "false",
    );
  });
});
