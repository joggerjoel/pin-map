import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassMeetupMapView } from "./ClassMeetupMapView";
import type { ClassMeetup } from "../lib/classMeetupsRepository";

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
    constructor() {
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

const meetup: ClassMeetup = {
  id: "meetup-1",
  submittedByEmail: "joel@example.com",
  metPersonId: 5,
  metPersonName: "Jane Smith Johnson",
  query: "Chicago",
  name: "Chicago, Illinois, USA",
  lat: 41.88,
  lng: -87.63,
  metDate: "06/1995",
};

describe("ClassMeetupMapView", () => {
  it("places a marker for each meetup at its coordinates", () => {
    render(<ClassMeetupMapView token="pk.test" meetups={[meetup]} />);

    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0]?.lngLat).toEqual([meetup.lng, meetup.lat]);
  });

  it("builds popup content with the place, who was met, the date, and who submitted it", () => {
    render(<ClassMeetupMapView token="pk.test" meetups={[meetup]} />);

    const content = markerInstances[0]?.popup?.domContent as HTMLDivElement;
    expect(content.textContent).toContain("Chicago, Illinois, USA");
    expect(content.textContent).toContain("Met: Jane Smith Johnson");
    expect(content.textContent).toContain("06/1995");
    expect(content.textContent).toContain("Added by joel@example.com");
  });

  it("re-renders markers when the meetups list changes", () => {
    const { rerender } = render(
      <ClassMeetupMapView token="pk.test" meetups={[meetup]} />,
    );
    expect(markerInstances).toHaveLength(1);

    const second: ClassMeetup = { ...meetup, id: "meetup-2", query: "Tokyo" };
    rerender(<ClassMeetupMapView token="pk.test" meetups={[meetup, second]} />);

    expect(markerInstances).toHaveLength(3);
    expect(markerInstances[0]?.removed).toBe(true);
  });
});
