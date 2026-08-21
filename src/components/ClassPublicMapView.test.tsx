import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassPublicMapView } from "./ClassPublicMapView";
import type { PublicRosterLocation } from "../lib/classPublicRosterRepository";

const { markerInstances, MockMap, MockMarker, MockPopup } = vi.hoisted(() => {
  const markerInstances: InstanceType<typeof MockMarker>[] = [];

  class MockMap {
    constructor(public options: unknown) {}
    remove(): void {}
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
});
